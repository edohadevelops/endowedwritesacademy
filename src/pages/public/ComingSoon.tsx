import { Link } from 'react-router-dom';
import { useHead } from '@/features/seo/useHead';
import { useSite } from '@/context/SiteContext';

/** Placeholder for academy pages planned in later phases. */
export default function ComingSoon({ title }: { title: string }) {
  const { settings } = useSite();
  useHead({ title, noindex: true });
  return (
    <section className="on-dark bg-obsidian text-ivory">
      <div className="container-site py-24 md:py-32">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-copper">{settings.siteName}</p>
          <h1 className="mt-3 font-serif text-5xl font-normal md:text-6xl">{title}</h1>
          <p className="mt-6 text-lg leading-relaxed text-mist">
            This part of the academy website is being prepared. In the meantime, the blog has study guides and articles you can read today.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/blog" className="btn btn-primary">Read the blog</Link>
            {settings.contactEmail && <a href={`mailto:${settings.contactEmail}`} className="btn border border-white/20 text-ivory hover:bg-white/5">Email the academy</a>}
          </div>
        </div>
      </div>
    </section>
  );
}
