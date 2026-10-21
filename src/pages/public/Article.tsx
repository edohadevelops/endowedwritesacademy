import { Navigate, useParams } from 'react-router-dom';
import { publicApi } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useHead } from '@/features/seo/useHead';
import { useSite } from '@/context/SiteContext';
import { ArticleView } from '@/components/blog/ArticleView';
import NotFound from './NotFound';

export default function Article() {
  const { slug = '' } = useParams();
  const { settings } = useSite();
  const res = useAsync(() => publicApi.postBySlug(slug), [slug], ['posts']);
  const post = res.data?.kind === 'post' ? res.data.post : null;
  const related = useAsync(() => (post ? publicApi.related(post) : Promise.resolve([])), [post?.id]);
  const origin = settings.seo.siteUrl || window.location.origin;

  useHead(post ? {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    path: `/blog/${post.slug}`,
    image: post.featuredImage?.src,
    type: 'article',
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.seoDescription || post.excerpt,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      author: { '@type': 'Person', name: post.authorName },
      publisher: { '@type': 'Organization', name: settings.siteName },
      mainEntityOfPage: `${origin}/blog/${post.slug}`,
      ...(post.featuredImage?.src && /^https?:/.test(post.featuredImage.src) ? { image: [post.featuredImage.src] } : {}),
    },
  } : { title: res.loading ? 'Loading' : 'Article not found', noindex: !res.loading });

  if (res.loading) {
    return (
      <div className="container-site pt-16" aria-busy="true" aria-label="Loading article">
        <div className="mx-auto max-w-4xl space-y-5">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-12 w-full" />
          <div className="skeleton h-12 w-2/3" />
          <div className="skeleton mt-10 aspect-video w-full" />
        </div>
      </div>
    );
  }
  if (res.error) {
    return (
      <div className="container-site py-24 text-center">
        <h1 className="font-serif text-3xl">This article couldn’t load.</h1>
        <p className="mt-3 text-stone">Check your connection, then try again.</p>
        <button className="btn btn-outline mt-6" onClick={res.reload}>Try again</button>
      </div>
    );
  }
  if (res.data?.kind === 'redirect') return <Navigate to={`/blog/${res.data.slug}`} replace />;
  if (!res.data) return <NotFound />;

  return <ArticleView post={res.data.post} category={res.data.category} tags={res.data.tags} related={related.data ?? []} />;
}
