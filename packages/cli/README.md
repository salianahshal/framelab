# Framelab

Visual editor CLI for Next.js + Tailwind. No cloud, no sandbox — edits your local files with byte-clean diffs.

Click any element on the canvas to inspect its source location, tweak Tailwind classes visually, and have the changes written straight back to your source files via AST-level edits.

## Quick start

```sh
cd your-next-app
npx framelab init    # writes babel.config.js and .env wiring
npx framelab         # starts the canvas + sync server and opens the browser
```

Options for `start`: `--app-url <url>`, `--port <n>` (canvas, default 3133), `--api-port <n>` (default 3131), `--root <dir>`, `--no-open`. Per-project config goes in `.framelabrc.json`.

Framelab also ships an MCP server (stdio) for Claude Code / Cursor / Continue — see MCP.md in this package.

Requires Node >= 18.

## How it works

- `@framelab/babel-plugin` tags JSX elements with `data-framelab-id` in development so the canvas can map clicks back to source
- `@framelab/server` watches your files, applies AST-level class/text edits, and exposes a REST + WebSocket bridge
- `@framelab/canvas` is the browser UI, served locally on port 3133

MIT
