import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { publicApi, taxonomy, type PostSummary } from '@/lib/data';
import { useAsync } from '@/lib/hooks';
import { useSite } from '@/context/SiteContext';
import { useHead } from '@/features/seo/useHead';
import { PAGE_SIZE } from '@/config/defaults';
import { Cover } from '@/components/ui/Cover';
import { Pagination } from '@/components/ui/Pagination';
import { LeadStory, SecondaryStory, StoryRow } from '@/components/blog/PostCards';
import { DateAndTime } from '@/components/blog/PostMeta';
import { SmartLink } from '@/components/ui/SmartLink';
import NotFound from './NotFound';

function FeaturedCover({ post }: { post: PostSummary }) {
  return (
    <article className="group relative overflow-hidden rounded-md bg-charcoal shadow-cover">
      <Cover image={post.featuredImage} label={post.category?.name ?? post.title} ratio="4 / 5" priority className="transition-transform duration-700 ease-out group-hover:scale-[1.02]" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-obsidian via-obsidian/85 to-transparent px-6 pb-6 pt-24 sm:px-8 sm:pb-8">
        <p className="text-[0.8rem] font-semibold text-copper">Featured{post.category ? ` in ${post.category.name}` : ''}</p>
        <h2 className="mt-2 font-serif text-2xl font-medium leading-tight text-ivory sm:text-[2rem]">
          <Link to={`/blog/${post.slug}`} className="after:absolute after:inset-0 after:content-['']">{post.title}</Link>
        </h2>
        <div className="mt-4"><DateAndTime date={post.publishedAt} minutes={post.readingMinutes} tone="dark" /></div>
      </div>
    </article>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[15rem_1fr] sm:gap-7">
          <div className="skeleton aspect-[4/3]" />
          <div className="space-y-3 self-center"><div className="skeleton h-3 w-24" /><div className="skeleton h-6 w-3/4" /><div className="skeleton h-4 w-full" /></div>
        </div>
      ))}
    </div>
  );
}

export default function BlogIndex() {
  const { categorySlug, tagSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { settings } = useSite();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const isHome = !categorySlug && !tagSlug && !q;
  const featured = useAsync(() => publicApi.featured(), [], ['posts']);
  const cats = useAsync(() => taxonomy.publicCategories(), [], ['posts', 'categories']);
  const list = useAsync(
    () => publicApi.listPosts({
      page, pageSize: PAGE_SIZE, q, categorySlug, tagSlug,
      excludeIds: isHome && featured.data ? [featured.data.id] : [],
    }),
    [page, q, categorySlug, tagSlug, isHome, featured.data?.id],
    ['posts'],
  );

  const heading = list.data?.category?.name ?? (list.data?.tag ? `Tagged “${list.data.tag.name}”` : null);
  useHead({
    title: heading ?? (q ? `Search: ${q}` : 'Blog'),
    description: list.data?.category?.description || undefined,
    path: categorySlug ? `/blog/category/${categorySlug}` : tagSlug ? `/blog/tag/${tagSlug}` : '/blog',
    noindex: Boolean(q),
  });

  if (!list.loading && (categorySlug && !list.data?.category || tagSlug && !list.data?.tag)) return <NotFound />;

  const go = (next: number) => {
    const p = new URLSearchParams(params);
    if (next <= 1) p.delete('page'); else p.set('page', String(next));
    setParams(p);
    document.getElementById('articles')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const base = categorySlug ? `/blog/category/${categorySlug}` : '/blog';
    navigate(draft.trim() ? `/blog?q=${encodeURIComponent(draft.trim())}` : base);
  };

  const items = list.data?.items ?? [];
  const showLeadLayout = isHome && page === 1 && items.length >= 3;
  const lead = showLeadLayout ? items[0] : null;
  const secondaries = showLeadLayout ? items.slice(1, 3) : [];
  const rows = showLeadLayout ? items.slice(3) : items;
  const nothingPublished = isHome && !featured.loading && !featured.data;

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      {isHome ? (
        <section className="on-dark bg-obsidian text-ivory">
          <div className="container-site grid grid-cols-1 items-end gap-10 pt-14 md:pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
            <div className="animate-rise pb-6 lg:pb-40">
              <p className="text-sm font-medium text-copper">The {settings.siteName.replace(/^the\s+/i, '')} blog</p>
              <h1 className="mt-4 max-w-[14ch] font-serif text-[2.7rem] font-normal leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-[4.9rem]">
                {settings.heroTitle}
              </h1>
              <p className="mt-6 max-w-[46ch] text-[1.05rem] leading-relaxed text-mist md:text-lg">{settings.heroIntro}</p>
              <a href="#articles" className="btn btn-primary mt-8">Browse articles</a>
            </div>
            {/* Fixed-ratio frame so swapping skeleton → content never shifts layout. */}
            <div className="relative -mb-28 aspect-[4/5] sm:-mb-36 lg:-mb-24">
              {featured.loading ? (
                <div key="loading" className="skeleton absolute inset-0 bg-white/10" />
              ) : featured.data ? (
                <div key="post" className="absolute inset-0"><FeaturedCover post={featured.data} /></div>
              ) : (
                <div key="empty" className="absolute inset-0 flex items-end rounded-md border border-white/10 bg-charcoal p-8">
                  <p className="font-serif text-2xl text-mist">The first article will appear here once it’s published.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="on-dark bg-obsidian text-ivory">
          <div className="container-site py-14 md:py-16">
            <nav aria-label="Breadcrumb" className="text-sm text-mist">
              <Link to="/blog" className="hover:text-ivory">Blog</Link>
              <span className="mx-2" aria-hidden>/</span>
              <span className="text-ivory">{heading ?? 'Search'}</span>
            </nav>
            <h1 className="mt-4 font-serif text-4xl font-normal md:text-5xl">{heading ?? `Results for “${q}”`}</h1>
            {list.data?.category?.description && <p className="mt-3 max-w-xl text-mist">{list.data.category.description}</p>}
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- articles */}
      <section id="articles" className={`container-site scroll-mt-24 ${isHome ? 'pt-40 sm:pt-48 lg:pt-36' : 'pt-12'}`}>
        <div className="flex flex-col gap-5 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="font-serif text-3xl font-medium md:text-4xl">{isHome ? 'Latest articles' : `${list.data?.total ?? 0} ${list.data?.total === 1 ? 'article' : 'articles'}`}</h2>
          </div>
          <form role="search" onSubmit={submit} className="relative w-full lg:w-80">
            <label htmlFor="blog-search" className="sr-only">Search articles</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" aria-hidden />
            <input id="blog-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search articles" className="input pl-9 pr-9" type="search" />
            {q && (
              <Link to="/blog" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone hover:text-ink" aria-label="Clear search"><X className="h-4 w-4" /></Link>
            )}
          </form>
        </div>

        {(cats.data?.length ?? 0) > 0 && (
          <nav aria-label="Topics" className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 pb-1">
            <Link to="/blog" className={`tag-pill shrink-0 ${isHome ? 'border-obsidian bg-obsidian text-ivory' : 'hover:border-stone hover:text-ink'}`} aria-current={isHome ? 'page' : undefined}>All</Link>
            {cats.data!.map((c) => {
              const active = c.slug === categorySlug;
              return (
                <Link key={c.id} to={`/blog/category/${c.slug}`} aria-current={active ? 'page' : undefined}
                  className={`tag-pill shrink-0 ${active ? 'border-obsidian bg-obsidian text-ivory' : 'hover:border-stone hover:text-ink'}`}>
                  {c.name}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="mt-10 min-h-[50vh]" aria-live="polite" aria-busy={list.loading}>
          {list.loading && !list.data ? (
            <ListSkeleton />
          ) : list.error ? (
            <div className="rounded-md border border-line bg-paper p-8 text-center">
              <p className="font-serif text-xl">Articles couldn’t load.</p>
              <button className="btn btn-outline mt-4" onClick={list.reload}>Try again</button>
            </div>
          ) : items.length === 0 ? (
            <div className="mx-auto max-w-md py-16 text-center">
              <p className="font-serif text-2xl">
                {nothingPublished ? 'No articles yet.' : q ? `Nothing matches “${q}”.` : 'No articles here yet.'}
              </p>
              <p className="mt-3 text-stone">
                {nothingPublished ? 'New articles will appear here as soon as they’re published.' : q ? 'Try a shorter search, or browse a topic above.' : 'Browse another topic, or see all articles.'}
              </p>
              {!nothingPublished && <Link to="/blog" className="btn btn-outline mt-6">See all articles</Link>}
            </div>
          ) : (
            <>
              {lead && <LeadStory post={lead} />}
              {secondaries.length > 0 && (
                <div className="mt-14 grid gap-12 border-t border-line pt-12 md:grid-cols-2 md:gap-10">
                  {secondaries.map((p) => <SecondaryStory key={p.id} post={p} />)}
                </div>
              )}
              {rows.length > 0 && (
                <div className={`divide-y divide-line ${showLeadLayout ? 'mt-14 border-t border-line' : ''}`}>
                  {rows.map((p) => <StoryRow key={p.id} post={p} />)}
                </div>
              )}
              <div className="mt-12">
                <Pagination page={page} total={list.data!.total} pageSize={PAGE_SIZE} onChange={go} label="Article pages" />
              </div>
            </>
          )}
        </div>
      </section>

      {isHome && settings.cta && (
        <section className="container-site mt-24">
          <div className="on-dark grid gap-6 rounded-lg bg-charcoal px-6 py-10 text-ivory sm:px-10 md:grid-cols-[1fr_auto] md:items-center md:py-12">
            <div>
              <h2 className="font-serif text-3xl font-normal">{settings.cta.title}</h2>
              <p className="mt-2 max-w-xl text-mist">{settings.cta.text}</p>
            </div>
            <SmartLink href={settings.cta.href} className="btn btn-primary justify-self-start">{settings.cta.label}</SmartLink>
          </div>
        </section>
      )}
    </>
  );
}
