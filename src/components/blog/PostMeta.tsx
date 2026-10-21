import { Link } from 'react-router-dom';
import type { Category } from '@/lib/types';
import { formatDate } from '@/lib/utils/format';

export function CategoryLink({ category, tone = 'light' }: { category: Category | null; tone?: 'light' | 'dark' }) {
  if (!category) return null;
  return (
    <Link
      to={`/blog/category/${category.slug}`}
      className={`relative z-10 text-[0.8rem] font-semibold ${tone === 'dark' ? 'text-copper hover:text-ivory' : 'text-accent-strong hover:text-ink'}`}
    >
      {category.name}
    </Link>
  );
}

export function DateAndTime({ date, minutes, tone = 'light' }: { date: string | null; minutes: number; tone?: 'light' | 'dark' }) {
  return (
    <p className={`flex items-center gap-2.5 text-[0.8rem] ${tone === 'dark' ? 'text-mist' : 'text-stone'}`}>
      {date && <time dateTime={date}>{formatDate(date)}</time>}
      {date && <span className="h-3 w-px bg-current opacity-40" aria-hidden />}
      <span>{minutes} min read</span>
    </p>
  );
}
