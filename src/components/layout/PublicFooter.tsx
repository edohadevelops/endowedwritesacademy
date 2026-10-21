import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { useSite } from '@/context/SiteContext';
import { useAsync } from '@/lib/hooks';
import { taxonomy } from '@/lib/data';

export function PublicFooter() {
  const { settings } = useSite();
  const { data: cats } = useAsync(() => taxonomy.publicCategories(), [], ['posts', 'categories']);
  const year = new Date().getFullYear();

  return (
    <footer className="on-dark mt-24 bg-obsidian text-mist">
      <div className="container-site grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-5 text-sm leading-relaxed">{settings.tagline}.</p>
          {settings.contactEmail && (
            <a href={`mailto:${settings.contactEmail}`} className="mt-4 inline-block text-sm text-ivory underline-offset-4 hover:underline">
              {settings.contactEmail}
            </a>
          )}
        </div>

        <div>
          <h2 className="font-sans text-sm font-semibold text-ivory">Academy</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {settings.navLinks.map((l) => (
              <li key={l.url + l.label}><Link to={l.url} className="hover:text-ivory">{l.label}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-sans text-sm font-semibold text-ivory">Topics</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {(cats ?? []).slice(0, 6).map((c) => (
              <li key={c.id}><Link to={`/blog/category/${c.slug}`} className="hover:text-ivory">{c.name}</Link></li>
            ))}
            {cats && cats.length === 0 && <li>Topics appear as articles are published.</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5">
        <div className="container-site flex flex-col gap-3 py-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {settings.siteName}. {settings.footerText}</p>
          {settings.socialLinks.length > 0 && (
            <ul className="flex flex-wrap gap-5" aria-label="Social media">
              {settings.socialLinks.map((s) => (
                <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-ivory">{s.label}</a></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </footer>
  );
}
