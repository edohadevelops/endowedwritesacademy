// Local persistence engine (Phase 1 prototype backend).
//
// Everything lives in the browser's IndexedDB via idb-keyval: it has far more
// room than localStorage (images need it) and an async API that matches what
// Supabase will look like, so pages never change when the backend is swapped.
//
// IMPORTANT: this is per-browser storage. Content written here is only visible
// in this browser. It exists so the product can be built and demonstrated
// before the Supabase project is created. See README "Moving to Supabase".

import { createStore, get, set, del } from 'idb-keyval';
import { notify } from './events';
import type {
  Post, Revision, Category, Tag, Comment, SiteSettings,
} from '../types';

const db = createStore('endowed-academy', 'kv');

export interface LocalMediaRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  alt: string;
  caption: string;
  createdAt: string;
}

export interface LocalAdminRecord {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'editor';
  salt: string;
  hash: string;
  createdAt: string;
}

export interface Collections {
  posts: Post[];
  revisions: Revision[];
  categories: Category[];
  tags: Tag[];
  comments: Comment[];
  media: LocalMediaRecord[];
  admins: LocalAdminRecord[];
  settings: SiteSettings | null;
  /** Audit trail of important content changes. */
  audit: { id: string; at: string; actor: string; action: string; target: string }[];
}

type Key = keyof Collections;
const defaults: { [K in Key]: () => Collections[K] } = {
  posts: () => [],
  revisions: () => [],
  categories: () => [],
  tags: () => [],
  comments: () => [],
  media: () => [],
  admins: () => [],
  settings: () => null,
  audit: () => [],
};

const cache = new Map<Key, unknown>();
// Serialise writes per key so concurrent saves can't interleave.
const queues = new Map<Key, Promise<unknown>>();

export async function read<K extends Key>(key: K): Promise<Collections[K]> {
  if (cache.has(key)) return cache.get(key) as Collections[K];
  const value = ((await get(key, db)) as Collections[K] | undefined) ?? defaults[key]();
  cache.set(key, value);
  return value;
}

export function update<K extends Key, R = void>(
  key: K,
  fn: (current: Collections[K]) => { next: Collections[K]; result: R } | Promise<{ next: Collections[K]; result: R }>,
): Promise<R> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const current = await read(key);
    const { next, result } = await fn(structuredClone(current));
    await set(key, next, db);
    cache.set(key, next);
    notify(key);
    return result;
  });
  queues.set(key, run);
  return run;
}

// --- media blobs are stored separately from metadata --------------------
export const putBlob = (id: string, blob: Blob) => set(`blob:${id}`, blob, db);
export const getBlob = (id: string) => get<Blob>(`blob:${id}`, db);
export const deleteBlob = (id: string) => del(`blob:${id}`, db);

export { subscribe } from './events';

/** Test/dev helper: wipe everything. */
export async function resetAll(): Promise<void> {
  const { clear } = await import('idb-keyval');
  await clear(db);
  cache.clear();
}
