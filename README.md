<div align="center">

<img src="packages/canvas/logo.svg" alt="Framelab" width="76" height="76">

# Framelab

**Edit your running Next.js app by clicking it. The change lands in your source
as your own design tokens — and you see the diff before you keep it.**

Click any element, restyle it, rewrite its text, delete it, or hand it to your
coding agent. Framelab writes to the real file and touches nothing you didn't
change. No cloud, no sandbox, no export step.

[![npm](https://img.shields.io/npm/v/framelab?color=e0490d&label=npm)](https://www.npmjs.com/package/framelab)
[![node](https://img.shields.io/node/v/framelab?color=e0490d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-e0490d)](LICENSE)

</div>

---

## Why Framelab

Nudging a value in dev tools is easy. Getting that nudge into the codebase as
`p-gutter` instead of `padding: 28px` is the part that goes wrong — whether a
person does it by hand or an agent does it for you.

Framelab is the last mile. It edits the real file, in your own vocabulary, and
shows you the diff before you keep it.

- **You see the change before you keep it.** Every edit lands as an ordinary
  working-tree change, listed in a diff panel in the canvas. Revert a hunk,
  revert a file, undo byte-for-byte, or commit — nothing is applied behind
  your back and nothing needs publishing.
- **It writes your tokens, not the pixel value you landed on.** Bump spacing
  and it emits `p-gutter`, because it reads your design system — your
  `tailwind.config` on Tailwind v3, your `@theme` blocks on v4, resolved
  through `var()` and `calc()` and out of oklch. It will also tell you where
  you already have a hardcoded value a token covers, and fix it.
- **Nothing else in the file moves.** Only the values you changed are
  rewritten. Class order, unrecognised utilities, variants, comments and
  import order survive, so the diff is small enough to actually read.
- **It refuses rather than guesses.** A `className` built from a ternary is
  marked locked, with the reason, instead of being rewritten into something
  that happens to parse. Every write is re-parsed first; a change that would
  break the file is not made.
- **No model in the loop unless you want one.** Clicking a swatch is a
  deterministic edit, not a prompt. When you do want an agent, it gets the
  same validated path over MCP — it proposes `{prop, value}` and Framelab
  renders the class after checking it against your design system, so it
  cannot invent `bg-embr` or reorder your classes.
- **Local only.** No account, no upload, no sandbox. The sync server binds to
  loopback and refuses cross-origin requests and paths outside your project.

## Quick start

Framelab attaches to a dev server you're already running.

```sh
cd your-next-app

npx framelab init          # detect the project, write the config + .env wiring
npm install --save-dev @framelab/babel-plugin

npm run dev                # terminal 1 — your app
npx framelab               # terminal 2 — the canvas
```

`framelab` finds your dev server automatically (it probes the port in your
`dev` script, then 3000-3003, 4000, 5173, 5174, 8080), opens the canvas on
**http://localhost:3133**, and starts watching your source.

## What can be edited

If you can see it on the canvas, you can generally edit it. The exception is a
`className` built from an expression Framelab cannot rewrite without guessing at
behaviour it can't see:

| className shape | Editable |
| --- | --- |
| `className="p-4 flex"` | yes |
| ``className={`p-4 ${ring}`}`` | yes — the `${…}` keeps its exact position |
| `className={cn('p-4', active && 'bg-red')}` | yes — the first string argument |
| `className={clsx(…)}` / `twMerge(…)` / `cva(…)` | yes |
| `className={a ? 'p-2' : 'p-4'}` | no — refused, not guessed at |
| `className={styles.root}` | no |

Elements that can't be edited are marked with a lock in the layer tree and say
so in the inspector, so it's never a silent failure. Text is editable whenever
an element's children are plain text.

Every write is re-parsed before it lands: if a change would break the file, it
is refused and the file is left untouched.

## Duplicating

Select an element and press `⌘D`, or use the copy button in the inspector
header. The element and everything inside it are copied in as the next sibling,
indented to match, and the copy becomes the selection so your next edit lands on
it. `⌘Z` removes it again.

It is the quickest way to add a card to a grid or a row to a list: duplicate,
then retype the text.

## Finding design-system drift

`bg-[#6e56cf]` and `bg-brand` render the same pixels. Only one of them moves
when the token does.

Framelab compares every hardcoded value against your design system and
reports the ones a token already covers. Units are normalised, so `p-[16px]`
matches a `4` that resolves to `1rem`, and a token you named yourself wins over
a stock Tailwind step of the same value:

```
bg-[#6e56cf]   is #6e56cf, which is the "brand" colour  — use bg-brand
p-[1.75rem]    is 1.75rem, which is the "gutter" token  — use p-gutter
rounded-[14px] is 14px,    which is the "card" token    — use rounded-card
```

Genuine one-offs are left alone. Over MCP this is `find_drift` to see it and
`fix_drift` to apply it, so an agent can clean a whole codebase in one pass.

## Deleting

Select an element and press `Del`, or use the trash button in the inspector
header. The element and everything inside it are removed, along with the line
break and indentation that introduced it, so no blank line is left behind.
Selection moves to the parent.

Deleting removes real source code, so it is always recoverable: `⌘Z` puts the
element back byte for byte at the same position, and the toast that appears
offers the same undo. Deleting is refused on the outermost element of a
component, which would leave the component returning nothing.

## Keyboard

| Key | Action |
| --- | --- |
| `Esc` | Deselect |
| `↑` / `↓` | Select parent / first child |
| `←` / `→` | Select previous / next sibling |
| `⌘D` | Duplicate the selected element |
| `Del` / `⌫` | Delete the selected element |
| `⌘Z` / `⌘⇧Z` | Undo / redo any edit, reorder, duplicate or delete |
| `⌘B` / `⌘J` | Toggle the left and right panels |

Shortcuts work whether focus is in the canvas or in the preview.

## Use it from your AI editor

Framelab ships an MCP server, so Claude Code, Cursor, Continue or Windsurf get
the same token-aware, surgical editing the canvas uses — instead of guessing at
class strings.

```json
{
  "mcpServers": {
    "framelab": {
      "command": "npx",
      "args": ["framelab", "mcp", "--root", "/absolute/path/to/your/project"]
    }
  }
}
```

Framelab knows two things a coding agent cannot work out on its own: which
element you are looking at, and what your design system actually contains.

```
  you click a button in the canvas
             │
             ▼
     selection published to the sync server
             │
             │   get_selection
             ▼
  Claude Code / Cursor  ──  update_styles({ props, variants })
                                        │
                            validated against your design system
                                        ▼
                                surgical write to your source
```

- **`get_selection`** answers "what is the user pointing at?". Click an element,
  then say "make this bigger" — no file paths, no grepping, no guessing which of
  the four buttons you meant. The agent gets the exact source line, the parsed
  Tailwind values, the ancestor chain, and which breakpoint you have open in the
  inspector.
- **`update_styles` validates against your design system.** A model that
  writes `bg-embr` gets *"not in this project's colour palette. Did you mean
  ember?"* rather than a class Tailwind silently drops. Edits are structured
  (`{prop, value, variants}`), so the model chooses values while Framelab renders
  the class string — it cannot reorder your classes or emit one that fails to
  parse.

Sixteen tools are exposed in total: `get_selection`, `list_files`,
`find_elements`, `get_element`, `list_design_tokens`, `update_styles`,
`update_text`, `move_sibling`, `duplicate_element`, `delete_element`,
`restore_element`, `find_drift`, `fix_drift`, `commit`, `get_diff`, and
`snapshot`. Run the canvas at the same time and you'll watch the
model's edits land live.

If you'd rather paste into a chat window than wire up MCP, the inspector header
has a copy button that puts the same context on your clipboard.

See **[MCP.md](packages/cli/MCP.md)** for client-by-client setup and the full
tool reference.

## How it works

```
  your source files
         │
         │  @framelab/babel-plugin tags JSX with data-framelab-id (dev only)
         ▼
  next dev  ──────────────►  browser
                                 │  click
                                 ▼
                          @framelab/canvas  ── REST + WebSocket ──►  @framelab/server
                            (port 3133)                                 (port 3131)
                                                                            │
                                                              AST edit, byte-surgical
                                                                            ▼
                                                                  your source files
```

The babel plugin runs in development only and tags each JSX element with a
stable id, which is what lets a click in the browser resolve back to a file and
line. The server parses that file, edits the `className` node in the AST, and
writes it back — touching nothing else.

## Commands

| Command | Description |
| --- | --- |
| `framelab` | Start the canvas — same as `framelab start` |
| `framelab init` | Detect the project and write `babel.config.js` + `.env.development` |
| `framelab start` | Start the canvas and sync server explicitly |
| `framelab mcp` | Run the MCP server over stdio for AI clients |
| `framelab help` | Show usage |
| `framelab --version` | Print the version |

### Options for `start`

| Flag | Default | Description |
| --- | --- | --- |
| `--app-url <url>` | auto-detect | Your dev server URL |
| `--port <n>` | `3133` | Canvas port |
| `--api-port <n>` | `3131` | Sync server port |
| `--root <dir>` | `cwd` | Directory to watch |
| `--no-open` | — | Don't open the browser |

Any of these keys can be set per project in a `.framelabrc.json` file, so you
don't have to retype flags.

## Packages

| Package | Description |
| --- | --- |
| [`framelab`](packages/cli) | The CLI — `init`, `start`, and the MCP server |
| [`@framelab/server`](packages/server) | File watcher, AST writer, Tailwind theme/class parsing, git hunk revert, REST + WebSocket bridge |
| [`@framelab/babel-plugin`](packages/babel-plugin) | Tags JSX elements with `data-framelab-id`; optionally injects the click runtime |
| [`@framelab/canvas`](packages/canvas) | The browser canvas UI, served by the sync server |

## When nothing is clickable

Two separate things have to happen before the canvas can talk to your app: the
Babel plugin has to tag your JSX with `data-framelab-id`, and it has to inject
the click runtime into `pages/_app`. Either can fail alone, and both failures
look the same from the outside — the app serves, the canvas connects, elements
render, and nothing responds.

So `framelab start` checks the app it's pointing at and says which half is
missing:

```
! Elements are tagged, but the click runtime isn't in your app bundle.
  The canvas will render your app and nothing will respond to a click.

  NEXT_PUBLIC_FRAMELAB=true is not set in any .env file here.
    echo 'NEXT_PUBLIC_FRAMELAB=true' >> .env.development
```

It's advisory — a setup that trips the heuristic gets a warning it can ignore,
never a refusal to start — and it stays quiet when the app is wired correctly.

## Requirements & current limits

- **Node.js >= 18**
- **Next.js + Tailwind CSS.** `framelab init` refuses to run on anything else.
  Both Tailwind majors are read: `tailwind.config.{js,ts,cjs,mjs}` on v3, and
  `@theme` blocks (including `@theme inline` over `:root`, as shadcn/ui
  generates) on v4. On v4 the tokens are resolved through `var()` and `calc()`
  and oklch is converted, so drift detection and the inspector see real values.
- **Turbopack is fine.** Next.js 16 configures `babel-loader` automatically
  when it finds a Babel config, so `framelab init` does not take Turbopack
  away from you — verified on 16.4.0 with Turbopack as the default bundler.
  Babel runs *in addition to* SWC rather than replacing it. The plugin
  `init` writes is gated on `NODE_ENV === 'development'`, so nothing Framelab
  does reaches your production bundle; the Babel pass itself still runs during
  a production build, which costs build time you can avoid by scoping the
  config to dev.
- **App Router works on Next.js 16.3+.** The runtime reaches the browser
  through `instrumentationClientInject`, which `framelab init` wires up by
  wrapping your `next.config`. Server components are editable too: the plugin
  tags their JSX, the tags survive into the streamed HTML, and an edit to a
  server component round-trips through HMR. Verified on Next.js 16.4 with
  React 19 and Turbopack.
- **Below Next.js 16.3, the App Router can't be supported.** The runtime has
  to be inlined into `pages/_app`, which those projects don't have, so
  elements are tagged but nothing responds to a click. `framelab start` says
  so rather than leaving you guessing.
- Framelab configures Babel, which means Next falls back from SWC to Babel in
  development. Your production build is unaffected.
- Editing an element inside a reused component edits its **definition**, so the
  change applies to every instance. The layer tree shows you where you are.

## Development

The four packages are an npm workspace. Each one also installs and tests on its own:

```sh
cd packages/babel-plugin && npm install && npm test
cd packages/server       && npm install && npm test
```

Or run both suites from the root:

```sh
npm test
```

`npm test` covers the Tailwind class model, the AST writer, the sync server's
path and origin guards, and the babel plugin — no browser required.

Two browser-level suites run separately (they need Chrome, or `CHROME_PATH`):

```sh
npm run test:e2e   --workspace @framelab/canvas  # canvas against a real sync server
npm run test:v4    --workspace @framelab/canvas  # the same, on a Tailwind v4 project
npm run test:live  --workspace @framelab/canvas  # plus a real Next.js dev server
npm run test:agent --workspace @framelab/canvas  # canvas click -> MCP process -> source edit
```

`test:live` copies `examples/fixture-app` to a temp directory with its own
dist dir, so it never collides with a dev server you already have running.

### The fixture apps

[`examples/fixture-app`](examples/fixture-app) is what the integration suites
drive, and the first thing to point Framelab at to see what it does. It is a
real interface rather than a wireframe, and it contains the awkward cases on
purpose: a component used three times (edit the definition, all three change),
a template-literal `className`, a ternary `className` Framelab refuses to
rewrite and shows as locked, responsive and hover variants, and a card styled
with hardcoded values that tokens already cover so drift detection has
something to find.

Four things in it are a contract with `packages/canvas/test/live.js`, listed in
a comment at the top of its `pages/index.tsx`. Change anything else freely.

Its `tailwind.config.js` custom theme is asserted by the server's themeEngine
tests — if you change the `brand`, `surface`, or `accent` tokens, the `card`
radius, the `gutter` spacing, or the `card` shadow, update
`packages/server/test/run.js` to match.

[`examples/test-next-app-v4`](examples/test-next-app-v4) is the Tailwind v4
counterpart: no `tailwind.config.js`, tokens in `@theme` blocks, and a page
written half in tokens and half in hardcoded values. Nothing boots it in CI, so
`packages/server/test/themeV4.js` asserts its stylesheet still parses — that is
what stops it rotting. `npm run dev` there serves on port 3135.

### The website

[`site`](site) is framelab.dev. It is an ordinary Next.js app and not part of
the npm workspace, so a root `npm install` doesn't touch it:

```sh
cd site && npm install && npm run dev   # port 3134
```

It is wired for Framelab itself, so you can edit the site with the tool it
advertises.

[`packages/server/test/fixtures/v4-app`](packages/server/test/fixtures/v4-app)
is the Tailwind v4 counterpart: a shadcn-shaped `@theme inline` stylesheet over
`:root`, a split `@import`, and a stubbed `tailwindcss` install so the loader
resolves real v4 defaults. It is read, never built.

[`examples/click-test-harness.html`](examples/click-test-harness.html) exercises
the click runtime in isolation.

## License

[MIT](LICENSE) © salianahshal
