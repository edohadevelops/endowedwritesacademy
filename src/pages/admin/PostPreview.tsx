import { Link, useParams } from 'react-router-dom';
import { adminPosts, taxonomy, displayStatus } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useHead } from '@/features/seo/useHead';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { ArticleView } from '@/components/blog/ArticleView';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PageTour } from '@/features/onboarding/PageTour';

/**
 * Private preview. Lives under /admin so it requires a signed-in admin, and
 * the data call itself refuses anyone else, so drafts never leak.
 */
export default function PostPreview() {
  const { id = '' } = useParams();
  useHead({ title: 'Preview', noindex: true });
  const res = useAsync(async () => {
    const post = await adminPosts.get(id);
    const { renderArticleHtml } = await import('@/features/content/render');
    const [cats, tags] = await Promise.all([taxonomy.categories(), taxonomy.tags()]);
    return {
      post: { ...post, contentHtml: renderArticleHtml(post.content) },
      category: cats.find((c) => c.id === post.categoryId) ?? null,
      tags: tags.filter((t) => post.tagIds.includes(t.id)),
    };
  }, [id], ['posts']);

  if (res.loading) return <div className="grid min-h-screen place-items-center text-stone">Loading preview…</div>;
  if (!res.data) return <div className="p-10 text-center">This article couldn’t be previewed. <Link to="/admin/posts" className="underline">Back to articles</Link></div>;

  return (
    <div className="min-h-screen bg-ivory pb-24">
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-copper px-4 py-2 text-sm font-medium text-obsidian" data-tour="preview-banner">
        <span>Preview only. Readers can’t see this page.</span>
        <StatusBadge status={displayStatus(res.data.post)} />
        <Link to={`/admin/posts/${id}/edit`} className="underline underline-offset-2">Back to editing</Link>
      </div>
      <PublicHeader />
      <ArticleView post={res.data.post} category={res.data.category} tags={res.data.tags} preview />
      <PageTour id="preview" />
    </div>
  );
}
