import { useEffect, useState } from 'react';
import { Check, Link2, Share2 } from 'lucide-react';
import type { TocEntry } from '@/lib/utils/content';

export function ReadingProgress({ targetId }: { targetId: string }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = document.getElementById(targetId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const done = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
      setPct(done);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); };
  }, [targetId]);
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent" aria-hidden>
      <div className="h-full origin-left bg-copper" style={{ transform: `scaleX(${pct})` }} />
    </div>
  );
}

export function TableOfContents({ entries, variant }: { entries: TocEntry[]; variant: 'sidebar' | 'inline' }) {
  const [active, setActive] = useState<string | null>(entries[0]?.id ?? null);
  useEffect(() => {
    const els = entries.map((e) => document.getElementById(e.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (records) => {
        const visible = records.filter((r) => r.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-90px 0px -65% 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [entries]);

  const list = (
    <ol className="space-y-1 border-l border-line">
      {entries.map((e) => (
        <li key={e.id}>
          <a
            href={`#${e.id}`}
            aria-current={variant === 'sidebar' && active === e.id ? 'location' : undefined}
            className={`-ml-px block border-l-2 py-1.5 text-[0.88rem] leading-snug transition-colors ${e.level === 3 ? 'pl-7' : 'pl-4'} ${
              variant === 'sidebar' && active === e.id ? 'border-accent font-medium text-ink' : 'border-transparent text-stone hover:text-ink'
            }`}
          >
            {e.text}
          </a>
        </li>
      ))}
    </ol>
  );

  if (variant === 'inline') {
    return (
      <details className="group rounded-md border border-line bg-paper px-4 py-3">
        <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-sm font-semibold">
          In this article
          <span className="text-stone transition-transform group-open:rotate-45" aria-hidden>+</span>
        </summary>
        <nav aria-label="Table of contents" className="mt-3">{list}</nav>
      </details>
    );
  }
  return (
    <nav aria-label="Table of contents">
      <p className="mb-3 text-sm font-semibold text-ink">In this article</p>
      {list}
    </nav>
  );
}

export function ShareBar({ url, title, layout = 'row' }: { url: string; title: string; layout?: 'row' | 'column' }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const targets = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${title} ${url}`)}` },
    { label: 'X', href: `https://x.com/intent/post?url=${enc(url)}&text=${enc(title)}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}` },
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const t = document.createElement('textarea');
      t.value = url;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const item = 'inline-flex min-h-9 items-center gap-2 rounded px-2.5 text-[0.85rem] text-stone transition-colors hover:bg-ink/5 hover:text-ink';
  return (
    <div className={layout === 'column' ? 'flex flex-col items-start gap-0.5' : 'flex flex-wrap items-center gap-1'}>
      <p className={`text-sm font-semibold text-ink ${layout === 'column' ? 'mb-2' : 'mr-2'}`}>Share</p>
      <button className={item} onClick={copy} aria-live="polite">
        {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      {targets.map((t) => (
        <a key={t.label} className={item} href={t.href} target="_blank" rel="noopener noreferrer">{t.label}</a>
      ))}
      {canShare && (
        <button className={`${item} lg:hidden`} onClick={() => navigator.share({ title, url }).catch(() => {})}>
          <Share2 className="h-4 w-4" aria-hidden /> More
        </button>
      )}
    </div>
  );
}

export function Initials({ name, className = 'h-10 w-10 text-sm' }: { name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-obsidian font-semibold text-copper ${className}`} aria-hidden>
      {initials}
    </span>
  );
}
