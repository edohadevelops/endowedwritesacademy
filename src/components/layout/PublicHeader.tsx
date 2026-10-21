import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, X } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { useSite } from '@/context/SiteContext';

export function PublicHeader() {
  const { settings } = useSite();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [location.pathname, location.search]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/blog?q=${encodeURIComponent(term)}` : '/blog');
  };

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `relative py-2 text-[0.92rem] transition-colors ${isActive ? 'text-ivory after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:bg-copper' : 'text-mist hover:text-ivory'}`;

  return (
    <header className="on-dark sticky top-0 z-40 border-b border-white/[0.06] bg-obsidian">
      <a href="#main" className="sr-only-focusable absolute left-4 top-3 z-50 rounded bg-copper px-3 py-2 text-sm font-semibold text-obsidian">
        Skip to content
      </a>
      <div className="container-site flex h-16 items-center justify-between gap-6 md:h-[4.5rem]">
        <Logo />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-8">
            {settings.navLinks.map((l) => (
              <li key={l.url + l.label}>
                {/^https?:/.test(l.url) ? (
                  <a href={l.url} className="py-2 text-[0.92rem] text-mist hover:text-ivory" rel="noopener noreferrer">{l.label}</a>
                ) : (
                  <NavLink to={l.url} className={linkCls}>{l.label}</NavLink>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded text-mist hover:bg-white/5 hover:text-ivory"
            onClick={() => setSearchOpen((v) => !v)}
            aria-expanded={searchOpen}
            aria-controls="site-search"
            aria-label="Search articles"
          >
            {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </button>
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded text-mist hover:bg-white/5 hover:text-ivory md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div id="site-search" className="border-t border-white/5 bg-obsidian">
          <form role="search" onSubmit={submit} className="container-site flex items-center gap-3 py-4">
            <label htmlFor="header-search" className="sr-only">Search articles</label>
            <Search className="h-5 w-5 shrink-0 text-copper" aria-hidden />
            <input
              id="header-search"
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search articles, topics and study tips"
              className="w-full bg-transparent font-serif text-xl text-ivory placeholder:text-mist/70 focus:outline-none md:text-2xl"
              onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
            />
            <button className="btn btn-primary shrink-0" type="submit">Search</button>
          </form>
        </div>
      )}

      {menuOpen && (
        <nav id="mobile-menu" aria-label="Main" className="border-t border-white/5 bg-obsidian md:hidden">
          <ul className="container-site flex flex-col py-3">
            {settings.navLinks.map((l) => (
              <li key={l.url + l.label}>
                <NavLink
                  to={l.url}
                  className={({ isActive }) => `flex min-h-12 items-center border-b border-white/5 font-serif text-xl ${isActive ? 'text-copper' : 'text-ivory'}`}
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
