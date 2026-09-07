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
3. Calls `update_styles({ framelabId, props: { background: "brand", borderRadius: "card", boxShadow: "card" } })`
4. Optionally calls `commit({ message: "style(button): use brand color and card radius" })`

The file changes byte-surgically. A clean conventional-commits-style commit lands.

## Tools exposed

| Tool | Purpose |
|---|---|
| `get_selection` | What the user is pointing at in the canvas, right now |
| `list_files` | List all `.tsx`/`.jsx` files in the project |
| `find_elements` | Search elements by tag, className substring, or text |
| `get_element` | Full element details + parsed Tailwind props |
| `list_design_tokens` | Project's `tailwind.config` tokens (colors, spacing, etc.) |
| `update_styles` | Edit Tailwind classes via structured props, base or per-variant |
| `update_text` | Replace an element's text content |
| `move_sibling` | Reorder siblings (same parent only) |
| `delete_element` | Remove an element and its children, returning how to restore it |
| `restore_element` | Put a deleted element back, byte for byte |
| `commit` | Atomic git commit with the given message |
| `get_diff` | Current pending git diff |

Each tool returns structured JSON the AI can reason over. See
`packages/cli/src/mcp.js` for full input/output schemas.

### Editing responsive and state styles

`update_styles` takes an optional `variants` array. It writes the variant
prefix and leaves the base styles alone:

```jsonc
{ "framelabId": "...", "props": { "padding": { "top": "8" } }, "variants": ["md"] }
// p-4  ->  p-4 md:pt-8

{ "framelabId": "...", "props": { "background": "brand" }, "variants": ["md", "hover"] }
// adds md:hover:bg-brand
```

### Pointing instead of describing

When the canvas is running, `get_selection` answers "what is the user looking
at?" — so "make this button bigger" stops being a search problem.

```jsonc
// get_selection()
{
  "selected": true,
  "file": "pages/index.tsx",
  "element": {
    "framelabId": "button|/abs/pages/index.tsx|42|1180",
    "tagName": "button", "line": 42,
    "className": "px-4 py-2 rounded-card bg-brand text-white",
    "props": { "background": "brand", "borderRadius": "card", "padding": {...} },
    "variants": ["", "md"]
  },
  "ancestors": [{ "tagName": "main", "line": 8 }, { "tagName": "div", "line": 30 }],
  "editingVariant": { "breakpoint": "md", "state": "", "prefix": "md" },
  "computedStyle": { "backgroundColor": "rgb(110, 86, 207)" }
}
```

`editingVariant` is intent, not decoration. If the user has the `md` tab open in
the inspector, they mean the `md` breakpoint — pass the same `variants` to
`update_styles` so the change lands where they are looking.

The selection is re-read from the file on every call, so an agent never acts on
a class string that went stale while it was thinking.

### The design system is the schema

`update_styles` checks every value against the scales in the project's own
`tailwind.config` before writing. A typo becomes an answerable error instead of
a class Tailwind silently drops:

```
These values are not part of the project's design system:
  - "embr" is not in this project's colour palette. Did you mean "ember"?
```

Off-scale numbers get the nearest steps that do exist (`"5"` → `"4"`, `"6"`).
Bracketed arbitrary values (`"[#ff0000]"`, `"[13px]"`) always pass, since those
are a deliberate decision rather than a mistake. `force: true` overrides the
check when you really mean it.

Pair it with `preview: true` to see the resulting class string without touching
the file:

```jsonc
// update_styles({ framelabId, props: { background: "ember" }, variants: ["md"], preview: true })
{ "preview": true,
  "previousClassName": "px-4 py-2 rounded-card bg-brand text-white",
  "nextClassName":     "px-4 py-2 rounded-card bg-brand text-white md:bg-ember" }
```

Because edits are structured (`{prop, value, variants}`) rather than raw text,
a model cannot reorder your classes, drop the ones it did not recognise, or
produce a className that fails to parse. The parser renders the class string;
the model only chooses values.

### Deleting safely

`delete_element` returns the source it removed plus `parentKey` and `index`:

```jsonc
// delete_element({ framelabId })
{ "ok": true, "tagName": "button", "index": 1,
  "parentKey": "0.0.2", "removed": "<button className=\"b\">Remove me</button>",
  "filePath": "/abs/path/Card.tsx" }
```

Pass those four values straight back to `restore_element` to undo it. The
outermost element of a component is refused, since removing it would leave the
component returning nothing.

### What can be edited

| className shape | Editable |
|---|---|
| `className="p-4 flex"` | yes |
| ``className={`p-4 ${ring}`}`` | yes — the interpolation keeps its position |
| `className={cn('p-4', active && 'bg-red')}` | yes — the first string argument |
| `className={clsx(...)}`, `twMerge(...)`, `cva(...)` | yes |
| `className={a ? 'p-2' : 'p-4'}` | no — refused rather than guessed at |
| `className={styles.root}` | no |

An edit replaces only the tokens belonging to the properties you name. Class
order, unrecognised utilities, variants and arbitrary values are preserved
exactly, and a write that would not re-parse is refused rather than applied.

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
