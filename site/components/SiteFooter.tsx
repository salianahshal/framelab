import { focusRing, REPO, externalProps } from '../lib/ui';
import NewTabHint from './NewTabHint';

const links = [
  { label: 'GitHub', href: REPO },
  { label: 'MIT', href: `${REPO}/blob/main/LICENSE` },
];

export default function SiteFooter() {
  return (
    <footer className="px-5 py-10 sm:px-8">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <p className="font-mono text-[11px] text-offgray-500">
          Framelab — visual editor for Next.js + Tailwind
        </p>
        <ul className="flex items-center">
          {links.map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                {...externalProps(link.href)}
                className={`flex min-h-[44px] items-center px-3 font-mono text-[11px] text-offgray-500 transition-colors duration-150 hover:text-offgray-100 motion-reduce:transition-none ${focusRing}`}
              >
                {link.label}
                <NewTabHint href={link.href} />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
