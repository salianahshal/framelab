import Head from 'next/head';
import { useState } from 'react';

const INSTALL_COMMAND = 'npx framelab';

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-light focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/* Hairline seam colour, repeated often enough to be worth a constant. */
const seam = 'border-offgray-900';

function CursorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 3.5 18 11l-5.6 1.6L10 18.5 5 3.5Z" />
    </svg>
  );
}

function SlidersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5 6h14M5 12h14M5 18h14" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </svg>
  );
}

function DiffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 3v10a3 3 0 0 0 3 3h6" />
      <path d="m12 13 3 3-3 3" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
    </svg>
  );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/* Small register mark used at section corners — purely decorative. */
function Tick({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute select-none font-mono text-[10px] leading-none text-offgray-600 ${className}`}
    >
      +
    </span>
  );
}

const isExternal = (href: string) => href.startsWith('http');

/* Off-site links open in a new tab; rel guards against tabnabbing. */
function externalProps(href: string) {
  return isExternal(href)
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
}

/* Screen readers get no visual cue that a link leaves the page. */
function NewTabHint({ href }: { href: string }) {
  return isExternal(href) ? (
    <span className="sr-only"> (opens in a new tab)</span>
  ) : null;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-offgray-400">
      {children}
    </p>
  );
}

const features = [
  {
    icon: CursorIcon,
    n: '01',
    title: 'Click to inspect',
    body: 'Every element on the canvas resolves to a file and a line number. You always know what you are about to change.',
  },
  {
    icon: SlidersIcon,
    n: '02',
    title: 'Edit against your theme',
    body: 'Colors, spacing, and layout are driven by the tokens already in your tailwind.config. No memorizing class names.',
  },
  {
    icon: DiffIcon,
    n: '03',
    title: 'Byte-clean diffs',
    body: 'AST-level writes touch only the classes you changed. Review the hunk, revert it, or commit it like any other edit.',
  },
];

const steps = [
  {
    n: '01',
    cmd: 'framelab init',
    body: 'Writes babel.config.js and the .env wiring into your existing Next.js app.',
  },
  {
    n: '02',
    cmd: 'framelab',
    body: 'Boots the sync server and opens your app in an editable canvas on port 3133.',
  },
  {
    n: '03',
    cmd: 'git diff',
    body: 'Changes land in your source as you make them. Your review workflow is unchanged.',
  },
];

const specs = [
  { label: 'Runs on', value: 'Your machine' },
  { label: 'Requires', value: 'Node 18+' },
  { label: 'Editors', value: 'Claude Code · Cursor · Continue' },
  { label: 'License', value: 'MIT' },
];

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Install', href: '#install' },
  { label: 'GitHub', href: 'https://github.com/salianahshal/framelab' },
];

export default function Home() {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context) — the command stays selectable as text.
    }
  }

  return (
    <>
      <Head>
        <title>Framelab</title>
        <meta
          name="description"
          content="Click any element in your running Next.js app, tweak its Tailwind classes visually, and Framelab writes the change straight back to your source."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <a
        href="#main"
        className={`sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black ${focusRing}`}
      >
        Skip to main content
      </a>

      <div className="min-h-dvh bg-surface text-offgray-50 antialiased">
        {/* Rails: the vertical hairlines that frame every section. */}
        <div className={`mx-auto max-w-6xl border-x ${seam}`}>
          <header className={`border-b ${seam}`}>
            <nav
              aria-label="Main"
              className="flex items-center justify-between px-5 py-3 sm:px-8"
            >
              <a href="/" className={`flex items-center gap-2.5 py-2 ${focusRing}`}>
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
              </a>

              <ul className="flex items-center">
                {navLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...externalProps(link.href)}
                      className={`flex min-h-[44px] items-center px-3 font-mono text-[12px] tracking-tight text-offgray-400 transition-colors duration-150 hover:text-white motion-reduce:transition-none ${focusRing}`}
                    >
                      {link.label}
                      <NewTabHint href={link.href} />
                    </a>
                  </li>
                ))}
                <li className="ml-2 hidden sm:block">
                  <a
                    href="#install"
                    className={`flex min-h-[36px] items-center rounded-[4px] bg-ember px-3.5 text-[13px] font-semibold text-black transition-colors duration-150 hover:bg-ember-bright motion-reduce:transition-none ${focusRing}`}
                  >
                    Get started
                  </a>
                </li>
              </ul>
            </nav>
          </header>

          <main id="main">
            {/* Hero */}
            <section
              className={`relative overflow-hidden border-b ${seam} px-5 py-20 sm:px-8 sm:py-28`}
            >
              {/* Watermark: crops against the right rail. Hidden below lg, where
                  it would collide with the headline. */}
              <img
                src="/framelab-logo.svg"
                alt=""
                aria-hidden="true"
                width={480}
                height={480}
                className="pointer-events-none absolute -right-10 top-1/2 hidden h-[400px] w-[400px] -translate-y-1/2 select-none opacity-[0.055] lg:block xl:h-[480px] xl:w-[480px]"
              />

              <Tick className="left-2 top-2" />
              <Tick className="right-2 top-2" />

              <div className="relative max-w-3xl">
                <Eyebrow>Visual editor · Next.js + Tailwind</Eyebrow>

                <h1 className="mt-6 text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] text-white sm:text-6xl md:text-7xl">
                  Edit your UI{' '}
                  <span className="font-serif italic tracking-[-0.01em] text-cream-100">
                    where it lives.
                  </span>
                </h1>

                <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-offgray-300">
                  Framelab runs next to your dev server. Click any element on the
                  canvas, adjust its Tailwind classes, and the change is written
                  straight back into your source file — no cloud, no sandbox, no
                  copy-paste step.
                </p>

                <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <a
                    href="#install"
                    className={`inline-flex min-h-[46px] items-center justify-center rounded-[4px] bg-ember px-6 text-[14px] font-semibold text-black transition-colors duration-150 hover:bg-ember-bright motion-reduce:transition-none ${focusRing}`}
                  >
                    Get started
                  </a>
                  <a
                    href="https://github.com/salianahshal/framelab"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex min-h-[46px] items-center justify-center rounded-[4px] border ${seam} px-6 text-[14px] font-medium text-offgray-100 transition-colors duration-150 hover:border-offgray-700 hover:text-white motion-reduce:transition-none ${focusRing}`}
                  >
                    View source
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>
            </section>

            {/* Canvas preview */}
            <section
              aria-label="Product preview"
              className={`relative border-b ${seam} px-5 py-14 sm:px-8`}
            >
              <Tick className="bottom-2 left-2" />
              <Tick className="bottom-2 right-2" />

              <div aria-hidden="true" className={`border ${seam} bg-offgray-1000`}>
                <div className={`flex items-center gap-3 border-b ${seam} px-3 py-2`}>
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-offgray-800" />
                    <span className="h-2 w-2 rounded-full bg-offgray-800" />
                    <span className="h-2 w-2 rounded-full bg-offgray-800" />
                  </div>
                  <span className="font-mono text-[11px] text-offgray-500">
                    localhost:3133 — pages/index.tsx
                  </span>
                </div>

                <div className="flex">
                  <div className={`hidden w-48 shrink-0 border-r ${seam} p-3 sm:block`}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-offgray-600">
                      Tree
                    </p>
                    <div className="mt-3 space-y-2">
                      <div className="h-3 w-28 bg-offgray-900" />
                      <div className="h-3 w-32 bg-ember/40" />
                      <div className="h-3 w-20 bg-offgray-900" />
                      <div className="h-3 w-24 bg-offgray-900" />
                    </div>
                  </div>

                  <div className="flex-1 p-6 sm:p-10">
                    <div className="border border-dashed border-ember/50 p-5">
                      <div className="h-5 w-40 bg-offgray-800" />
                      <div className="mt-3 h-3 w-full bg-offgray-900" />
                      <div className="mt-2 h-3 w-3/4 bg-offgray-900" />
                      <div className="mt-5 h-8 w-28 rounded-[3px] bg-ember" />
                    </div>
                  </div>

                  <div className={`hidden w-56 shrink-0 border-l ${seam} p-3 lg:block`}>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-offgray-600">
                      Classes
                    </p>
                    <div className="mt-3 space-y-2 font-mono text-[11px] text-offgray-400">
                      <div className={`border ${seam} px-2 py-1`}>bg-ember</div>
                      <div className={`border ${seam} px-2 py-1`}>px-6 py-3</div>
                      <div className="border border-ember/60 px-2 py-1 text-ember-light">
                        rounded-[4px]
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Features */}
            <section id="features" aria-labelledby="features-heading" className={`border-b ${seam}`}>
              <h2 id="features-heading" className="sr-only">
                Features
              </h2>
              {/* gap-px over a seam-coloured background: hairlines that survive wrapping. */}
              <ul className="grid grid-cols-1 gap-px bg-offgray-900 sm:grid-cols-3">
                {features.map(({ icon: Icon, n, title, body }) => (
                  <li key={n} className="bg-surface px-5 py-10 sm:px-7">
                    <div className="flex items-center justify-between">
                      <Icon className="h-[18px] w-[18px] text-ember-light" />
                      <span className="font-mono text-[11px] tabular-nums text-offgray-600">
                        {n}
                      </span>
                    </div>
                    <h3 className="mt-6 text-[17px] font-medium tracking-tight text-white">
                      {title}
                    </h3>
                    <p className="mt-2.5 text-[14px] leading-relaxed text-offgray-400">
                      {body}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {/* Install / how it works */}
            <section
              id="install"
              aria-labelledby="install-heading"
              className={`relative border-b ${seam} px-5 py-20 sm:px-8`}
            >
              <Tick className="left-2 top-2" />

              <Eyebrow>Getting started</Eyebrow>
              <h2
                id="install-heading"
                className="mt-5 max-w-xl text-3xl font-medium leading-tight tracking-[-0.02em] text-white sm:text-4xl"
              >
                Three commands to a{' '}
                <span className="font-serif italic text-cream-100">live canvas.</span>
              </h2>

              <div className="mt-8 flex">
                <button
                  type="button"
                  onClick={copyCommand}
                  className={`group inline-flex min-h-[44px] items-center gap-3 border ${seam} bg-offgray-1000 px-4 font-mono text-[13px] text-offgray-200 transition-colors duration-150 hover:border-offgray-700 motion-reduce:transition-none ${focusRing}`}
                >
                  <span>
                    <span aria-hidden="true" className="text-ember-light">
                      ${' '}
                    </span>
                    {INSTALL_COMMAND}
                  </span>
                  {copied ? (
                    <CheckIcon className="h-4 w-4 text-ember-light" />
                  ) : (
                    <CopyIcon className="h-4 w-4 text-offgray-600 transition-colors duration-150 group-hover:text-offgray-300 motion-reduce:transition-none" />
                  )}
                  <span className="sr-only">
                    {copied ? 'Copied to clipboard' : `Copy ${INSTALL_COMMAND} to clipboard`}
                  </span>
                </button>
                <span aria-live="polite" className="sr-only">
                  {copied ? 'Command copied to clipboard' : ''}
                </span>
              </div>

              <ol className={`mt-12 grid grid-cols-1 gap-px border bg-offgray-900 ${seam} md:grid-cols-3`}>
                {steps.map(({ n, cmd, body }) => (
                  <li key={n} className="bg-surface px-6 py-8">
                    <span className="font-mono text-[11px] tabular-nums text-offgray-600">
                      {n}
                    </span>
                    <h3 className="mt-4 font-mono text-[14px] tracking-tight text-ember-light">
                      {cmd}
                    </h3>
                    <p className="mt-2.5 text-[14px] leading-relaxed text-offgray-400">
                      {body}
                    </p>
                  </li>
                ))}
              </ol>
            </section>

            {/* Specs */}
            <section aria-labelledby="specs-heading" className={`border-b ${seam}`}>
              <h2 id="specs-heading" className="sr-only">
                At a glance
              </h2>
              <dl className="grid grid-cols-2 gap-px bg-offgray-900 sm:grid-cols-4">
                {specs.map(({ label, value }) => (
                  <div key={label} className="bg-surface px-5 py-7 sm:px-7">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-offgray-600">
                      {label}
                    </dt>
                    <dd className="mt-2.5 text-[14px] text-offgray-100">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Closing CTA */}
            <section
              aria-labelledby="cta-heading"
              className={`relative border-b ${seam} px-5 py-24 text-center sm:px-8`}
            >
              <Tick className="bottom-2 left-2" />
              <Tick className="bottom-2 right-2" />

              <h2
                id="cta-heading"
                className="mx-auto max-w-2xl text-3xl font-medium leading-tight tracking-[-0.02em] text-white sm:text-[2.75rem]"
              >
                Point it at your app and{' '}
                <span className="font-serif italic text-cream-100">start clicking.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-offgray-400">
                No account, no upload step. Framelab reads and writes the repo you
                already have open.
              </p>
              <a
                href="#install"
                className={`mt-9 inline-flex min-h-[46px] items-center justify-center rounded-[4px] bg-ember px-7 text-[14px] font-semibold text-black transition-colors duration-150 hover:bg-ember-bright motion-reduce:transition-none ${focusRing}`}
              >
                Get started
              </a>
            </section>
          </main>

          <footer className="px-5 py-10 sm:px-8">
            <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <p className="font-mono text-[11px] text-offgray-500">
                Framelab — visual editor for Next.js + Tailwind
              </p>
              <ul className="flex items-center">
                {[
                  { label: 'GitHub', href: 'https://github.com/salianahshal/framelab' },
                  { label: 'MIT', href: 'https://github.com/salianahshal/framelab/blob/main/LICENSE' },
                ].map((link) => (
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
        </div>
      </div>
    </>
  );
}
