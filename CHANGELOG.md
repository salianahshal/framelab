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

### Duplicating

Select an element and press `⌘D`, or use the copy button in the inspector
header. The element and everything inside it are copied in as the next sibling,
indented to match, and the copy becomes the selection so the next edit lands on
it. `⌘Z` removes it again.

It is the quickest way to add a card to a grid or a row to a list: duplicate,
then retype the text. Over MCP it is `duplicate_element`, which hands back the
copy's id so an agent's next edit is unambiguous.

### Design-system drift detection

`bg-[#6e56cf]` and `bg-brand` render the same pixels. Only one of them moves
when the token does.

Every hardcoded value is compared against `tailwind.config` and reported when a
token already covers it. Units are normalised, so `p-[16px]` matches a `4` that
resolves to `1rem`, and a token you named yourself wins over a stock Tailwind
step of the same value. Genuine one-offs are left alone.

- This needed the theme reader to expose resolved token *values*, not just
  their names — the question is the reverse of the usual one: not "what is
  `gutter`?" but "is this `1.75rem` something I already have a name for?"
- Over MCP, `find_drift` reports and `fix_drift` applies, so an agent can clean
  a whole codebase in one pass.

The MCP server went from thirteen tools to sixteen.

## 0.1.0

Initial release. Click an element in your running Next.js + Tailwind app and
restyle it, rewrite its text, reorder or delete it — with the change written
back into your source file rather than into a stylesheet or a cloud sandbox.

### Editing

- **Order-preserving class engine.** Only the tokens you actually changed are
  rewritten. Class order, unrecognised utilities, variants and comments all
  survive, so `git diff` stays reviewable.
- **Template-literal `className`s.** `` `p-4 ${ring}` `` is editable and the
  `${…}` keeps its exact position. `cn()`, `clsx()`, `twMerge()` and `cva()`
  are handled through their first string argument.
- **Responsive and state styles are values, not strings.** Pick `md` or
  `hover` in the inspector and edit that variant directly; base styles stay
  put.
- **Theme-aware.** Colours, spacing and radii come from your own
  `tailwind.config`, so you edit in `brand` and `card`.
- Reorder siblings, delete an element and its subtree, and undo or redo any of
  it. Every write is re-parsed before it lands: a change that would break the
  file is refused and the file left untouched.

### For agents

An MCP server with thirteen tools, so Claude Code, Cursor, Continue or Windsurf
get the same token-aware editing the canvas uses. `get_selection` answers "what
is the user pointing at?", and `update_styles` validates against your
`tailwind.config` rather than emitting a class Tailwind silently drops.

### Local only

The sync server binds to loopback, refuses cross-origin requests, and rejects
paths outside your project. No account, no upload, no sandbox — changes land as
ordinary working-tree edits.

### Fixed

- The selection outline stayed glued to its element during scroll and resize.
