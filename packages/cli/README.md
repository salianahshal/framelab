<div align="center">

<img src="https://raw.githubusercontent.com/salianahshal/framelab/main/packages/canvas/logo-dark-bg.svg" alt="Framelab" width="72" height="72">

# framelab

**Visual editor for Next.js + Tailwind. Runs on your machine, edits your files.**

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
npm install --save-dev @framelab/babel-plugin @babel/runtime

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
| `list_files` | List all `.tsx`/`.jsx` files in the project |
| `find_elements` | Search elements by tag, className substring, or text |
| `get_element` | Full element details + parsed Tailwind props |
| `list_design_tokens` | Your `tailwind.config` tokens (colors, spacing, etc.) |
| `update_styles` | Edit Tailwind classes via structured props |
| `update_text` | Replace an element's text content |
| `move_sibling` | Reorder siblings (same parent only) |
| `commit` | Atomic git commit with the given message |
| `get_diff` | Current pending git diff |

Run the canvas at the same time and you'll watch the model's edits land live.
Full setup per client is in
[MCP.md](https://github.com/salianahshal/framelab/blob/main/packages/cli/MCP.md).

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

## Links

- [Repository](https://github.com/salianahshal/framelab)
- [Issues](https://github.com/salianahshal/framelab/issues)
- [MCP setup guide](https://github.com/salianahshal/framelab/blob/main/packages/cli/MCP.md)

## License

[MIT](https://github.com/salianahshal/framelab/blob/main/LICENSE) © salianahshal
