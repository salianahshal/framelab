import Link from 'next/link';
import { focusRing, seam, navLinks, externalProps, isExternal } from '../lib/ui';
import NewTabHint from './NewTabHint';

/**
 * Internal hrefs route client-side; external ones stay plain anchors, since
 * next/link would only add a prefetch we cannot use for another origin.
 */
function NavLink({ href, className, children }: {
  href: string; className: string; children: React.ReactNode;
}) {
  if (isExternal(href)) {
    return (
      <a href={href} {...externalProps(href)} className={className}>
        {children}
      </a>
    );
  }
  return <Link href={href} className={className}>{children}</Link>;
}

/**
 * The masthead, shared by every page so the nav is defined in one place.
 *
 * `cta` is the primary action on the right. The landing page points it at its
 * own install section; other pages send you there.
 */
export default function SiteHeader({ cta = '/#install' }: { cta?: string }) {
  return (
    <header className={`border-b ${seam}`}>
      <nav
        aria-label="Main"
        className="flex items-center justify-between px-5 py-3 sm:px-8"
      >
        <Link href="/" className={`flex items-center gap-2.5 py-2 ${focusRing}`}>
          <img
            src="/framelab-logo.svg"
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px]"
          />
          <span className="font-display text-[13px] font-semibold uppercase leading-none tracking-[0.2em] text-white">
            Framelab
          </span>
        </Link>

        <ul className="flex items-center">
          {navLinks.map((link) => (
            <li key={link.label}>
              <NavLink
                href={link.href}
                className={`flex min-h-[44px] items-center px-3 font-mono text-[12px] tracking-tight text-offgray-400 transition-colors duration-150 hover:text-white motion-reduce:transition-none ${focusRing}`}
              >
                {link.label}
                <NewTabHint href={link.href} />
              </NavLink>
            </li>
          ))}
          <li className="ml-2 hidden sm:block">
            <NavLink
              href={cta}
              className={`flex min-h-[36px] items-center rounded-[4px] bg-ember px-3.5 text-[13px] font-semibold text-black transition-colors duration-150 hover:bg-ember-bright motion-reduce:transition-none ${focusRing}`}
            >
              Get started
            </NavLink>
          </li>
        </ul>
      </nav>
    </header>
  );
}
