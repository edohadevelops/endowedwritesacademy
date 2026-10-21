import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAll } from '@/lib/data/store';
import { auth, adminPosts, publicApi, adminComments, settings, AppError } from '@/lib/data';
import type { DocJSON } from '@/lib/types';

const body = (text: string): DocJSON => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const admin = { email: 'owner@endowed.test', password: 'Study-hard-2026', displayName: 'Owner' };

beforeEach(async () => {
  await resetAll();
  localStorage.clear();
});

describe('administrator account', () => {
  it('can be created only once, then sign-up closes', async () => {
    expect(await auth.needsSetup()).toBe(true);
    await auth.createFirstAdmin(admin);
    await auth.signOut();
    await expect(auth.createFirstAdmin({ ...admin, email: 'intruder@x.com' })).rejects.toThrow(/already exists/);
  });
  it('rejects weak passwords', async () => {
    await expect(auth.createFirstAdmin({ ...admin, password: 'short' })).rejects.toThrow(/12 characters/);
  });
  it('locks out after repeated wrong passwords', async () => {
    await auth.createFirstAdmin(admin);
    await auth.signOut();
    for (let i = 0; i < 5; i++) await expect(auth.signIn(admin.email, 'wrong-password-1')).rejects.toBeInstanceOf(AppError);
    await expect(auth.signIn(admin.email, admin.password)).rejects.toThrow(/Too many attempts/);
  });
});

describe('authorisation', () => {
  it('refuses admin operations without a session', async () => {
    await auth.createFirstAdmin(admin);
    await auth.signOut();
    await expect(adminPosts.create({ title: 'x' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(adminComments.list({})).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(settings.save(await settings.get())).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('publishing', () => {
  beforeEach(async () => { await auth.createFirstAdmin(admin); });

  it('keeps drafts private and shows published articles', async () => {
    const p = await adminPosts.create({ title: 'Exam tips', content: body('Revise early.') });
    expect(await publicApi.postBySlug('exam-tips')).toBeNull();
    expect((await publicApi.listPosts({})).total).toBe(0);
    await adminPosts.publish(p.id, p.version);
    const res = await publicApi.postBySlug('exam-tips');
    expect(res?.kind).toBe('post');
    expect((await publicApi.listPosts({ q: 'revise' })).total).toBe(1);
  });

  it('hides scheduled articles until their time', async () => {
    const p = await adminPosts.create({ title: 'Later', content: body('Soon.') });
    await adminPosts.publish(p.id, p.version, new Date(Date.now() + 3_600_000).toISOString());
    expect(await publicApi.postBySlug('later')).toBeNull();
    expect((await adminPosts.counts()).scheduled).toBe(1);
  });

  it('refuses stale saves instead of overwriting newer work', async () => {
    const p = await adminPosts.create({ title: 'Draft', content: body('v1') });
    await adminPosts.save(p.id, { content: body('v2') }, p.version);
    await expect(adminPosts.save(p.id, { content: body('stale') }, p.version)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('redirects old slugs after a published article is renamed', async () => {
    const p = await adminPosts.create({ title: 'First name', content: body('text') });
    const pub = await adminPosts.publish(p.id, p.version);
    await adminPosts.save(p.id, { slug: 'second-name' }, pub.version);
    expect(await publicApi.postBySlug('first-name')).toEqual({ kind: 'redirect', slug: 'second-name' });
  });

  it('keeps revisions and restores an earlier version', async () => {
    const p = await adminPosts.create({ title: 'Rev', content: body('original') });
    const s1 = await adminPosts.save(p.id, { content: body('original') }, p.version, { revision: 'manual' });
    const s2 = await adminPosts.save(p.id, { content: body('changed') }, s1.version, { revision: 'manual' });
    const revs = await adminPosts.revisions(p.id);
    const original = revs.find((r) => JSON.stringify(r.content).includes('original'))!;
    const restored = await adminPosts.restoreRevision(original.id, s2.version);
    expect(restored.contentText).toBe('original');
  });

  it('moves to trash before permanent deletion', async () => {
    const p = await adminPosts.create({ title: 'Bin me', content: body('x') });
    await expect(adminPosts.deleteForever([p.id])).rejects.toThrow(/trash/);
    await adminPosts.trash([p.id]);
    await adminPosts.restore([p.id]);
    await adminPosts.trash([p.id]);
    await adminPosts.deleteForever([p.id]);
    expect((await adminPosts.counts()).trashed).toBe(0);
  });
});

describe('comments', () => {
  it('holds new comments for approval and shows them once approved', async () => {
    await auth.createFirstAdmin(admin);
    const p = await adminPosts.create({ title: 'Talk', content: body('x') });
    await adminPosts.publish(p.id, p.version);
    const res = await publicApi.submitComment(p.id, { name: 'Ada', body: 'Great read!', elapsedMs: 9000 });
    expect(res.status).toBe('pending');
    expect(await publicApi.approvedComments(p.id)).toHaveLength(0);
    const pending = await adminComments.list({ status: 'pending' });
    await adminComments.setStatus([pending.items[0].id], 'approved');
    const visible = await publicApi.approvedComments(p.id);
    expect(visible).toHaveLength(1);
    expect(Object.keys(visible[0]).sort()).toEqual(['authorName', 'body', 'createdAt', 'id']); // no moderation data leaks
  });

  it('refuses comments on drafts and stores nothing from bots', async () => {
    await auth.createFirstAdmin(admin);
    const draft = await adminPosts.create({ title: 'Hidden', content: body('x') });
    await expect(publicApi.submitComment(draft.id, { name: 'Ada', body: 'hello', elapsedMs: 9000 })).rejects.toMatchObject({ code: 'not_found' });
    const p = await adminPosts.create({ title: 'Open', content: body('x') });
    await adminPosts.publish(p.id, p.version);
    await publicApi.submitComment(p.id, { name: 'Bot', body: 'buy now', website: 'http://spam', elapsedMs: 9000 });
    expect((await adminComments.list({ status: 'all' })).total).toBe(0);
  });

  it('rate-limits repeated submissions', async () => {
    await auth.createFirstAdmin(admin);
    const p = await adminPosts.create({ title: 'Busy', content: body('x') });
    await adminPosts.publish(p.id, p.version);
    for (let i = 0; i < 4; i++) await publicApi.submitComment(p.id, { name: 'Ada', body: `comment ${i}`, elapsedMs: 9000 });
    await expect(publicApi.submitComment(p.id, { name: 'Ada', body: 'one more', elapsedMs: 9000 })).rejects.toMatchObject({ code: 'rate_limited' });
  });
});
