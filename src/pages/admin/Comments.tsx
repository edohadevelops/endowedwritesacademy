import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminComments, adminPosts, userMessage } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import type { CommentStatus } from '@/lib/types';
import { PageHeader } from '@/components/layout/AdminLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Pagination } from '@/components/ui/Pagination';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime, timeAgo } from '@/lib/utils/format';

const TABS: { key: CommentStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'spam', label: 'Spam' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];
const PAGE = 20;
const COMMENT_TIPS: Record<string, string> = {
  pending: 'New comments waiting for your approval',
  approved: 'Comments readers can see',
  spam: 'Caught as spam. Never shown.',
  rejected: 'Comments you chose not to show',
  all: 'Every comment',
};

export default function Comments() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const status = (params.get('status') as CommentStatus | 'all') || 'pending';
  const postId = params.get('post') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const list = useAsync(() => adminComments.list({ status, postId: postId || undefined, page, pageSize: PAGE }), [status, postId, page], ['comments']);
  const counts = useAsync(() => adminComments.counts(), [], ['comments']);
  const posts = useAsync(() => adminPosts.list({ pageSize: 500, sort: 'title', dir: 'asc' }), [], ['posts']);
  useEffect(() => setSelected(new Set()), [status, postId, page]);

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };
  const act = async (ids: string[], next: CommentStatus | 'delete') => {
    try {
      if (next === 'delete') await adminComments.remove(ids);
      else await adminComments.setStatus(ids, next);
      const word = { approved: 'Approved', rejected: 'Rejected', spam: 'Marked as spam', pending: 'Moved back to waiting', delete: 'Deleted' }[next];
      toast(ids.length > 1 ? `${word} ${ids.length} comments` : word);
      setSelected(new Set());
    } catch (e) {
      toast(userMessage(e), 'error');
    }
  };
  const rows = list.data?.items ?? [];
  const ids = [...selected];

  return (
    <>
      <PageHeader title="Comments" description="New comments wait here until you approve them." tour="comments" />
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div role="tablist" aria-label="Filter by status" className="flex min-w-max gap-1 border-b border-line" data-tour="comment-tabs">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={status === t.key} data-tip={COMMENT_TIPS[t.key]} onClick={() => set('status', t.key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${status === t.key ? 'border-accent text-ink' : 'border-transparent text-stone hover:text-ink'}`}>
              {t.label}{counts.data && t.key !== 'all' && <span className="ml-1.5 text-xs text-stone">{counts.data[t.key]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor="post-f" className="sr-only">Article</label>
        <select id="post-f" data-tour="comment-filter" data-tip="Show comments for one article" className="input w-auto max-w-full" value={postId} onChange={(e) => set('post', e.target.value || null)}>
          <option value="">All articles</option>
          {(posts.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        {rows.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={rows.every((r) => selected.has(r.id))}
              onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
            Select all
          </label>
        )}
        {selected.size > 0 && (
          <div className="flex flex-wrap gap-2" role="region" aria-label="Bulk actions">
            <button className="btn btn-primary btn-sm" data-tip="Show all selected comments on the blog" onClick={() => act(ids, 'approved')}>Approve {selected.size}</button>
            <button className="btn btn-outline btn-sm" onClick={() => act(ids, 'rejected')}>Reject</button>
            <button className="btn btn-outline btn-sm" onClick={() => act(ids, 'spam')}>Spam</button>
            <button className="btn btn-ghost btn-sm text-danger" onClick={() => setConfirmDelete(ids)}>Delete</button>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {list.loading && !list.data ? (
          [0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-paper p-10 text-center">
            <p className="font-serif text-xl">{status === 'pending' ? 'You’re all caught up.' : 'No comments here.'}</p>
            <p className="mt-1 text-sm text-stone">{status === 'pending' ? 'New comments from readers will wait here for approval.' : 'Try another tab or article.'}</p>
          </div>
        ) : rows.map((c) => (
          <article key={c.id} data-tour={rows[0]?.id === c.id ? 'comment-card' : undefined} className={`rounded-md border bg-paper p-4 sm:p-5 ${selected.has(c.id) ? 'border-accent' : 'border-line'}`}>
            <div className="flex gap-3">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]" checked={selected.has(c.id)} aria-label={`Select comment by ${c.authorName}`}
                onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">{c.authorName}</span>
                  <StatusBadge status={c.status} />
                  <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)} className="text-stone">{timeAgo(c.createdAt)}</time>
                </div>
                <p className="mt-1 text-xs text-stone">
                  On {c.postSlug ? <Link to={`/admin/posts/${c.postId}/edit`} className="font-medium text-ink hover:underline">{c.postTitle}</Link> : c.postTitle}
                </p>
                <p className="mt-3 whitespace-pre-line break-words text-[0.97rem] leading-relaxed">{c.body}</p>
                {c.flags.length > 0 && (
                  <p className="mt-3 rounded bg-warn/10 px-3 py-2 text-xs text-warn" data-tour="comment-flags">Flagged automatically: {c.flags.join(', ')}.</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {c.status !== 'approved' && <button className="btn btn-primary btn-sm" data-tip="Show this comment under the article" onClick={() => act([c.id], 'approved')}>Approve</button>}
                  {c.status === 'approved' && <button className="btn btn-outline btn-sm" data-tip="Hide it again and move it back to Waiting" onClick={() => act([c.id], 'pending')}>Unapprove</button>}
                  {c.status !== 'rejected' && <button className="btn btn-outline btn-sm" data-tip="Don’t show it, but keep a record" onClick={() => act([c.id], 'rejected')}>Reject</button>}
                  {c.status !== 'spam' && <button className="btn btn-outline btn-sm" data-tip="Mark as spam so it never shows" onClick={() => act([c.id], 'spam')}>Spam</button>}
                  <button className="btn btn-ghost btn-sm text-danger" data-tip="Delete for good" onClick={() => setConfirmDelete([c.id])}>Delete</button>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-6"><Pagination page={page} total={list.data?.total ?? 0} pageSize={PAGE} onChange={(n) => set('page', n > 1 ? String(n) : null)} /></div>

      <ConfirmDialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} danger
        title={confirmDelete && confirmDelete.length > 1 ? `Delete ${confirmDelete.length} comments?` : 'Delete this comment?'}
        body="Deleted comments are gone for good. To hide a comment but keep a record, reject it instead."
        confirmLabel="Delete" onConfirm={async () => { await act(confirmDelete!, 'delete'); setConfirmDelete(null); }} />
    </>
  );
}
