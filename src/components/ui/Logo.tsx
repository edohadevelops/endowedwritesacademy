import { Link } from 'react-router-dom';
import { useSite } from '@/context/SiteContext';

export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  // An "E" whose bars step outward like lines of a page being written.
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="7" fill="rgb(var(--obsidian))" />
      <rect x="10" y="9" width="4.5" height="22" fill="rgb(var(--copper))" />
      <rect x="10" y="9" width="19" height="4.5" fill="rgb(var(--copper))" />
      <rect x="10" y="17.75" width="13" height="4.5" fill="rgb(var(--copper))" />
      <rect x="10" y="26.5" width="21" height="4.5" fill="rgb(var(--copper))" />
    </svg>
  );
}

export function Logo({ tone = 'dark', to = '/blog' }: { tone?: 'dark' | 'light'; to?: string }) {
  const { settings, logoUrl } = useSite();
  // A leading "The" is set in the highlight colour before the main word: "The Endowed / Academy".
  const words = settings.siteName.trim().split(/\s+/);
  const lead = words.length > 2 && /^the$/i.test(words[0]) ? words.shift() : null;
  const [first, ...rest] = words;
  return (
    <Link to={to} className="group inline-flex items-center gap-2.5" aria-label={`${settings.siteName} home`}>
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-9 w-auto max-w-[9rem] object-contain" />
      ) : (
        <>
          <LogoMark className={`h-9 w-9 ${tone === 'light' ? '' : 'ring-1 ring-white/10 rounded-[7px]'}`} />
          <span className="flex flex-col leading-none">
            <span className={`font-serif text-[1.3rem] font-medium tracking-tight ${tone === 'light' ? 'text-ink' : 'text-ivory'}`}>
              {lead && <span className={`mr-1 ${tone === 'light' ? 'text-accent' : 'text-copper'}`}>{lead}</span>}
              {first}
            </span>
            {rest.length > 0 && (
              <span className={`mt-0.5 text-[0.7rem] font-medium tracking-[0.14em] ${tone === 'light' ? 'text-stone' : 'text-mist'}`}>{rest.join(' ')}</span>
            )}
          </span>
        </>
      )}
    </Link>
  );
}
