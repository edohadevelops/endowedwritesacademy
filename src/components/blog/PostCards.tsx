import { Link } from 'react-router-dom';
import type { PostSummary } from '@/lib/data';
import { Cover } from '@/components/ui/Cover';
import { CategoryLink, DateAndTime } from './PostMeta';

// Whole-card click target via a stretched link; category stays separately clickable.
const stretched = 'after:absolute after:inset-0 after:content-[""]';

export function LeadStory({ post }: { post: PostSummary }) {
  return (
    <article className="group relative grid gap-6 md:grid-cols-12 md:items-center md:gap-10">
      <Cover image={post.featuredImage} label={post.category?.name ?? post.title} className="rounded-md md:col-span-7" ratio="3 / 2" />
      <div className="md:col-span-5">
        <CategoryLink category={post.category} />
        <h3 className="mt-2 font-serif text-3xl font-medium leading-tight text-ink md:text-4xl">
          <Link to={`/blog/${post.slug}`} className={`${stretched} decoration-accent decoration-1 underline-offset-[6px] group-hover:underline`}>{post.title}</Link>
        </h3>
        <p className="mt-4 text-[1.02rem] leading-relaxed text-stone">{post.excerpt}</p>
        <div className="mt-5"><DateAndTime date={post.publishedAt} minutes={post.readingMinutes} /></div>
      </div>
    </article>
  );
}

export function SecondaryStory({ post }: { post: PostSummary }) {
  return (
    <article className="group relative">
      <Cover image={post.featuredImage} label={post.category?.name ?? post.title} className="rounded-md" ratio="16 / 10" />
      <div className="mt-4">
        <CategoryLink category={post.category} />
        <h3 className="mt-1.5 font-serif text-2xl font-medium leading-snug text-ink">
          <Link to={`/blog/${post.slug}`} className={`${stretched} decoration-accent decoration-1 underline-offset-[5px] group-hover:underline`}>{post.title}</Link>
        </h3>
        <p className="mt-2 line-clamp-2 text-[0.97rem] leading-relaxed text-stone">{post.excerpt}</p>
        <div className="mt-3"><DateAndTime date={post.publishedAt} minutes={post.readingMinutes} /></div>
      </div>
    </article>
  );
}

export function StoryRow({ post }: { post: PostSummary }) {
  return (
    <article className="group relative grid grid-cols-[6.5rem_1fr] gap-4 py-6 sm:grid-cols-[12rem_1fr] sm:gap-7 md:grid-cols-[15rem_1fr]">
      <Cover image={post.featuredImage} label={post.category?.name ?? post.title} className="rounded" ratio="4 / 3" />
      <div className="min-w-0 self-center">
        <CategoryLink category={post.category} />
        <h3 className="mt-1 font-serif text-lg font-medium leading-snug text-ink sm:text-[1.45rem]">
          <Link to={`/blog/${post.slug}`} className={`${stretched} decoration-accent decoration-1 underline-offset-4 group-hover:underline`}>{post.title}</Link>
        </h3>
        <div className="mt-2 hidden sm:block"><p className="line-clamp-2 text-[0.97rem] leading-relaxed text-stone">{post.excerpt}</p></div>
        <div className="mt-2.5"><DateAndTime date={post.publishedAt} minutes={post.readingMinutes} /></div>
      </div>
    </article>
  );
}

export function CompactStory({ post }: { post: PostSummary }) {
  return (
    <article className="group relative grid grid-cols-[5.5rem_1fr] gap-4">
      <Cover image={post.featuredImage} label={post.category?.name ?? post.title} className="rounded" ratio="1 / 1" />
      <div className="min-w-0">
        <h3 className="font-serif text-[1.08rem] font-medium leading-snug text-ink">
          <Link to={`/blog/${post.slug}`} className={`${stretched} group-hover:underline decoration-accent underline-offset-4`}>{post.title}</Link>
        </h3>
        <div className="mt-1.5"><DateAndTime date={post.publishedAt} minutes={post.readingMinutes} /></div>
      </div>
    </article>
  );
}
