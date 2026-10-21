import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileText, PenSquare, MessageSquare, Image, FolderTree, Settings, LogOut, Menu, X, ExternalLink, Upload,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/hooks';
import { adminComments, backend } from '@/lib/data';
import { Logo } from '@/components/ui/Logo';
import { useHead } from '@/features/seo/useHead';
import { Initials } from '@/components/blog/ArticleParts';
import { TooltipLayer } from '@/features/onboarding/TooltipLayer';
import { PageTour, TourButton } from '@/features/onboarding/PageTour';
import type { TourId } from '@/features/onboarding/tours';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, tip: 'Overview of the blog and recent activity' },
  { to: '/admin/posts/new', label: 'New article', icon: PenSquare, end: true, tip: 'Start writing a new article' },
  { to: '/admin/posts', label: 'Articles', icon: FileText, end: false, tip: 'Every article: drafts, scheduled, published and trash' },
  { to: '/admin/import', label: 'Import articles', icon: Upload, end: false, tip: 'Upload many articles at once from files or Blogger' },
  { to: '/admin/comments', label: 'Comments', icon: MessageSquare, end: false, tip: 'Approve or remove reader comments' },
  { to: '/admin/media', label: 'Media', icon: Image, end: false, tip: 'Upload and manage images' },
  { to: '/admin/categories', label: 'Categories & tags', icon: FolderTree, end: false, tip: 'Organise the topics readers browse' },
  { to: '/admin/settings', label: 'Settings', icon: Settings, end: false, tip: 'Brand, menus, comments and your account' },
];

export function RequireAdmin() {
  const { user, loading, needsSetup } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center bg-ivory text-stone">Loading…</div>;
  if (needsSetup) return <Navigate to="/admin/setup" replace />;
  if (!user) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <AdminLayout />;
}

function AdminLayout() {
  useHead({ title: 'Admin', noindex: true });
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const pending = useAsync(() => adminComments.counts().then((c) => c.pending), [], ['comments']);
  useEffect(() => setOpen(false), [pathname]);

  const doSignOut = async () => {
    await signOut();
    navigate('/admin/login', { replace: true });
  };

  // The editor needs the full width; it has its own top bar.
  const isEditor = /^\/admin\/posts\/(new|[^/]+\/edit)/.test(pathname);

  const sidebar = (
    <div className="on-dark flex h-full flex-col bg-obsidian text-mist">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo to="/admin" />
        <button className="rounded p-2 hover:bg-white/5 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4" data-tour="admin-nav">
        <ul className="space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end, tip }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                data-tip={tip}
                {...(to === '/admin/posts/new' ? { 'data-tour': 'new-article-nav' } : {})}
                className={({ isActive }) =>
                  `flex min-h-10 items-center gap-3 rounded px-3 text-[0.92rem] transition-colors ${
                    isActive && !(to === '/admin/posts' && pathname === '/admin/posts/new') ? 'bg-accent text-white' : 'hover:bg-white/5 hover:text-ivory'
                  }`
                }
              >
                <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
                <span className="flex-1">{label}</span>
                {to === '/admin/comments' && (pending.data ?? 0) > 0 && (
                  <span className="rounded-full bg-copper px-2 py-0.5 text-[0.7rem] font-bold text-obsidian" aria-label={`${pending.data} waiting`}>{pending.data}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <a href="/blog" target="_blank" rel="noopener" data-tour="view-blog" data-tip="Open the public blog in a new tab" className="mt-6 flex min-h-10 items-center gap-3 rounded px-3 text-[0.92rem] hover:bg-white/5 hover:text-ivory">
          <ExternalLink className="h-[1.1rem] w-[1.1rem]" aria-hidden /> View blog
        </a>
      </nav>
      {!backend.shared && (
        <p className="mx-4 mb-3 rounded bg-white/5 px-3 py-2 text-xs leading-snug text-mist" data-tip="Connect Supabase to make articles visible to everyone (see MIGRATION.md)">
          Preview mode: articles are saved in this browser only.
        </p>
      )}
      <div className="border-t border-white/5 p-4">
        <div className="flex items-center gap-3">
          <Initials name={user?.displayName ?? ''} className="h-9 w-9 text-xs" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium text-ivory">{user?.displayName}</p>
            <p className="truncate text-xs">{user?.email}</p>
          </div>
          <button className="rounded p-2 hover:bg-white/5 hover:text-ivory" onClick={doSignOut} aria-label="Sign out" data-tip="Sign out of the admin">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ivory lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <div className="absolute inset-0 bg-obsidian/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        {!isEditor && (
          <div className="on-dark sticky top-0 z-30 flex h-14 items-center justify-between bg-obsidian px-4 lg:hidden">
            <button className="rounded p-2 text-ivory hover:bg-white/5" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <Logo to="/admin" />
            <span className="w-9" />
          </div>
        )}
        <main id="main" className={isEditor ? '' : 'mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-10'}>
          <Outlet context={{ openMenu: () => setOpen(true) }} />
        </main>
        <TooltipLayer />
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, tour }: { title: string; description?: string; actions?: React.ReactNode; tour?: TourId }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-serif text-3xl font-medium md:text-[2.2rem]">{title}</h1>
        {description && <p className="mt-1.5 text-stone">{description}</p>}
      </div>
      {(actions || tour) && (
        <div className="flex flex-wrap gap-2">
          {tour && <TourButton id={tour} />}
          {actions}
        </div>
      )}
      {tour && <PageTour id={tour} />}
    </div>
  );
}
