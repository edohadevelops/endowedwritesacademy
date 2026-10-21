import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PenSquare, Search, Star, Upload } from 'lucide-react';
import { adminPosts, taxonomy, userMessage, AppError,type StatusFilter, type SortKey, type AdminPostRow } from '@/lib/data';
import { useAsync, useDebounced } from '@/lib/hooks';
import { ADMIN_PAGE_SIZE } from '@/config/defaults';
import { PageHeader } from '@/components/layout/AdminLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Cover } from '@/components/ui/Cover';
import { Pagination } from '@/components/ui/Pagination';
import { ActionMenu } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime } from '@/lib/utils/format';

const TAB_TIPS: Record<string, string> = {
  all: 'Every article except the trash',
  published: 'Live on the blog now',
  scheduled: 'Will go live on their own at the time you set',
  draft: 'Private until you publish',
  archived: 'Taken off the blog but kept',
  trashed: 'Deleted articles you can still restore',
};

const TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
  { key: 'trashed', label: 'Trash' },
];

type Confirm = { kind: 'trash' | 'delete'; ids: string[] } | null;

export default function Posts() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const status = (params.get('status') as StatusFilter) || 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sort = (params.get('sort') as SortKey) || 'updatedAt';
  const dir = (params.get('dir') as 'asc' | 'desc') || (sort === 'title' ? 'asc' : 'desc');
  const categoryId = params.get('category') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q, 250);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p, { replace: true });
  };
  useEffect(() => { if ((params.get('q') ?? '') !== dq) setParam('q', dq || null); /* eslint-disable-next-line */ }, [dq]);
  useEffect(() => setSelected(new Set()), [status, page, dq, categoryId]);

  const list = useAsync(
    () => adminPosts.list({ page, pageSize: ADMIN_PAGE_SIZE, q: dq, status, sort, dir, categoryId: categoryId || undefined }),
    [page, dq, status, sort, dir, categoryId],
    ['posts', 'comments'],
  );
  const counts = useAsync(() => adminPosts.counts(), [], ['posts']);
  const cats = useAsync(() => taxonomy.categories(), [], ['categories']);
  const rows = list.data?.items ?? [];
  const inTrash = status === 'trashed';

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setSelected(new Set());
    } catch (e) {
      toast(userMessage(e), 'error');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const rowActions = (p: AdminPostRow) => {
    const live = p.display === 'published' || p.display === 'scheduled';
    return [
      { label: 'Edit', onSelect: () => navigate(`/admin/posts/${p.id}/edit`), hidden: inTrash },
      { label: 'View on site', onSelect: () => window.open(`/blog/${p.slug}`, '_blank'), hidden: p.display !== 'published' },
      { label: 'Preview', onSelect: () => window.open(`/admin/posts/${p.id}/preview`, '_blank'), hidden: inTrash || p.display === 'published' },
      { label: p.isFeatured ? 'Remove from featured' : 'Feature on blog home', onSelect: () => run(() => adminPosts.setFeatured(p.id, !p.isFeatured), p.isFeatured ? 'Removed from featured' : 'Now featured on the blog home'), hidden: p.display !== 'published' },
      { label: 'Publish now', onSelect: () => run(() => adminPosts.publish(p.id, p.version), 'Published'), hidden: inTrash || live },
      { label: 'Unpublish', onSelect: () => run(() => adminPosts.unpublish(p.id, p.version), 'Moved back to drafts'), hidden: !live },
      { label: 'Duplicate', onSelect: () => run(async () => { const c = await adminPosts.duplicate(p.id); navigate(`/admin/posts/${c.id}/edit`); }, 'Duplicated'), hidden: inTrash },
      { label: 'Archive', onSelect: () => run(() => adminPosts.archive(p.id, p.version), 'Archived'), hidden: inTrash || p.display === 'archived' },
      { label: 'Restore', onSelect: () => run(() => adminPosts.restore([p.id]), 'Restored to drafts'), hidden: !inTrash },
      { label: 'Move to trash', onSelect: () => setConfirm({ kind: 'trash', ids: [p.id] }), danger: true, hidden: inTrash },
      { label: 'Delete permanently', onSelect: () => setConfirm({ kind: 'delete', ids: [p.id] }), danger: true, hidden: !inTrash },
    ];
  };

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected];

  return (
    <>
      <PageHeader title="Articles" tour="posts" actions={<>
        <Link to="/admin/import" className="btn btn-outline" data-tour="bulk-import" data-tip="Upload many articles at once"><Upload className="h-4 w-4" aria-hidden />Import</Link>
        <Link to="/admin/posts/new" className="btn btn-primary" data-tip="Start a new article"><PenSquare className="h-4 w-4" aria-hidden />New article</Link>
      </>} />

      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <div role="tablist" aria-label="Filter by status" className="flex min-w-max gap-1 border-b border-line" data-tour="status-tabs">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={status === t.key} data-tip={TAB_TIPS[t.key]}
              onClick={() => setParam('status', t.key === 'all' ? null : t.key)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${status === t.key ? 'border-accent text-ink' : 'border-transparent text-stone hover:text-ink'}`}>
              {t.label}
              {counts.data && t.key !== 'all' && <span className="ml-1.5 text-xs text-stone">{counts.data[t.key as keyof typeof counts.data]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1" data-tour="post-search">
          <label htmlFor="post-search" className="sr-only">Search articles</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" aria-hidden />
          <input id="post-search" type="search" className="input pl-9" placeholder="Search by title, URL or excerpt" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <label className="sr-only" htmlFor="cat-filter">Category</label>
          <select id="cat-filter" data-tip="Show one category only" className="input w-auto" value={categoryId} onChange={(e) => setParam('category', e.target.value || null)}>
            <option value="">All categories</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="sort">Sort</label>
          <select id="sort" data-tip="Change the order of the list" className="input w-auto" value={`${sort}:${dir}`} onChange={(e) => {
            const [s, d] = e.target.value.split(':');
            const p = new URLSearchParams(params); p.set('sort', s); p.set('dir', d); p.delete('page'); setParams(p, { replace: true });
          }}>
            <option value="updatedAt:desc">Last edited</option>
            <option value="publishedAt:desc">Newest published</option>
            <option value="publishedAt:asc">Oldest published</option>
            <option value="title:asc">Title A–Z</option>
            <option value="title:desc">Title Z–A</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-14 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-md bg-obsidian px-4 py-2.5 text-sm text-ivory lg:top-2" role="region" aria-label="Bulk actions">
          <span className="mr-2 font-medium">{selected.size} selected</span>
          {inTrash ? (
            <>
              <button className="btn btn-sm border border-white/20 hover:bg-white/10" disabled={busy} data-tip="Bring the selected articles back as drafts" onClick={() => run(() => adminPosts.restore(ids), `Restored ${ids.length}`)}>Restore</button>
              <button className="btn btn-sm btn-danger" disabled={busy} data-tip="Delete for good. This can’t be undone." onClick={() => setConfirm({ kind: 'delete', ids })}>Delete permanently</button>
            </>
          ) : (
            <>
              <button className="btn btn-sm border border-white/20 hover:bg-white/10" disabled={busy} data-tip="Make the selected articles live now" onClick={() => run(async () => {
                const r = await adminPosts.bulkStatus(ids, 'publish');
                if (r.skipped) throw new AppError('validation', `${r.done} published. ${r.skipped} need a title and some text first.`);
              }, 'Published')}>Publish</button>
              <button className="btn btn-sm border border-white/20 hover:bg-white/10" disabled={busy} data-tip="Take them off the blog and make them drafts" onClick={() => run(() => adminPosts.bulkStatus(ids, 'unpublish'), 'Moved to drafts')}>Unpublish</button>
              <button className="btn btn-sm border border-white/20 hover:bg-white/10" disabled={busy} data-tip="Hide them from the blog but keep them" onClick={() => run(() => adminPosts.bulkStatus(ids, 'archive'), 'Archived')}>Archive</button>
              <button className="btn btn-sm btn-danger" disabled={busy} data-tip="Remove from the blog. You can restore from Trash." onClick={() => setConfirm({ kind: 'trash', ids })}>Move to trash</button>
            </>
          )}
          <button className="ml-auto text-xs text-mist hover:text-ivory" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="mt-4 rounded-md border border-line bg-paper">
        {list.loading && !list.data ? (
          <div className="space-y-px">{[0, 1, 2, 3].map((i) => <div key={i} className="flex gap-4 p-4"><div className="skeleton h-12 w-12" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-1/2" /><div className="skeleton h-3 w-1/4" /></div></div>)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-serif text-xl">{dq ? `No articles match “${dq}”.` : inTrash ? 'The trash is empty.' : 'No articles here yet.'}</p>
            {!dq && !inTrash && <Link to="/admin/posts/new" className="btn btn-primary mt-5">Write an article</Link>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Articles</caption>
            <thead className="border-b border-line bg-ivory/60 text-left text-xs font-semibold text-stone">
              <tr>
                <th scope="col" className="w-10 py-3 pl-4" data-tour="select-all"><input type="checkbox" data-tip="Select every article on this page" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={allChecked} onChange={toggleAll} aria-label="Select all on this page" /></th>
                <th scope="col" className="py-3 pl-2 pr-4">Title</th>
                <th scope="col" className="hidden px-4 py-3 md:table-cell">Status</th>
                <th scope="col" className="hidden px-4 py-3 xl:table-cell">Category</th>
                <th scope="col" className="hidden px-4 py-3 md:table-cell">Date</th>
                <th scope="col" className="hidden px-4 py-3 text-right xl:table-cell">Comments</th>
                <th scope="col" className="w-12 py-3 pr-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className={selected.has(p.id) ? 'bg-copper/5' : 'hover:bg-ivory/50'}>
                  <td className="py-3 pl-4 align-middle"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.title}`} /></td>
                  <td className="w-full max-w-0 py-3 pl-2 pr-4">
                    <div className="flex items-center gap-3">
                      <Cover image={p.featuredImage} label={p.title} ratio="1 / 1" className="hidden w-11 shrink-0 rounded sm:block" />
                      <div className="min-w-0">
                        {inTrash ? <span className="font-medium">{p.title}</span> : (
                          <Link to={`/admin/posts/${p.id}/edit`} className="font-medium text-ink hover:text-accent-strong hover:underline">{p.title}</Link>
                        )}
                        {p.isFeatured && <Star className="ml-1.5 inline h-3.5 w-3.5 fill-copper text-copper" aria-label="Featured" />}
                        <p className="mt-0.5 truncate text-xs text-stone">/blog/{p.slug}</p>
                        <div className="mt-1.5 md:hidden"><StatusBadge status={p.display} /></div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell"><StatusBadge status={p.display} /></td>
                  <td className="hidden px-4 py-3 text-stone xl:table-cell">{p.category?.name ?? 'None'}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-stone md:table-cell">
                    {p.display === 'scheduled' ? <span title={formatDateTime(p.publishedAt)}>{formatDateTime(p.publishedAt)}</span>
                      : p.display === 'published' ? formatDate(p.publishedAt) : <span>Edited {formatDate(p.updatedAt)}</span>}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-right text-stone xl:table-cell">
                    {p.commentCount}{p.pendingCount > 0 && <Link to={`/admin/comments?post=${p.id}&status=pending`} className="ml-1.5 text-xs font-semibold text-warn">+{p.pendingCount} waiting</Link>}
                  </td>
                  <td className="py-3 pr-3 text-right"><ActionMenu label={`Actions for ${p.title}`} items={rowActions(p)} tip="Edit, preview, feature, duplicate or trash" tour={rows[0]?.id === p.id ? 'row-actions' : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-6">
        <Pagination page={page} total={list.data?.total ?? 0} pageSize={ADMIN_PAGE_SIZE} onChange={(n) => setParam('page', n > 1 ? String(n) : null)} />
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'trash'}
        onClose={() => setConfirm(null)}
        busy={busy}
        danger
        title={confirm && confirm.ids.length > 1 ? `Move ${confirm.ids.length} articles to the trash?` : 'Move this article to the trash?'}
        body="It disappears from the blog straight away. You can restore it from the Trash tab."
        confirmLabel="Move to trash"
        onConfirm={() => confirm && run(() => adminPosts.trash(confirm.ids), 'Moved to trash')}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        onClose={() => setConfirm(null)}
        busy={busy}
        danger
        title="Delete permanently?"
        body="The article, its revision history and its comments are deleted for good. This can’t be undone."
        confirmLabel="Delete permanently"
        onConfirm={() => confirm && run(() => adminPosts.deleteForever(confirm.ids), 'Deleted permanently')}
      />
    </>
  );
}
