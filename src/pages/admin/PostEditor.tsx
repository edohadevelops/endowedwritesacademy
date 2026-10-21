import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, History, Settings2, X, ImagePlus, AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react';
import { adminPosts, taxonomy, displayStatus, AppError, userMessage } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useSite } from '@/context/SiteContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { DocJSON, ImageRef, Post, PostDraftInput, Revision } from '@/lib/types';
import { emptyDoc, slugify, docToText, readingMinutes, wordCount, excerptFrom } from '@/lib/utils/content';
import { formatDateTime, toLocalInput, fromLocalInput, timeAgo } from '@/lib/utils/format';
import { ArticleEditor } from '@/features/editor/ArticleEditor';
import { MediaPicker } from '@/components/admin/MediaPicker';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageTour, TourButton } from '@/features/onboarding/PageTour';
import { Cover } from '@/components/ui/Cover';

interface Form {
  title: string;
  slug: string;
  excerpt: string;
  content: DocJSON;
  featuredImage: ImageRef | null;
  authorName: string;
  categoryId: string | null;
  tagIds: string[];
  seoTitle: string;
  seoDescription: string;
  commentsEnabled: boolean;
}
type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';

const toForm = (p: Post): Form => ({
  title: p.title === 'Untitled article' ? '' : p.title, slug: p.slug, excerpt: p.excerpt, content: p.content,
  featuredImage: p.featuredImage, authorName: p.authorName, categoryId: p.categoryId, tagIds: p.tagIds,
  seoTitle: p.seoTitle, seoDescription: p.seoDescription, commentsEnabled: p.commentsEnabled,
});
const backupKey = (id: string | null) => `endowed.editor-backup.${id ?? 'new'}`;
const AUTOSAVE_MS = 1500;

export default function PostEditor() {
  const { id: routeId } = useParams();
  const isNew = !routeId;
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useSite();
  const { user } = useAuth();

  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [slugError, setSlugError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recovered, setRecovered] = useState<{ form: Form; at: string } | null>(null);
  const [publishMode, setPublishMode] = useState<'now' | 'schedule'>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  // Bumped when content is replaced from outside (restore/recover) so the editor resets.
  const [contentEpoch, setContentEpoch] = useState(0);

  const idRef = useRef<string | null>(routeId ?? null);
  const versionRef = useRef(0);
  const formRef = useRef<Form | null>(null);
  const changeRef = useRef(0);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryRef = useRef(0);
  const postRef = useRef<Post | null>(null);
  postRef.current = post;

  const cats = useAsync(() => taxonomy.categories(), [], ['categories']);
  const tags = useAsync(() => taxonomy.tags(), [], ['tags']);

  // ------------------------------------------------------------------ load
  useEffect(() => {
    let alive = true;
    const blank: Form = {
      title: '', slug: '', excerpt: '', content: emptyDoc(), featuredImage: null, authorName: settings.defaultAuthorName || user?.displayName || '',
      categoryId: null, tagIds: [], seoTitle: '', seoDescription: '', commentsEnabled: true,
    };
    const loadBackup = (id: string | null, updatedAt?: string) => {
      try {
        const raw = localStorage.getItem(backupKey(id));
        if (!raw) return;
        const b = JSON.parse(raw) as { form: Form; at: string };
        if (!updatedAt || b.at > updatedAt) setRecovered(b);
        else localStorage.removeItem(backupKey(id));
      } catch { /* ignore */ }
    };
    if (isNew) {
      setForm(blank);
      formRef.current = blank;
      loadBackup(null);
      return;
    }
    adminPosts.get(routeId!).then(
      (p) => {
        if (!alive) return;
        setPost(p);
        versionRef.current = p.version;
        const f = toForm(p);
        setForm(f);
        formRef.current = f;
        setSlugTouched(Boolean(p.publishedAt));
        setLastSavedAt(p.updatedAt);
        setSaveState('saved');
        if (displayStatus(p) === 'scheduled') { setPublishMode('schedule'); setScheduleAt(toLocalInput(p.publishedAt)); }
        loadBackup(p.id, p.updatedAt);
      },
      (e) => alive && setLoadError(userMessage(e)),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  const display = post ? displayStatus(post) : 'draft';
  const isLive = display === 'published';
  // Live articles don't autosave to the public page; changes wait for "Update".
  const autosave = !isLive;

  // ------------------------------------------------------------------ save
  const patchFrom = (f: Form): PostDraftInput => ({
    title: f.title.trim() || 'Untitled article', excerpt: f.excerpt, content: f.content, featuredImage: f.featuredImage,
    authorName: f.authorName, categoryId: f.categoryId, tagIds: f.tagIds, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
    commentsEnabled: f.commentsEnabled, ...(f.slug && f.slug !== postRef.current?.slug ? { slug: f.slug } : {}),
  });

  const flush = useCallback(async (opts: { revision?: 'manual' } = {}): Promise<Post | null> => {
    clearTimeout(timerRef.current);
    const f = formRef.current;
    if (!f) return null;
    if (savingRef.current) { queuedRef.current = true; return null; }
    savingRef.current = true;
    const snapshot = changeRef.current;
    setSaveState('saving');
    try {
      let saved: Post;
      if (!idRef.current) {
        saved = await adminPosts.create(patchFrom(f));
        idRef.current = saved.id;
        // Swap the URL without remounting the editor (keeps cursor and focus).
        window.history.replaceState(window.history.state, '', `/admin/posts/${saved.id}/edit`);
        localStorage.removeItem(backupKey(null));
      } else {
        saved = await adminPosts.save(idRef.current, patchFrom(f), versionRef.current, opts);
      }
      versionRef.current = saved.version;
      setPost(saved);
      setSlugError('');
      setLastSavedAt(saved.updatedAt);
      retryRef.current = 0;
      if (changeRef.current === snapshot) {
        setSaveState('saved');
        localStorage.removeItem(backupKey(idRef.current));
      } else {
        setSaveState('unsaved');
      }
      if (formRef.current && formRef.current.slug !== saved.slug && !slugTouchedRef.current) {
        formRef.current = { ...formRef.current, slug: saved.slug };
        setForm(formRef.current);
      }
      return saved;
    } catch (e) {
      if (e instanceof AppError && e.code === 'conflict') {
        setSaveState('conflict');
      } else if (e instanceof AppError && e.fields?.slug) {
        setSlugError(e.fields.slug);
        const restored = { ...formRef.current!, slug: postRef.current?.slug ?? '' };
        formRef.current = restored;
        setForm(restored);
        setSaveState('error');
        setSaveError('That URL is taken, so it was reset.');
      } else {
        setSaveState('error');
        setSaveError(userMessage(e, 'Couldn’t save. Your work is kept in this browser and will retry.'));
        if (!(e instanceof AppError && (e.code === 'unauthorized' || e.code === 'forbidden')) && retryRef.current < 3) {
          retryRef.current++;
          timerRef.current = setTimeout(() => void flush(), 2000 * 2 ** retryRef.current);
        }
      }
      return null;
    } finally {
      savingRef.current = false;
      if (queuedRef.current) { queuedRef.current = false; void flush(); }
    }
  }, []);

  const slugTouchedRef = useRef(slugTouched);
  slugTouchedRef.current = slugTouched;

  const update = (patch: Partial<Form>) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (patch.title !== undefined && !slugTouchedRef.current) next.slug = slugify(patch.title);
      formRef.current = next;
      try { localStorage.setItem(backupKey(idRef.current), JSON.stringify({ form: next, at: new Date().toISOString() })); } catch { /* full */ }
      return next;
    });
    changeRef.current++;
    setSaveState('unsaved');
    if (autosaveRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    }
  };
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ------------------------------------------------------ leave protection
  const dirty = saveState === 'unsaved' || saveState === 'saving' || saveState === 'error';
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  // --------------------------------------------------------------- actions
  const ensureSaved = async (): Promise<Post | null> => {
    if (saveState === 'saved' && postRef.current) return postRef.current;
    return flush();
  };

  const publish = async () => {
    setBusy(true);
    try {
      const saved = await ensureSaved();
      if (!saved) throw new AppError('unknown', 'Save the article before publishing.');
      let at: string | null = null;
      if (publishMode === 'schedule') {
        at = fromLocalInput(scheduleAt);
        if (!at || new Date(at).getTime() <= Date.now()) throw new AppError('validation', 'Pick a date and time in the future to schedule.');
      }
      const p = await adminPosts.publish(saved.id, saved.version, at);
      versionRef.current = p.version;
      setPost(p);
      if (formRef.current) { formRef.current = { ...formRef.current, excerpt: p.excerpt }; setForm(formRef.current); }
      setSlugTouched(true);
      setSaveState('saved');
      toast(displayStatus(p) === 'scheduled' ? `Scheduled for ${formatDateTime(p.publishedAt)}` : 'Published. It’s live on the blog.');
    } catch (e) {
      toast(userMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateLive = async () => {
    setBusy(true);
    const saved = await flush({ revision: 'manual' });
    setBusy(false);
    if (saved) toast('Updated. Readers now see the new version.');
  };

  const unpublish = async () => {
    setBusy(true);
    try {
      const saved = await ensureSaved();
      if (!saved) return;
      const p = await adminPosts.unpublish(saved.id, saved.version);
      versionRef.current = p.version;
      setPost(p);
      setPublishMode('now');
      toast('Unpublished. It’s a draft again.');
    } catch (e) {
      toast(userMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const p = await flush({ revision: 'manual' });
    if (p) toast(isLive ? 'Updated' : 'Draft saved');
  };

  const preview = async () => {
    const p = await ensureSaved();
    if (p) window.open(`/admin/posts/${p.id}/preview`, '_blank', 'noopener');
  };

  const reloadLatest = async () => {
    if (!idRef.current) return;
    const p = await adminPosts.get(idRef.current);
    versionRef.current = p.version;
    setPost(p);
    const f = toForm(p);
    formRef.current = f;
    setForm(f);
    setContentEpoch((n) => n + 1);
    setSaveState('saved');
  };

  const keepMine = async () => {
    if (!idRef.current) return;
    const p = await adminPosts.get(idRef.current);
    versionRef.current = p.version;
    setPost(p);
    await flush({ revision: 'manual' });
  };

  const setFeatured = async (on: boolean) => {
    if (!post) return;
    await adminPosts.setFeatured(post.id, on);
    const p = await adminPosts.get(post.id);
    versionRef.current = p.version;
    setPost(p);
    toast(on ? 'Featured on the blog home' : 'No longer featured');
  };

  // -------------------------------------------------------------- derived
  const stats = useMemo(() => {
    if (!form) return { words: 0, minutes: 1 };
    const text = docToText(form.content);
    return { words: wordCount(text), minutes: readingMinutes(text) };
  }, [form?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-serif text-3xl">This article couldn’t open.</h1>
        <p className="mt-3 text-stone">{loadError}</p>
        <Link to="/admin/posts" className="btn btn-outline mt-6">Back to articles</Link>
      </div>
    );
  }
  if (!form) return <div className="grid min-h-screen place-items-center text-stone">Opening article…</div>;

  const SaveIndicator = () => {
    const map: Record<SaveState, { icon: React.ReactNode; text: string }> = {
      idle: { icon: null, text: isNew ? 'Not saved yet' : '' },
      unsaved: { icon: <span className="h-2 w-2 rounded-full bg-warn" />, text: autosave ? 'Unsaved changes' : 'Unsaved changes. Press Update to publish them' },
      saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: 'Saving…' },
      saved: { icon: <Check className="h-3.5 w-3.5 text-success" />, text: lastSavedAt ? `Saved ${timeAgo(lastSavedAt)}` : 'Saved' },
      error: { icon: <CloudOff className="h-3.5 w-3.5 text-danger" />, text: saveError || 'Save failed' },
      conflict: { icon: <AlertTriangle className="h-3.5 w-3.5 text-danger" />, text: 'Changed elsewhere' },
    };
    const m = map[saveState];
    return <span className="inline-flex items-center gap-1.5 text-xs text-stone" role="status" aria-live="polite" data-tour="save-state" data-tip="Drafts save automatically a moment after you stop typing">{m.icon}<span className="hidden sm:inline">{m.text}</span></span>;
  };

  const sidebar = (
    <div className="space-y-7 text-sm">
      {/* Publish */}
      <section aria-labelledby="pub-h" className="space-y-3" data-tour="publish-panel">
        <div className="flex items-center justify-between">
          <h2 id="pub-h" className="font-semibold">Publishing</h2>
          <StatusBadge status={display} />
        </div>
        {display === 'published' && post?.publishedAt && <p className="text-stone">Published {formatDateTime(post.publishedAt)}</p>}
        {display === 'scheduled' && <p className="text-stone">Goes live {formatDateTime(post?.publishedAt)}. You can keep editing until then.</p>}
        {!isLive && (
          <fieldset className="space-y-2">
            <legend className="sr-only">When to publish</legend>
            <label className="flex items-center gap-2" data-tip="Make the article live as soon as you press Publish"><input type="radio" name="when" checked={publishMode === 'now'} onChange={() => setPublishMode('now')} className="accent-[rgb(var(--accent))]" />Publish now</label>
            <label className="flex items-center gap-2" data-tip="Pick a date and time; it goes live on its own"><input type="radio" name="when" checked={publishMode === 'schedule'} onChange={() => setPublishMode('schedule')} className="accent-[rgb(var(--accent))]" />Schedule for later</label>
            {publishMode === 'schedule' && (
              <div>
                <label htmlFor="sched" className="sr-only">Publish date and time</label>
                <input id="sched" type="datetime-local" className="input" value={scheduleAt} min={toLocalInput(new Date().toISOString())} onChange={(e) => setScheduleAt(e.target.value)} />
                <p className="field-hint">Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
              </div>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap gap-2">
          {isLive ? (
            <button className="btn btn-primary flex-1" onClick={updateLive} disabled={busy || saveState === 'saved'} data-tip="Publish your latest edits to the live article">Update</button>
          ) : (
            <button className="btn btn-primary flex-1" onClick={publish} disabled={busy} data-tip={publishMode === 'schedule' ? 'Go live automatically at the time above' : 'Make this article live on the blog now'}>
              {publishMode === 'schedule' ? (display === 'scheduled' ? 'Reschedule' : 'Schedule') : 'Publish'}
            </button>
          )}
          {(isLive || display === 'scheduled') && <button className="btn btn-outline" onClick={unpublish} disabled={busy} data-tip="Take it off the blog and make it a draft again">Unpublish</button>}
        </div>
        {isLive && (
          <a href={`/blog/${post!.slug}`} target="_blank" rel="noopener" className="inline-block text-accent-strong underline-offset-4 hover:underline">View on the blog</a>
        )}
      </section>

      {/* URL */}
      <section className="space-y-2" data-tour="slug">
        <label htmlFor="slug" className="font-semibold">Web address</label>
        <div className="flex items-center rounded border border-line bg-paper focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <span className="pl-3 text-stone">/blog/</span>
          <input id="slug" className="min-w-0 flex-1 bg-transparent py-2 pr-3 focus:outline-none" value={form.slug}
            onChange={(e) => { setSlugTouched(true); update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }); }}
            onBlur={() => update({ slug: slugify(form.slug) || slugify(form.title) })}
            aria-invalid={Boolean(slugError)} aria-describedby="slug-hint" />
        </div>
        <p id="slug-hint" className={slugError ? 'field-error' : 'field-hint'}>
          {slugError || (post?.publishedAt ? 'Changing this keeps the old address working.' : 'Fills in from the title until you edit it.')}
        </p>
      </section>

      {/* Featured image */}
      <section className="space-y-2" data-tour="featured-image">
        <h2 className="font-semibold">Featured image</h2>
        {form.featuredImage ? (
          <div className="space-y-2">
            <Cover image={form.featuredImage} ratio="16 / 9" className="rounded" />
            <label htmlFor="fi-alt" className="field-label text-xs">Alt text</label>
            <input id="fi-alt" className="input" value={form.featuredImage.alt} onChange={(e) => update({ featuredImage: { ...form.featuredImage!, alt: e.target.value } })} />
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setPickerOpen(true)} data-tip="Choose a different featured image">Replace</button>
              <button className="btn btn-ghost btn-sm text-danger" onClick={() => update({ featuredImage: null })} data-tip="Remove the featured image (the file stays in Media)">Remove</button>
            </div>
          </div>
        ) : (
          <button className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-line text-stone hover:border-stone hover:text-ink" onClick={() => setPickerOpen(true)}>
            <ImagePlus className="h-6 w-6" aria-hidden />Choose image
          </button>
        )}
        <p className="field-hint">Used on the blog home and when the link is shared.</p>
      </section>

      {/* Organise */}
      <section className="space-y-4" data-tour="organise">
        <div>
          <label htmlFor="cat" className="field-label font-semibold">Category</label>
          <select id="cat" className="input" value={form.categoryId ?? ''} onChange={(e) => update({ categoryId: e.target.value || null })}>
            <option value="">No category</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <TagInput selected={form.tagIds} all={tags.data ?? []} onChange={(tagIds) => update({ tagIds })} />
        <div>
          <label htmlFor="author" className="field-label font-semibold">Author</label>
          <input id="author" className="input" value={form.authorName} onChange={(e) => update({ authorName: e.target.value })} />
        </div>
      </section>

      {/* Excerpt */}
      <section data-tour="excerpt">
        <label htmlFor="excerpt" className="field-label font-semibold">Summary</label>
        <textarea id="excerpt" className="input min-h-24" maxLength={300} value={form.excerpt} onChange={(e) => update({ excerpt: e.target.value })}
          placeholder={excerptFrom(docToText(form.content), 160) || 'One or two sentences about the article.'} />
        <p className="field-hint">Shown under the title and on article cards. Left empty, the opening lines are used.</p>
      </section>

      {/* Options */}
      <section className="space-y-3">
        <h2 className="font-semibold">Options</h2>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={form.commentsEnabled} onChange={(e) => update({ commentsEnabled: e.target.checked })} />
          <span>Allow comments</span>
        </label>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={Boolean(post?.isFeatured)} disabled={!isLive} onChange={(e) => setFeatured(e.target.checked)} />
          <span>Feature on the blog home{!isLive && <span className="block text-xs text-stone">Available once published.</span>}</span>
        </label>
      </section>

      {/* SEO */}
      <details className="group" data-tour="seo">
        <summary className="cursor-pointer list-none font-semibold">Search & sharing <span className="font-normal text-stone group-open:hidden">(optional)</span></summary>
        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="seo-t" className="field-label">Search title</label>
            <input id="seo-t" className="input" value={form.seoTitle} placeholder={form.title} onChange={(e) => update({ seoTitle: e.target.value })} />
            <p className={`field-hint ${(form.seoTitle || form.title).length > 60 ? 'text-warn' : ''}`}>{(form.seoTitle || form.title).length} / 60 characters</p>
          </div>
          <div>
            <label htmlFor="seo-d" className="field-label">Search description</label>
            <textarea id="seo-d" className="input min-h-20" value={form.seoDescription} placeholder={form.excerpt} onChange={(e) => update({ seoDescription: e.target.value })} />
            <p className={`field-hint ${(form.seoDescription || form.excerpt).length > 160 ? 'text-warn' : ''}`}>{(form.seoDescription || form.excerpt).length} / 160 characters</p>
          </div>
          <div className="rounded border border-line bg-paper p-3" aria-label="Search result preview">
            <p className="truncate text-[0.8rem] text-stone">{(settings.seo.siteUrl || window.location.origin).replace(/^https?:\/\//, '')} › blog › {form.slug}</p>
            <p className="mt-0.5 truncate text-base text-[#1a0dab]">{form.seoTitle || form.title || 'Article title'}</p>
            <p className="line-clamp-2 text-[0.8rem] text-stone">{form.seoDescription || form.excerpt || excerptFrom(docToText(form.content), 155)}</p>
          </div>
        </div>
      </details>

      {post && (
        <section className="space-y-2 border-t border-line pt-5">
          <button className="btn btn-outline w-full" data-tour="revisions" data-tip="See earlier versions and restore one" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" />Revision history</button>
          <button className="btn btn-ghost w-full text-danger" data-tip="Remove from the blog. You can restore it from Articles → Trash." onClick={() => setConfirmTrash(true)}>Move to trash</button>
        </section>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-ivory">
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="flex h-[3.75rem] items-center gap-2 px-3 md:px-5">
          <Link to="/admin/posts" data-tip="Back to all articles" className="inline-flex h-9 items-center gap-1.5 rounded px-2 text-sm text-stone hover:bg-ink/5 hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Articles</span>
          </Link>
          <div className="mx-2 hidden h-6 w-px bg-line sm:block" />
          <SaveIndicator />
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-2 hidden text-xs text-stone lg:inline">{stats.words} words · {stats.minutes} min read</span>
            <button className="btn btn-ghost btn-sm" onClick={preview} data-tour="preview" data-tip="See it exactly as readers will. Only you can open it."><Eye className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Preview</span></button>
            {!isLive && <button className="btn btn-outline btn-sm" onClick={saveDraft} disabled={saveState === 'saving'} data-tip="Save now and keep a copy in the revision history (Ctrl+S)">Save draft</button>}
            {isLive
              ? <button className="btn btn-primary btn-sm" onClick={updateLive} disabled={busy || saveState === 'saved'} data-tip="Publish your latest edits to the live article">Update</button>
              : <button className="btn btn-primary btn-sm hidden sm:inline-flex" onClick={publish} disabled={busy} data-tip="Make this article live, or schedule it from the panel on the right">{publishMode === 'schedule' ? 'Schedule' : 'Publish'}</button>}
            <TourButton id="editor" compact />
            <button className="btn btn-outline btn-sm lg:hidden" data-tour="settings-toggle" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen} aria-controls="post-settings">
              <Settings2 className="h-4 w-4" aria-hidden /><span className="sr-only">Article settings</span>
            </button>
          </div>
        </div>
      </div>

      {saveState === 'conflict' && (
        <div className="border-b border-danger/30 bg-danger/5 px-5 py-3 text-sm" role="alert">
          <p className="font-medium text-danger">This article was changed in another tab or window.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-outline btn-sm" onClick={reloadLatest}>Load the latest version</button>
            <button className="btn btn-outline btn-sm" onClick={keepMine}>Keep my version</button>
          </div>
        </div>
      )}
      {recovered && (
        <div className="border-b border-warn/30 bg-warn/10 px-5 py-3 text-sm" role="status">
          <p>Unsaved changes from {timeAgo(recovered.at)} were found in this browser.</p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => { setRecovered(null); update(recovered.form); setContentEpoch((n) => n + 1); }}>Restore them</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { localStorage.removeItem(backupKey(idRef.current)); setRecovered(null); }}>Discard</button>
          </div>
        </div>
      )}

      <div className="mx-auto grid max-w-7xl lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 px-4 pb-32 pt-8 md:px-10">
          <div className="mx-auto max-w-read">
            <label htmlFor="title" className="sr-only">Title</label>
            <div data-tour="title"><TitleField value={form.title} onChange={(title) => update({ title })} /></div>
            <PageTour id="editor" />
            <div className="mt-6">
              <ArticleEditor
                key={contentEpoch}
                content={form.content}
                onChange={(content) => update({ content })}
                onSaveShortcut={saveDraft}
                ctaDefaults={settings.cta}
                dropCap={settings.showDropCap}
              />
            </div>
          </div>
        </div>
        <aside id="post-settings" aria-label="Article settings"
          className={`border-l border-line bg-paper ${panelOpen ? 'fixed inset-y-0 right-0 z-40 w-[22rem] max-w-[92vw] overflow-y-auto shadow-cover' : 'hidden'} lg:static lg:block lg:w-auto lg:shadow-none`}>
          <div className="lg:sticky lg:top-[3.75rem] lg:max-h-[calc(100vh-3.75rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line px-5 py-3 lg:hidden">
              <h2 className="font-semibold">Article settings</h2>
              <button className="rounded p-2 hover:bg-ink/5" onClick={() => setPanelOpen(false)} aria-label="Close settings"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5">{sidebar}</div>
          </div>
        </aside>
        {panelOpen && <div className="fixed inset-0 z-30 bg-obsidian/40 lg:hidden" onClick={() => setPanelOpen(false)} aria-hidden />}
      </div>

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} title="Featured image"
        onPick={(a) => update({ featuredImage: { mediaId: a.id, src: a.url, alt: a.alt, width: a.width, height: a.height } })} />

      {post && (
        <RevisionsModal open={historyOpen} onClose={() => setHistoryOpen(false)} postId={post.id}
          onRestore={async (rev) => {
            const saved = await ensureSaved();
            if (!saved) return;
            const p = await adminPosts.restoreRevision(rev.id, saved.version);
            versionRef.current = p.version;
            setPost(p);
            const f = toForm(p);
            formRef.current = f;
            setForm(f);
            setContentEpoch((n) => n + 1);
            setSaveState('saved');
            setHistoryOpen(false);
            toast(isLive ? 'Restored. Readers see this version now.' : 'Earlier version restored');
          }} />
      )}

      <ConfirmDialog open={confirmTrash} onClose={() => setConfirmTrash(false)} danger title="Move this article to the trash?"
        body="It’s removed from the blog straight away. You can restore it from Articles → Trash."
        confirmLabel="Move to trash"
        onConfirm={async () => {
          await adminPosts.trash([post!.id]);
          setSaveState('saved');
          changeRef.current = 0;
          localStorage.removeItem(backupKey(post!.id));
          toast('Moved to trash');
          setTimeout(() => navigate('/admin/posts'), 0);
        }} />

      {blocker.state === 'blocked' && (
        <ConfirmDialog open onClose={() => blocker.reset?.()} title="Leave without saving?"
          body={autosave ? 'Your latest changes haven’t saved yet.' : 'This article is live. Your edits aren’t published until you press Update. They stay in this browser if you leave.'}
          confirmLabel="Leave anyway" danger onConfirm={() => blocker.proceed?.()} />
      )}
    </div>
  );
}

function TitleField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // Re-fit when the width changes or the web font finishes loading.
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea ref={ref} id="title" rows={1} value={value} placeholder="Article title"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector<HTMLElement>('.ProseMirror')?.focus(); } }}
      className="w-full resize-none overflow-hidden bg-transparent font-serif text-4xl font-normal leading-tight text-ink placeholder:text-stone/50 focus:outline-none md:text-5xl" />
  );
}

function TagInput({ selected, all, onChange }: { selected: string[]; all: { id: string; name: string }[]; onChange: (ids: string[]) => void }) {
  const [text, setText] = useState('');
  const add = async () => {
    const names = text.split(',').map((t) => t.trim()).filter(Boolean);
    if (!names.length) return;
    const created = await taxonomy.ensureTags(names);
    onChange([...new Set([...selected, ...created.map((t) => t.id)])]);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void add(); }
    if (e.key === 'Backspace' && !text && selected.length) onChange(selected.slice(0, -1));
  };
  return (
    <div>
      <label htmlFor="tags" className="field-label font-semibold">Tags</label>
      {selected.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const t = all.find((x) => x.id === id);
            if (!t) return null;
            return (
              <li key={id} className="inline-flex items-center gap-1 rounded-full bg-obsidian py-1 pl-3 pr-1 text-xs text-ivory">
                {t.name}
                <button type="button" className="rounded-full p-0.5 hover:bg-white/15" onClick={() => onChange(selected.filter((x) => x !== id))} aria-label={`Remove tag ${t.name}`}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input id="tags" className="input" list="tag-options" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={() => void add()} placeholder="Type a tag, press Enter" />
      <datalist id="tag-options">{all.filter((t) => !selected.includes(t.id)).map((t) => <option key={t.id} value={t.name} />)}</datalist>
    </div>
  );
}

function RevisionsModal({ open, onClose, postId, onRestore }: { open: boolean; onClose: () => void; postId: string; onRestore: (r: Revision) => Promise<void> }) {
  const { data } = useAsync(() => (open ? adminPosts.revisions(postId) : Promise.resolve([])), [open, postId], ['revisions']);
  const [sel, setSel] = useState<Revision | null>(null);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && data?.length && !sel) setSel(data[0]); if (!open) setSel(null); }, [open, data, sel]);
  useEffect(() => {
    if (!sel) return;
    import('@/features/content/render').then(async ({ renderArticleHtml }) => {
      const { resolveDocMedia } = await import('@/lib/data');
      setHtml(renderArticleHtml(await resolveDocMedia(sel.content)));
    });
  }, [sel]);
  const reasonLabel: Record<Revision['reason'], string> = {
    manual: 'Saved', publish: 'Published', checkpoint: 'Autosave checkpoint', 'before-restore': 'Before a restore', import: 'Imported',
  };
  return (
    <Modal open={open} onClose={onClose} title="Revision history" size="xl"
      footer={<>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        <button className="btn btn-primary" disabled={!sel || busy} onClick={async () => { if (!sel) return; setBusy(true); try { await onRestore(sel); } finally { setBusy(false); } }}>Restore this version</button>
      </>}>
      {data && data.length === 0 ? (
        <p className="text-stone">No earlier versions yet. Versions are kept when you save, publish, and every 10 minutes while you write.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          <ol className="max-h-[55vh] space-y-1 overflow-y-auto">
            {(data ?? []).map((r) => (
              <li key={r.id}>
                <button onClick={() => setSel(r)} aria-pressed={sel?.id === r.id}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${sel?.id === r.id ? 'bg-obsidian text-ivory' : 'hover:bg-ink/5'}`}>
                  <span className="block font-medium">{formatDateTime(r.createdAt)}</span>
                  <span className={`text-xs ${sel?.id === r.id ? 'text-mist' : 'text-stone'}`}>{reasonLabel[r.reason]}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="max-h-[55vh] overflow-y-auto rounded border border-line bg-ivory p-6">
            {sel && <h3 className="mb-4 font-serif text-2xl">{sel.title}</h3>}
            <div className="prose-article no-dropcap text-base" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
