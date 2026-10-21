import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import DOMPurify from 'dompurify';
import type { Post, Category, Tag } from '@/lib/types';
import type { PostSummary } from '@/lib/data';
import { extractToc } from '@/lib/utils/content';
import { formatDate } from '@/lib/utils/format';
import { useSite } from '@/context/SiteContext';
import { Cover } from '@/components/ui/Cover';
import { ReadingProgress, TableOfContents, ShareBar, Initials } from './ArticleParts';
import { Comments } from './Comments';
import { SecondaryStory } from './PostCards';

interface Props {
  post: Post;
  category: Category | null;
  tags: Tag[];
  related?: PostSummary[];
  /** Admin preview: no comments form, no sharing. */
  preview?: boolean;
}

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'data-latex', 'data-type', 'data-media-id', 'target'],
    // KaTeX output uses inline styles for positioning; nothing else does.
  });

export function ArticleView({ post, category, tags, related = [], preview = false }: Props) {
  const { settings } = useSite();
  const toc = useMemo(() => extractToc(post.content), [post.content]);
  const html = useMemo(() => sanitize(post.contentHtml), [post.contentHtml]);
  const url = `${settings.seo.siteUrl || window.location.origin}/blog/${post.slug}`;
  const showToc = toc.length >= 3;
  const updated = post.publishedAt && new Date(post.updatedAt).getTime() - new Date(post.publishedAt).getTime() > 24 * 3600 * 1000;

  return (
    <article>
      {!preview && <ReadingProgress targetId="article-body" />}
      <header className="container-site pt-10 md:pt-16">
        <div className="mx-auto max-w-4xl">
          <nav aria-label="Breadcrumb" className="text-sm text-stone">
            <Link to="/blog" className="hover:text-ink">Blog</Link>
            {category && (
              <>
                <span className="mx-2" aria-hidden>/</span>
                <Link to={`/blog/category/${category.slug}`} className="hover:text-ink">{category.name}</Link>
              </>
            )}
          </nav>
          <h1 className="mt-5 font-serif text-[2.35rem] font-normal leading-[1.08] tracking-[-0.015em] text-ink sm:text-5xl md:text-[3.6rem]">
            {post.title}
          </h1>
          {post.excerpt && !post.contentText.replace(/\s+/g, ' ').startsWith(post.excerpt.replace(/…$/, '').trim()) && <p className="mt-5 max-w-[60ch] font-serif text-xl leading-relaxed text-stone md:text-[1.4rem]">{post.excerpt}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-4">
            <div className="flex items-center gap-3">
              <Initials name={post.authorName} />
              <div className="text-sm leading-tight">
                <p className="font-semibold text-ink">{post.authorName}</p>
                <p className="mt-0.5 text-stone">
                  {post.publishedAt ? <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time> : 'Not published yet'}
                  {updated && <>. Updated <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time></>}
                </p>
              </div>
            </div>
            <p className="text-sm text-stone">{post.readingMinutes} min read</p>
          </div>
        </div>
      </header>

      {post.featuredImage?.src && (
        <figure className="container-site mt-10">
          <div className="mx-auto max-w-5xl">
            <Cover image={post.featuredImage} ratio="16 / 9" priority className="rounded-md" />
          </div>
        </figure>
      )}

      <div className="container-site mt-10 md:mt-14">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
          <aside className="hidden lg:block">
            <div className="sticky top-28 space-y-10">
              {showToc && <TableOfContents entries={toc} variant="sidebar" />}
              {!preview && <ShareBar url={url} title={post.title} layout="column" />}
            </div>
          </aside>

          <div className="min-w-0 max-w-read">
            {showToc && <div className="mb-8 lg:hidden"><TableOfContents entries={toc} variant="inline" /></div>}
            <div
              id="article-body"
              className={`prose-article ${settings.showDropCap ? '' : 'no-dropcap'}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />

            {tags.length > 0 && (
              <ul className="mt-12 flex flex-wrap gap-2" aria-label="Tags">
                {tags.map((t) => (
                  <li key={t.id}><Link to={`/blog/tag/${t.slug}`} className="tag-pill hover:border-stone hover:text-ink">{t.name}</Link></li>
                ))}
              </ul>
            )}
            {!preview && <div className="mt-8 border-t border-line pt-6 lg:hidden"><ShareBar url={url} title={post.title} /></div>}
            {!preview && <Comments postId={post.id} open={settings.comments.enabled && post.commentsEnabled} />}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="container-site mt-24">
          <div className="border-t-2 border-ink pt-8">
            <h2 id="related-title" className="font-serif text-3xl font-medium">Keep reading</h2>
            <div className="mt-8 grid gap-12 md:grid-cols-3 md:gap-8">
              {related.map((p) => <SecondaryStory key={p.id} post={p} />)}
            </div>
          </div>
        </section>
      )}
    </article>
  );
}
