# Framelab MCP — visual editing tools for AI

Framelab ships an MCP (Model Context Protocol) server that lets any
MCP-compatible AI client — Claude Code, Cursor, Continue, Windsurf — make
visual edits to your Next.js + Tailwind project with the same byte-surgical,
token-aware, atomic-commit guarantees you get from the canvas.

## Why this matters

Most AI coding tools today edit Tailwind blind. They don't know your design
tokens, can't see the rendered output, and often produce noisy diffs full of
formatting churn. Framelab-as-MCP-server lets AI work *through* a visual
toolkit:

- Edits use **structured props**, not raw class strings — no hallucinated classes
- The AI is guided to your **project's design tokens** (read from `tailwind.config.{js,ts}`)
- Every edit is **byte-surgical** — only the className value changes
- Each edit can become an **atomic git commit**
- If you have `framelab` (the canvas) running too, you see the AI's edits live

## Quickstart

### 1. Configure your AI client

#### Claude Code

Add to `~/.config/claude-code/mcp_settings.json`:

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

#### Cursor

Settings → Features → MCP → Add Server:

```json
{
  "framelab": {
    "command": "npx",
    "args": ["framelab", "mcp", "--root", "/absolute/path/to/your/project"]
  }
}
```

#### Continue (continue.dev)

In `~/.continue/config.json` under `experimental.modelContextProtocolServers`:

```json
{
  "transport": { "type": "stdio", "command": "npx", "args": ["framelab", "mcp", "--root", "/path/to/project"] }
}
```

### 2. (optional) Start the canvas in another terminal

```sh
cd /path/to/your/project
npx framelab
```

Now any edit your AI makes via MCP appears live in the canvas — chokidar in the
canvas process notices the file changes and pushes a snapshot refresh. The
filesystem is the IPC.

### 3. Ask the AI

> "Make the Get Started button use my brand color and the card border radius."

The AI:
1. Calls `find_elements({ tagName: "button" })` → discovers the button's stable framelabId
2. Calls `list_design_tokens()` → reads your project's `brand`, `card`, etc.
3. Calls `update_styles({ framelabId, props: { background: "brand", rounded: "card", shadow: "card" } })`
4. Optionally calls `commit({ message: "style(button): use brand color and card radius" })`

The file changes byte-surgically. A clean conventional-commits-style commit lands.

## Tools exposed

| Tool | Purpose |
|---|---|
| `list_files` | List all `.tsx`/`.jsx` files in the project |
| `find_elements` | Search elements by tag, className substring, or text |
| `get_element` | Full element details + parsed Tailwind props |
| `list_design_tokens` | Project's `tailwind.config` tokens (colors, spacing, etc.) |
| `update_styles` | Edit Tailwind classes via structured props |
| `update_text` | Replace an element's text content |
| `move_sibling` | Reorder siblings (same parent only) |
| `commit` | Atomic git commit with the given message |
| `get_diff` | Current pending git diff |

Each tool returns structured JSON the AI can reason over. See
`packages/cli/src/mcp.js` for full input/output schemas.

## Architecture

```
┌──────────────────┐    stdio JSON-RPC 2.0    ┌─────────────────────┐
│  Claude Code /   │ ◄──────────────────────► │  framelab mcp      │
│  Cursor / etc.   │                          │  (this process)     │
└──────────────────┘                          └──────────┬──────────┘
                                                         │
                                                  direct calls
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │ astEngine /         │
                                              │ tailwindParser /    │
                                              │ themeEngine /       │
                                              │ gitEngine           │
                                              └──────────┬──────────┘
                                                         │ writes files
                                                         ▼
┌──────────────────┐                          ┌─────────────────────┐
│ chokidar in      │ ◄────── file change ──── │  your source files  │
│ framelab canvas │                          └─────────────────────┘
│ (if running)     │
└──────────────────┘
```

The MCP process itself runs no HTTP server. It calls the engines directly,
writes files, and exits when stdin closes (after draining in-flight requests).

## CLI flags

```
framelab mcp [--root <dir>]
```

- `--root <dir>` — project root to operate on (default: current working directory)
- `--help` — show usage
