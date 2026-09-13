export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground p-gutter">
      <h1 className="text-hero font-bold text-brand">Framelab on Tailwind v4</h1>

      <p className="mt-4 max-w-prose text-foreground">
        This app has no tailwind.config.js. Every token below comes from the
        <code className="px-1"> @theme </code> blocks in styles/globals.css.
      </p>

      <section className="mt-8 grid grid-cols-3 gap-gutter">
        <article className="bg-surface rounded-card shadow-card p-6">
          <h2 className="font-semibold text-foreground">Uses tokens</h2>
          <p className="mt-2 text-foreground">rounded-card, shadow-card, bg-surface.</p>
        </article>

        <article className="bg-[#f5f3ff] rounded-[0.875rem] shadow-card p-[1.75rem]">
          <h2 className="font-semibold text-foreground">Drifted</h2>
          <p className="mt-2 text-[#3f1a99]">Hardcoded values a token already covers.</p>
        </article>

        <article className="bg-surface rounded-card shadow-card p-6">
          <h2 className="font-semibold text-[oklch(52.3%_0.203_293.4)]">Drifted, oklch</h2>
          <p className="mt-2 text-foreground">The shape people actually write on v4.</p>
        </article>
      </section>

      <button className="mt-8 bg-brand text-background rounded-sm px-6 py-3 hover:bg-[#3f1a99]">
        A button
      </button>
    </main>
  );
}
