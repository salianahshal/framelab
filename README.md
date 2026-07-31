<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/canvas/logo-dark-bg.svg">
  <img src="packages/canvas/logo-light-bg.svg" alt="Framelab" width="72" height="72">
</picture>

# Framelab

**Visual editor for Next.js + Tailwind. Runs on your machine, edits your files.**

Click any element in your running app, adjust its Tailwind classes visually, and
Framelab writes the change straight back into your source — byte-surgical AST
edits, no formatting churn, no cloud round-trip.

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
  server on localhost and edits files in place.
- **Byte-surgical diffs.** Only the `className` value changes. Your formatting,
  comments, and import order survive untouched — `git diff` stays reviewable.
- **Theme-aware.** Colors, spacing, and radii come from your own
  `tailwind.config.{js,ts}`, so you edit in `brand` and `card`, not `#6e56cf`
  and `14px`.
- **Your git workflow, unchanged.** Changes land as ordinary working-tree edits.
  Review them, revert a hunk, or commit them like anything else.

## Quick start

Framelab attaches to a dev server you're already running.

```sh
cd your-next-app

npx framelab init          # detect the project, write babel.config.js + .env wiring
npm install --save-dev @framelab/babel-plugin @babel/runtime

npm run dev                # terminal 1 — your app
npx framelab               # terminal 2 — the canvas
```

`framelab` finds your dev server automatically (it probes the port in your
`dev` script, then 3000-3003, 4000, 5173, 5174, 8080), opens the canvas on
**http://localhost:3133**, and starts watching your source.

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

## Use it from your AI editor

Framelab also ships an MCP server, which gives Claude Code, Cursor, Continue, or
Windsurf the same token-aware, byte-surgical editing the canvas uses — instead
of letting the model guess at class strings.

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

Nine tools are exposed — `find_elements`, `get_element`, `list_design_tokens`,
`update_styles`, `update_text`, `move_sibling`, `list_files`, `commit`, and
`get_diff`. Run the canvas at the same time and you'll watch the model's edits
land live.

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

## Development

The packages are linked with `file:` dependencies and install independently:

```sh
cd packages/babel-plugin && npm install && npm test
cd packages/server       && npm install && npm test
```

Or run both suites from the root:

```sh
npm test
```

[`examples/test-next-app`](examples/test-next-app) is a minimal Next.js 14 +
Tailwind app used as the integration fixture. Its `tailwind.config.js` custom
theme is asserted by the server's themeEngine tests — if you change the
`brand`, `surface`, or `accent` tokens, the `card` radius, the `gutter`
spacing, or the `card` shadow, update `packages/server/test/run.js` to match.

[`examples/click-test-harness.html`](examples/click-test-harness.html) exercises
the click runtime in isolation.

## License

[MIT](LICENSE) © salianahshal
