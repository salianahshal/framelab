# Changelog

All notable changes to Framelab. Versions are released together across the four
packages, so one entry covers `framelab`, `@framelab/server`,
`@framelab/babel-plugin` and `@framelab/canvas`.

## 0.3.0

### Tailwind v4

Framelab reads the design system from `@theme` blocks in CSS, not just
`tailwind.config.{js,ts}`. v4 deleted the config file, so on a v4 project every
theme-aware feature used to fall back to stock Tailwind without saying so: the
inspector showed a generic palette, `update_styles` validated against the wrong
tokens, and `find_drift` had nothing to match against.

The v3 and v4 readers return the same token shape, so nothing downstream
branches on the Tailwind major.

- `@theme inline` is resolved through `:root`, which is what shadcn/ui
  generates — tokens there are `var()` references, useless as a swatch until
  resolved. `.dark` overrides are kept separate.
- `calc()` is evaluated, so shadcn's `calc(var(--radius) - 4px)` radius scale
  produces real values instead of none.
- The numeric spacing scale is derived from the `--spacing` multiplier, so
  `p-[16px]` is recognised as `p-4` on a project that never declares
  `--spacing-4`.
- oklch and hsl are converted to hex, so `text-[oklch(0.145_0_0)]` — the shape
  people write on v4 — matches a token instead of being ignored.
- Editing any stylesheet that fed the theme reloads it, `@import`s included,
  the way editing `tailwind.config.js` does on v3.

### Diagnosing a dead canvas

`framelab start` now says which half of the setup is missing when nothing is
clickable. Tagging and runtime injection fail independently and used to look
identical from the outside: the app serves, the canvas connects, elements
render, nothing responds.

It names the missing half — an absent Babel config, a config that doesn't list
the plugin, an unset `NEXT_PUBLIC_FRAMELAB`, or an App Router project with no
`pages/_app` for the runtime to live in — and stays silent on a healthy app.

### Fixed

- An unresolvable `tailwindcss` install no longer hides a v4 theme. The
  version check gated the CSS path, so under pnpm, Yarn PnP, or a monorepo
  that hoists `tailwindcss`, framelab reported no design system for a project
  that plainly had one.
- `loadTheme` silently returned no tokens for a relative root directory,
  because `require()` reads a relative path as a module specifier.

### Docs

- Corrected why App Router elements aren't clickable. Server components are
  not skipped by the plugin — every file's JSX is tagged. What's missing is a
  `pages/_app` for the click runtime.
- Documented that Turbopack is unsupported: `framelab init` writes
  `babel.config.js`, which Turbopack refuses to run alongside. On Next.js 16,
  where Turbopack is the default, `next dev --webpack` is needed.

### Internal

- `examples/test-next-app-v4` is a Tailwind v4 fixture app, and the CLI package
  has a test suite for the first time.

## 0.2.0

- Duplicate an element with `⌘D`, copying it and its subtree in as the next
  sibling.
- Design-system drift detection: find hardcoded values a token already covers,
  over MCP as `find_drift` and `fix_drift`.

## 0.1.0

Initial release. Click an element in your running Next.js + Tailwind app and
restyle it, rewrite its text, reorder or delete it, with byte-surgical writes
back to source. Order-preserving class engine, template-literal `className`
support, an MCP server for AI editors, and a local-only sync server.
