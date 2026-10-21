import { Link } from 'react-router-dom';
import { PenSquare } from 'lucide-react';
import { dashboard } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/layout/AdminLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Cover } from '@/components/ui/Cover';
import { formatDateTime, timeAgo } from '@/lib/utils/format';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading } = useAsync(() => dashboard.overview(), [], ['posts', 'comments', 'audit']);
  const first = user?.displayName.split(' ')[0];

  const stats = data ? [
    { label: 'Published', value: data.counts.published, to: '/admin/posts?status=published' },
    { label: 'Drafts', value: data.counts.draft, to: '/admin/posts?status=draft' },
    { label: 'Scheduled', value: data.counts.scheduled, to: '/admin/posts?status=scheduled' },
    { label: 'Comments waiting', value: data.pendingComments, to: '/admin/comments?status=pending', highlight: data.pendingComments > 0 },
    { label: 'Approved comments', value: data.approvedComments, to: '/admin/comments?status=approved' },
  ] : [];

  return (
    <>
      <PageHeader
        title={`${greeting()}${first ? `, ${first}` : ''}`}
        description="Here’s where the blog stands today."
        tour="dashboard"
        actions={<Link to="/admin/posts/new" className="btn btn-primary" data-tour="new-article" data-tip="Start a new article. It saves as you type."><PenSquare className="h-4 w-4" aria-hidden />New article</Link>}
      />

      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-5" aria-label="Blog totals" data-tour="stats">
        {loading && !data
          ? Array.from({ length: 5 }, (_, i) => <li key={i} className="bg-paper p-5"><div className="skeleton h-8 w-12" /><div className="skeleton mt-2 h-3 w-20" /></li>)
          : stats.map((s) => (
            <li key={s.label} className="bg-paper">
              <Link to={s.to} className="group block h-full p-5 transition-colors hover:bg-ivory" data-tip={`Show ${s.label.toLowerCase()}`}>
                <span className={`block font-serif text-4xl ${s.highlight ? 'text-accent' : 'text-ink'}`}>{s.value}</span>
                <span className="mt-1 block text-sm text-stone group-hover:text-ink">{s.label}</span>
              </Link>
            </li>
          ))}
      </ul>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="recent-title" data-tour="recent">
          <div className="flex items-baseline justify-between">
            <h2 id="recent-title" className="font-serif text-2xl font-medium">Recently edited</h2>
            <Link to="/admin/posts" className="text-sm font-medium text-accent-strong hover:underline">All articles</Link>
          </div>
          {data && data.recent.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-line bg-paper p-8 text-center">
              <p className="font-serif text-xl">Nothing written yet.</p>
              <p className="mt-1 text-sm text-stone">Start the first article, or bring older articles in with Import articles.</p>
              <Link to="/admin/posts/new" className="btn btn-primary mt-5">Write the first article</Link>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-md border border-line bg-paper">
              {(data?.recent ?? []).map((p) => (
                <li key={p.id}>
                  <Link to={`/admin/posts/${p.id}/edit`} className="flex items-center gap-4 p-3 transition-colors hover:bg-ivory">
                    <Cover image={p.featuredImage} label={p.title} ratio="1 / 1" className="w-12 shrink-0 rounded" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.title}</p>
                      <p className="text-xs text-stone">Edited {timeAgo(p.updatedAt)}</p>
                    </div>
                    <StatusBadge status={p.display} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-10">
          {data && data.upcoming.length > 0 && (
            <section aria-labelledby="upcoming-title">
              <h2 id="upcoming-title" className="font-serif text-2xl font-medium">Scheduled</h2>
              <ul className="mt-4 space-y-3">
                {data.upcoming.map((p) => (
                  <li key={p.id} className="rounded-md border border-line bg-paper p-4">
                    <Link to={`/admin/posts/${p.id}/edit`} className="font-medium hover:underline">{p.title}</Link>
                    <p className="mt-1 text-sm text-stone">Goes live {formatDateTime(p.publishedAt)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="activity-title" data-tour="activity">
            <h2 id="activity-title" className="font-serif text-2xl font-medium">Activity</h2>
            {data && data.activity.length === 0 ? (
              <p className="mt-3 text-sm text-stone">Publishing and editing activity will show here.</p>
            ) : (
              <ol className="mt-4 space-y-3 border-l border-line pl-4">
                {(data?.activity ?? []).map((a) => (
                  <li key={a.id} className="relative text-sm">
                    <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-copper" aria-hidden />
                    <p><span>{a.action.charAt(0).toUpperCase() + a.action.slice(1)}</span> {a.target !== 'site' && a.target !== 'articles' && a.target !== 'import' && <span className="font-medium">“{a.target}”</span>}</p>
                    <p className="text-xs text-stone">{timeAgo(a.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
