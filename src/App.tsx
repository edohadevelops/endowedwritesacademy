import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useRouteError, Link } from 'react-router-dom';
import { SiteProvider } from '@/context/SiteContext';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PublicLayout } from '@/components/layout/PublicLayout';
import BlogIndex from '@/pages/public/BlogIndex';
import Article from '@/pages/public/Article';
import NotFound from '@/pages/public/NotFound';
import ComingSoon from '@/pages/public/ComingSoon';

// The admin (and the editor in particular) is split out so readers never download it.
const RequireAdmin = lazy(() => import('@/components/layout/AdminLayout').then((m) => ({ default: m.RequireAdmin })));
const AdminLogin = lazy(() => import('@/pages/admin/AuthPages').then((m) => ({ default: m.AdminLogin })));
const AdminSetup = lazy(() => import('@/pages/admin/AuthPages').then((m) => ({ default: m.AdminSetup })));
const ResetPassword = lazy(() => import('@/pages/admin/AuthPages').then((m) => ({ default: m.ResetPassword })));
const Dashboard = lazy(() => import('@/pages/admin/Dashboard'));
const Posts = lazy(() => import('@/pages/admin/Posts'));
const PostEditor = lazy(() => import('@/pages/admin/PostEditor'));
const PostPreview = lazy(() => import('@/pages/admin/PostPreview'));
const Comments = lazy(() => import('@/pages/admin/Comments'));
const Media = lazy(() => import('@/pages/admin/Media'));
const Categories = lazy(() => import('@/pages/admin/Categories'));
const Settings = lazy(() => import('@/pages/admin/Settings'));
const ImportPage = lazy(() => import('@/pages/admin/Import'));

const load = (el: ReactNode) => (
  <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-sm text-stone">Loading…</div>}>{el}</Suspense>
);

function RouteError() {
  const err = useRouteError();
  console.error(err);
  return (
    <div className="container-site py-24">
      <h1 className="font-serif text-3xl">Something went wrong on this page.</h1>
      <p className="mt-3 text-stone">Reload the page to try again. If it keeps happening, let the site administrator know.</p>
      <div className="mt-6 flex gap-3">
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        <Link to="/blog" className="btn btn-outline">Go to the blog</Link>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      // The academy home page arrives in a later phase; the blog is home for now.
      { path: '/', element: <Navigate to="/blog" replace /> },
      { path: '/blog', element: <BlogIndex /> },
      { path: '/blog/category/:categorySlug', element: <BlogIndex /> },
      { path: '/blog/tag/:tagSlug', element: <BlogIndex /> },
      { path: '/blog/:slug', element: <Article /> },
      { path: '/about', element: <ComingSoon title="About the academy" /> },
      { path: '/courses', element: <ComingSoon title="Courses" /> },
      { path: '/contact', element: <ComingSoon title="Contact" /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '/admin/login', element: load(<AdminLogin />), errorElement: <RouteError /> },
  { path: '/admin/setup', element: load(<AdminSetup />), errorElement: <RouteError /> },
  { path: '/admin/reset-password', element: load(<ResetPassword />), errorElement: <RouteError /> },
  {
    path: '/admin',
    element: load(<RequireAdmin />),
    errorElement: <RouteError />,
    children: [
      { index: true, element: load(<Dashboard />) },
      { path: 'posts', element: load(<Posts />) },
      { path: 'posts/new', element: load(<PostEditor />) },
      { path: 'posts/:id/edit', element: load(<PostEditor />) },
      { path: 'comments', element: load(<Comments />) },
      { path: 'media', element: load(<Media />) },
      { path: 'categories', element: load(<Categories />) },
      { path: 'settings', element: load(<Settings />) },
      { path: 'import', element: load(<ImportPage />) },
    ],
  },
  // Outside the admin layout (full-page reader view), but still admin-only.
  { path: '/admin/posts/:id/preview', element: load(<RequireAdminPlain><PostPreview /></RequireAdminPlain>), errorElement: <RouteError /> },
]);

function RequireAdminPlain({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
const AdminGate = lazy(() => import('@/components/layout/AdminGate'));

export default function App() {
  return (
    <SiteProvider>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </SiteProvider>
  );
}
