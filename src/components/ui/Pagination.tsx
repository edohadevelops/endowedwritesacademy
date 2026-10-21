import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  label?: string;
}

function pagesToShow(page: number, last: number): (number | '…')[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const set = new Set([1, last, page - 1, page, page + 1].filter((p) => p >= 1 && p <= last));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function Pagination({ page, total, pageSize, onChange, label = 'Pagination' }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  const btn = 'inline-flex h-10 min-w-10 items-center justify-center rounded px-3 text-sm font-medium transition-colors';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1">
      <button className={`${btn} hover:bg-ink/5 disabled:opacity-40`} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Previous</span>
      </button>
      {pagesToShow(page, last).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-2 text-stone" aria-hidden>…</span>
        ) : (
          <button
            key={p}
            className={`${btn} ${p === page ? 'bg-obsidian text-ivory' : 'hover:bg-ink/5'}`}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ),
      )}
      <button className={`${btn} hover:bg-ink/5 disabled:opacity-40`} disabled={page >= last} onClick={() => onChange(page + 1)}>
        <span className="sr-only sm:not-sr-only">Next</span> <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </nav>
  );
}
