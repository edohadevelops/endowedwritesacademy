import { Link } from 'react-router-dom';
import { useHead } from '@/features/seo/useHead';

export default function NotFound() {
  useHead({ title: 'Page not found', noindex: true });
  return (
    <section className="container-site py-24 md:py-32">
      <div className="max-w-xl">
        <p className="font-serif text-[7rem] leading-none text-accent/25" aria-hidden>404</p>
        <h1 className="mt-2 font-serif text-4xl">This page isn’t here.</h1>
        <p className="mt-4 text-lg text-stone">The link may be old, or the article may have moved. The blog has everything that’s currently published.</p>
        <Link to="/blog" className="btn btn-primary mt-8">Go to the blog</Link>
      </div>
    </section>
  );
}
