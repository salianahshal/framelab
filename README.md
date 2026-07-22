# Framelab

Visual editor CLI for Next.js + Tailwind. No cloud, no sandbox — edits your local files with byte-clean diffs.

Click any element on the canvas to inspect its source location, tweak Tailwind classes visually, and have the changes written straight back to your source files via AST-level edits.

## Packages

| Package | Description |
| --- | --- |
| [packages/cli](packages/cli) | `framelab` CLI — `init`, `start`, and an MCP server (stdio) for Claude Code / Cursor / Continue (see [MCP.md](packages/cli/MCP.md)) |
| [packages/server](packages/server) | Sync server: file watcher, AST writer, Tailwind theme/class parsing, git hunk revert, REST + WebSocket bridge |
| [packages/babel-plugin](packages/babel-plugin) | Tags JSX elements with `data-framelab-id` so the canvas can map clicks back to source; optionally injects the click runtime |
| [packages/canvas](packages/canvas) | The browser canvas UI (static, served by the sync server on port 3133) |

## Quick start

```sh
cd your-next-app
framelab init    # writes babel.config.js and .env wiring
framelab         # starts the canvas + sync server and opens the browser
```

Options for `start`: `--app-url <url>`, `--port <n>` (canvas, default 3133), `--api-port <n>` (default 3131), `--root <dir>`, `--no-open`. Per-project config goes in `.framelabrc.json`.

Requires Node >= 18.

## Development

Each package installs independently (they are linked via `file:` dependencies):

```sh
cd packages/babel-plugin && npm install && npm test
cd packages/server && npm install && npm test
```

[examples/test-next-app](examples/test-next-app) is a minimal Next.js 14 + Tailwind app used as the integration fixture — its `tailwind.config.js` custom theme (`brand`, `surface`, `accent`, radius `card`, spacing `gutter`, shadow `card`) is asserted by the server's themeEngine tests, so keep it in sync with `packages/server/test/run.js` if you change it. [examples/click-test-harness.html](examples/click-test-harness.html) exercises the click runtime in isolation.
