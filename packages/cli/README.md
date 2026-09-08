<div align="center">

<img src="https://raw.githubusercontent.com/salianahshal/framelab/main/packages/canvas/logo.svg" alt="Framelab" width="76" height="76">

# framelab

**Visual editor for Next.js + Tailwind. Runs on your machine, edits your files.**

Click any element in your running app. Restyle it, rewrite its text, delete it,
or hand it to your coding agent — Framelab writes the change back into your
source file, touching only the tokens you actually changed.

[![npm](https://img.shields.io/npm/v/framelab?color=e0490d&label=npm)](https://www.npmjs.com/package/framelab)
[![node](https://img.shields.io/node/v/framelab?color=e0490d)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-e0490d)](https://github.com/salianahshal/framelab/blob/main/LICENSE)

</div>

Click any element in your running app, adjust its Tailwind classes visually, and
Framelab writes the change straight back into your source — byte-surgical AST
edits, no formatting churn, no cloud round-trip.

- **Local only.** No account, no upload, no sandbox. The CLI talks to your dev
  server on localhost and edits files in place.
- **Byte-surgical diffs.** Only the `className` value changes. Formatting,
  comments, and import order survive untouched.
- **Theme-aware.** Values come from your own `tailwind.config.{js,ts}`, so you
  edit in `brand` and `card`, not `#6e56cf` and `14px`.
- **Your git workflow, unchanged.** Edits land in the working tree. Review,
  revert a hunk, or commit as usual.

## Install

No install needed — run it with `npx`:

```sh
npx framelab
```

Or add it to a project:

```sh
npm install --save-dev framelab
```

## Quick start

Framelab attaches to a dev server you're already running.

```sh
cd your-next-app

npx framelab init          # detect the project, write babel.config.js + .env wiring
npm install --save-dev @framelab/babel-plugin '@babel/runtime@^7'

npm run dev                # terminal 1 — your app
npx framelab               # terminal 2 — the canvas
```

`framelab` finds your dev server automatically (it probes the port in your `dev`
script, then 3000-3003, 4000, 5173, 5174, 8080), opens the canvas on
**http://localhost:3133**, and starts watching your source.

### What `init` does

1. Verifies the project is Next.js and reports which router it found
2. Writes `babel.config.js` with `@framelab/babel-plugin` gated to development
   (if the file already exists, it prints the line to add and changes nothing)
3. Adds `NEXT_PUBLIC_FRAMELAB=true` to `.env.development`

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

### `.framelabrc.json`

Set any of those keys per project so you don't retype flags:

```json
{
  "appUrl": "http://localhost:4000",
  "port": 3133,
  "apiPort": 3131
}
```

## Use it from your AI editor

Framelab ships an MCP server, giving Claude Code, Cursor, Continue, or Windsurf
the same token-aware, byte-surgical editing the canvas uses — instead of letting
the model guess at class strings.

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

| Tool | Purpose |
| --- | --- |
| `get_selection` | What the user is pointing at in the canvas, right now |
| `list_files` | List all `.tsx`/`.jsx` files in the project |
| `find_elements` | Search elements by tag, className substring, or text |
| `get_element` | Full element details + parsed Tailwind props |
| `list_design_tokens` | Your `tailwind.config` tokens (colors, spacing, etc.) |
| `update_styles` | Edit Tailwind classes, base or per-variant |
| `update_text` | Replace an element's text content |
| `move_sibling` | Reorder siblings (same parent only) |
| `delete_element` | Remove an element, returning how to restore it |
| `restore_element` | Put a deleted element back, byte for byte |
| `commit` | Atomic git commit with the given message |
| `get_diff` | Current pending git diff |
| `snapshot` | PNG of an element or a route, so the model can see its work |

Two of these change how it feels to work with an agent:

- **`get_selection`** answers "what is the user pointing at?". Click an element
  in the canvas, then say "make this bigger" — no file paths, no grepping. The
  agent gets the exact source line, the parsed Tailwind values, the ancestor
  chain, and which breakpoint you have open in the inspector.
- **`update_styles` validates against your `tailwind.config`.** A model that
  writes `bg-embr` gets *"not in this project's colour palette. Did you mean
  ember?"* rather than a class Tailwind silently drops. Edits are structured
  (`{prop, value, variants}`), so the model chooses values while Framelab
  renders the class string — it cannot reorder your classes or emit one that
  fails to parse.

Run the canvas at the same time and you'll watch the model's edits land live.
Full setup per client is in
[MCP.md](https://github.com/salianahshal/framelab/blob/main/packages/cli/MCP.md).

## In the canvas

| | |
| --- | --- |
| **Select** | Click any element. Hover outlines, a layer tree, and a breadcrumb show where you are. `↑`/`↓` walk to the parent or first child, `←`/`→` to siblings, `Esc` deselects. |
| **Restyle** | Spacing is a box model, colours and tokens open compact popovers filled from your own `tailwind.config`. No full-height dropdowns. |
| **Responsive & state** | Pick `sm`…`2xl` or `hover`/`focus`/`dark` and edit that variant directly. The canvas widens to the breakpoint so you can see what you're changing. |
| **Rewrite text** | Edit an element's text when its children are plain text. |
| **Delete** | `Del` removes the element and its children, with no blank line left behind. |
| **Undo** | `⌘Z` covers styles, text, reorders and deletes, restoring bytes exactly. |
| **Review** | A diff panel with per-hunk revert, commit, and an optional auto-commit per edit. |

## What can be edited

If you can see it on the canvas you can generally edit it. The exception is a
`className` built from an expression Framelab won't rewrite without guessing:

| className shape | Editable |
| --- | --- |
| `className="p-4 flex"` | yes |
| ``className={`p-4 ${ring}`}`` | yes — the `${…}` keeps its exact position |
| `className={cn('p-4', active && 'bg-red')}` | yes — the first string argument |
| `className={clsx(…)}` / `twMerge(…)` / `cva(…)` | yes |
| `className={a ? 'p-2' : 'p-4'}` | no — refused, not guessed at |

Elements that can't be edited are marked with a lock in the layer tree, so it's
never a silent failure. Every write is re-parsed before it lands: a change that
would break the file is refused and the file left untouched.

## How it works

`@framelab/babel-plugin` tags each JSX element with a stable `data-framelab-id`
in development, which is what lets a click in the browser resolve back to a file
and line. `@framelab/server` parses that file, edits the `className` node in the
AST, and writes it back — touching nothing else. `@framelab/canvas` is the
browser UI, served locally.

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

## Links

- [Repository](https://github.com/salianahshal/framelab)
- [Issues](https://github.com/salianahshal/framelab/issues)
- [MCP setup guide](https://github.com/salianahshal/framelab/blob/main/packages/cli/MCP.md)

## License

[MIT](https://github.com/salianahshal/framelab/blob/main/LICENSE) © salianahshal
