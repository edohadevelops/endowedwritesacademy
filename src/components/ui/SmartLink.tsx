import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Router link for internal paths, plain anchor for external/mailto. */
export function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    const external = /^https?:/.test(href);
    return (
      <a href={href} className={className} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  }
  return <Link to={href || '/'} className={className}>{children}</Link>;
}
