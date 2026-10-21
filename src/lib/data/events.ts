// Tiny change notifications so open views refresh after a save, whichever
// backend made the change.
export type DataKey = 'posts' | 'revisions' | 'categories' | 'tags' | 'comments' | 'media' | 'admins' | 'settings' | 'audit';

type Listener = (key: DataKey) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function notify(key: DataKey): void {
  listeners.forEach((l) => l(key));
}
