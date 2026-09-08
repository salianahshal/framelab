<div align="center">

<img src="packages/canvas/logo.svg" alt="Framelab" width="76" height="76">

# Framelab

**Visual editor for Next.js + Tailwind. Runs on your machine, edits your files.**

Click any element in your running app. Restyle it, rewrite its text, delete it,
or hand it to your coding agent — Framelab writes the change back into your
source file, touching only the tokens you actually changed.

[![npm](https://img.shields.io/npm/v/framelab?color=e0490d&label=npm)](https://www.npmjs.com/package/framelab)
[![node](https://img.shields.io/node/v/framelab?color=e0490d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-e0490d)](LICENSE)

</div>

---

## Why Framelab

Visual editors usually make you choose: either they own your code (upload it to
a cloud sandbox, export it back later), or they write CSS you didn't ask for.
Framelab does neither.

- **Local only.** No account, no upload, no sandbox. The CLI talks to your dev
  server on localhost and edits files in place. The sync server binds to
  loopback and refuses cross-origin requests and paths outside your project.
- **Byte-surgical diffs.** Only the tokens you actually changed are rewritten.
  Class order, unrecognised utilities, variants, comments and import order all
  survive untouched — `git diff` stays reviewable.
- **Theme-aware.** Colors, spacing, and radii come from your own
  `tailwind.config.{js,ts}`, so you edit in `brand` and `card`, not `#6e56cf`
  and `14px`.
- **Responsive and state styles are values, not strings.** Pick `md` or `hover`
  in the inspector and edit that variant directly; the base styles stay put.
- **Built to work with an agent.** Your AI editor can ask Framelab what you're
  pointing at, and its edits are checked against your own design system before
  they're written.
- **Your git workflow, unchanged.** Changes land as ordinary working-tree edits.
  Review them, revert a hunk, or commit them like anything else.

## Quick start

Framelab attaches to a dev server you're already running.

```sh
cd your-next-app

npx framelab init          # detect the project, write babel.config.js + .env wiring
npm install --save-dev @framelab/babel-plugin '@babel/runtime@^7'

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
| `Del` / `⌫` | Delete the selected element |
| `⌘Z` / `⌘⇧Z` | Undo / redo an edit, a reorder, or a delete |
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
                              validated against tailwind.config
                                        ▼
                                surgical write to your source
```

- **`get_selection`** answers "what is the user pointing at?". Click an element,
  then say "make this bigger" — no file paths, no grepping, no guessing which of
  the four buttons you meant. The agent gets the exact source line, the parsed
  Tailwind values, the ancestor chain, and which breakpoint you have open in the
  inspector.
- **`update_styles` validates against your `tailwind.config`.** A model that
  writes `bg-embr` gets *"not in this project's colour palette. Did you mean
  ember?"* rather than a class Tailwind silently drops. Edits are structured
  (`{prop, value, variants}`), so the model chooses values while Framelab renders
  the class string — it cannot reorder your classes or emit one that fails to
  parse.

Thirteen tools are exposed in total: `get_selection`, `list_files`,
`find_elements`, `get_element`, `list_design_tokens`, `update_styles`,
`update_text`, `move_sibling`, `delete_element`, `restore_element`, `commit`,
`get_diff`, and `snapshot`. Run the canvas at the same time and you'll watch the
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

## Requirements & current limits

- **Node.js >= 18**
- **Next.js + Tailwind CSS.** `framelab init` refuses to run on anything else.
- **Pages Router is the supported path.** v0.1 targets Pages Router. App Router
  partly works — the babel plugin tags client components, but React Server
  Components are skipped, so those elements aren't clickable.
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
npm run test:live  --workspace @framelab/canvas  # plus a real Next.js dev server
npm run test:agent --workspace @framelab/canvas  # canvas click -> MCP process -> source edit
```

`test:live` copies `examples/test-next-app` to a temp directory with its own
dist dir, so it never collides with a dev server you already have running.

[`examples/test-next-app`](examples/test-next-app) is a minimal Next.js 14 +
Tailwind app used as the integration fixture. Its `tailwind.config.js` custom
theme is asserted by the server's themeEngine tests — if you change the
`brand`, `surface`, or `accent` tokens, the `card` radius, the `gutter`
spacing, or the `card` shadow, update `packages/server/test/run.js` to match.

[`examples/click-test-harness.html`](examples/click-test-harness.html) exercises
the click runtime in isolation.

## License

[MIT](LICENSE) © salianahshal
