import Head from 'next/head';
import type { GetStaticProps } from 'next';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import { focusRing, seam } from '../lib/ui';
import { readChangelog, type Block, type Inline, type Release } from '../lib/changelog';

function Inlines({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((node, i) => {
        if (node.type === 'code') {
          return (
            // No chip: this prose is dense with code, and padded inline
            // backgrounds detach following punctuation and break when they wrap.
            <code key={i} className="font-mono text-[0.92em] text-cream-100">
              {node.value}
            </code>
          );
        }
        if (node.type === 'strong') {
          return (
            <strong key={i} className="font-semibold text-white">
              <Inlines content={node.content} />
            </strong>
          );
        }
        if (node.type === 'link') {
          return (
            <a key={i} href={node.href} className={`text-ember underline underline-offset-4 hover:text-ember-bright ${focusRing}`}>
              <Inlines content={node.content} />
            </a>
          );
        }
        return <span key={i}>{node.value}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} className="mt-4 space-y-2.5">
            {block.items.map((item, j) => (
              <li key={j} className="relative pl-5 text-[15px] leading-relaxed text-offgray-300">
                <span aria-hidden="true" className="absolute left-0 top-[0.7em] h-px w-2.5 bg-offgray-700" />
                <Inlines content={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-offgray-300">
            <Inlines content={block.content} />
          </p>
        )
      )}
    </>
  );
}

export default function Changelog({ releases }: { releases: Release[] }) {
  return (
    <>
      <Head>
        <title>Changelog — Framelab</title>
        <meta name="description" content="What changed in each release of Framelab." />
      </Head>

      <a href="#main" className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[4px] focus:bg-ember focus:px-4 focus:py-2 focus:text-black ${focusRing}`}>
        Skip to content
      </a>

      <div className="min-h-dvh bg-surface text-offgray-50 antialiased">
        <div className={`mx-auto max-w-6xl border-x ${seam}`}>
          <SiteHeader />

          <main id="main">
            <div className={`border-b ${seam} px-5 py-14 sm:px-8`}>
              <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-offgray-500">
                Changelog
              </p>
              <h1 className="mt-4 text-[2.25rem] font-medium leading-[1.05] tracking-[-0.03em] text-white sm:text-5xl">
                What changed
              </h1>
              <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-offgray-400">
                Every release, newest first. The four packages version together,
                so one entry covers all of them.
              </p>
            </div>

            {releases.map((release) => (
              <article
                key={release.version}
                id={release.version}
                className={`scroll-mt-20 border-b ${seam} px-5 py-12 sm:px-8`}
              >
                <div className="grid gap-8 md:grid-cols-[10rem_1fr]">
                  <div>
                    <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.2em] text-white">
                      <a href={`#${release.version}`} className={`hover:text-ember ${focusRing}`}>
                        {release.version}
                      </a>
                    </h2>
                  </div>

                  <div>
                    {release.sections.map((section, i) => (
                      <section key={i} className={i > 0 ? 'mt-9' : ''}>
                        {section.heading ? (
                          <h3 className="text-[15px] font-medium text-white">{section.heading}</h3>
                        ) : null}
                        <Blocks blocks={section.blocks} />
                      </section>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </main>

          <SiteFooter />
        </div>
      </div>
    </>
  );
}

// Read at build time so the page and CHANGELOG.md cannot drift apart.
export const getStaticProps: GetStaticProps = async () => {
  return { props: { releases: readChangelog() } };
};
