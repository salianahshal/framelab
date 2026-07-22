'use strict';

// MCP (Model Context Protocol) server for Framelab.
//
// Exposes Framelab's AST + token + git capabilities to MCP-aware AI clients
// (Claude Code, Cursor, Continue, Windsurf, etc.) via stdio JSON-RPC 2.0.
//
// Why a manual implementation rather than @modelcontextprotocol/sdk: the SDK
// is ESM-only and our CLI is CJS. The MCP wire format is small (newline-
// delimited JSON-RPC 2.0); ~150 lines of plain Node beats the dependency tree.
//
// Architecture: this process holds no HTTP server of its own. It calls
// astEngine/tailwindParser/themeEngine/gitEngine directly, writes files
// straight to disk. If the user has `framelab` (the canvas) running in
// another terminal, chokidar in that process notices the writes and pushes
// FILE_SYNC to the canvas. The filesystem is the IPC.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const detect = require('./detect');
const snapshot = require('./snapshot');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'framelab';
const SERVER_VERSION = require('../package.json').version;

// Lazily resolved so `framelab mcp --help` doesn't pay startup cost.
let engines = null;
function loadEngines() {
  if (engines) return engines;
  const cf = require('@framelab/server');
  engines = {
    ast: cf.astEngine,
    tailwind: cf.tailwindParser,
    theme: cf.themeEngine,
    git: cf.gitEngine,
  };
  return engines;
}

// ---------- Helpers ----------

function listFilesRecursive(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next' ||
          entry.name === '.git' || entry.name === 'dist' ||
          entry.name === 'build' || entry.name === '.turbo') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && /\.(tsx|jsx)$/.test(full) &&
               !/\.(test|spec)\.(tsx|jsx)$/.test(full)) out.push(full);
    }
  }
  return out.sort();
}

function filePathFromFramelabId(id) {
  const i1 = id.indexOf('|');
  const i3 = id.lastIndexOf('|');
  const i2 = id.lastIndexOf('|', i3 - 1);
  if (i1 < 0 || i2 < 0 || i3 < 0) {
    throw new Error(`Invalid framelabId: ${id}`);
  }
  return id.slice(i1 + 1, i2);
}

function relPathFrom(rootDir, abs) {
  const rel = path.relative(rootDir, abs);
  return rel.startsWith('..') ? abs : rel;
}

// ---------- Tools ----------

function buildTools(rootDir) {
  return [
    {
      name: 'list_files',
      description:
        'List all .tsx/.jsx files in the project (excludes node_modules, .next, tests). ' +
        'Use this to discover the file structure before searching for elements.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'find_elements',
      description:
        'Search for JSX elements. Returns elements with their stable ' +
        'framelabId (used in subsequent calls), tagName, line, className, and textContent.\n\n' +
        'textKind tells you what\'s editable:\n' +
        '- "text": single text child — can use update_text\n' +
        '- "expression": dynamic {expr} children — text edits not supported\n' +
        '- "children": contains other elements\n' +
        '- "empty": no children — update_text will insert content\n\n' +
        'Filters compose; omit all to list every element. Caps at 200 per call.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'One file to search (absolute or relative to project root). Omit to search all files.' },
          tagName: { type: 'string', description: 'Filter by tag, e.g. "button" or "h1"' },
          classNameContains: { type: 'string', description: 'Filter by substring in className' },
          textContains: { type: 'string', description: 'Filter by substring in textContent' },
          limit: { type: 'number', description: 'Max results (default 200)' },
        },
      },
    },
    {
      name: 'get_element',
      description:
        'Get full details for one element: tagName, line, className, textContent, ' +
        'and parsed Tailwind props (background, textColor, padding, margin, rounded, etc.). ' +
        'Use the parsed props to understand the current visual state before editing.',
      inputSchema: {
        type: 'object',
        required: ['framelabId'],
        properties: {
          framelabId: { type: 'string', description: 'From find_elements' },
        },
      },
    },
    {
      name: 'list_design_tokens',
      description:
        'Return the project\'s design system tokens read from tailwind.config.{ts,js}: ' +
        'custom colors, spacing, fontSize, borderRadius, boxShadow, fontWeight. ' +
        'Each category has { all, custom, defaults }. Custom tokens are project-specific ' +
        '(e.g., "brand", "surface-2"); defaults are stock Tailwind. ' +
        'STRONGLY PREFER project tokens over arbitrary values like [#ff0000] or [18px] — ' +
        'this is the user\'s design system, respect it.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'update_styles',
      description:
        'Edit Tailwind classes on an element via structured props. The change is ' +
        'byte-surgical — only the className value changes, every other byte of the file ' +
        'is preserved exactly. No formatting churn.\n\n' +
        'Example props:\n' +
        '  { "background": "blue-600" }              → adds bg-blue-600\n' +
        '  { "background": "[#ff0000]" }             → adds bg-[#ff0000] (arbitrary)\n' +
        '  { "padding": { "top": "4", "right": "6", "bottom": "4", "left": "6" } }\n' +
        '  { "rounded": "lg", "borderWidth": "2", "borderColor": "zinc-200" }\n' +
        '  { "display": "flex", "flexDirection": "col", "gap": "4" }\n\n' +
        'Set a value to null to remove that style. ' +
        'Call list_design_tokens first to learn the project\'s token names. ' +
        'Refuses elements with non-static className expressions (cn(), template literals).',
      inputSchema: {
        type: 'object',
        required: ['framelabId', 'props'],
        properties: {
          framelabId: { type: 'string' },
          props: {
            type: 'object',
            description: 'Tailwind property patch (see tool description for examples)',
          },
        },
      },
    },
    {
      name: 'update_text',
      description:
        'Replace the visible text of an element. Only works when textKind is "text" or "empty". ' +
        'For elements with dynamic children ({someVar}) or nested elements, this returns an error.',
      inputSchema: {
        type: 'object',
        required: ['framelabId', 'content'],
        properties: {
          framelabId: { type: 'string' },
          content: { type: 'string', description: 'New text content (preserves leading/trailing whitespace)' },
        },
      },
    },
    {
      name: 'move_sibling',
      description:
        'Reorder JSX elements within the same parent (e.g., swap two cards). Only same-parent ' +
        'moves are supported in this version. Position is "before" or "after" the target.',
      inputSchema: {
        type: 'object',
        required: ['sourceId', 'targetId', 'position'],
        properties: {
          sourceId: { type: 'string', description: 'framelabId of the element to move' },
          targetId: { type: 'string', description: 'framelabId of the sibling to move next to' },
          position: { type: 'string', enum: ['before', 'after'] },
        },
      },
    },
    {
      name: 'commit',
      description:
        'Commit all pending file changes to git with the given message. Returns the short SHA. ' +
        'Use conventional-commits-style messages (e.g., "style(button): use brand color"). ' +
        'For atomic commits per gesture, call this after each logical edit.',
      inputSchema: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
    },
    {
      name: 'get_diff',
      description:
        'Return the current pending git diff (unstaged changes since HEAD). Useful for ' +
        'reviewing what your edits will commit, or showing the user the visual + code change.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'snapshot',
      description:
        'Take a PNG screenshot of either a single JSX element (by framelabId) or a route ' +
        '(by path) of the running app. Returns the image inline so you can SEE the rendered ' +
        'output of your CSS edits. Use this to verify visual results after update_styles. ' +
        'Requires Google Chrome (or Chromium/Edge) installed locally; auto-detected.\n\n' +
        'Pass either framelabId (for an element-only screenshot) or path (for a full route). ' +
        'If neither is given, snapshots the app root.',
      inputSchema: {
        type: 'object',
        properties: {
          framelabId: { type: 'string', description: 'Snapshot just this element (preferred for verifying edits)' },
          path: { type: 'string', description: 'Route path like "/" or "/dashboard"' },
          appUrl: { type: 'string', description: 'Override base URL (default: auto-detect dev server)' },
          width: { type: 'number', description: 'Viewport width (default 1280)' },
          height: { type: 'number', description: 'Viewport height (default 800)' },
          fullPage: { type: 'boolean', description: 'Capture entire scrollable page (only for path snapshots)' },
        },
      },
    },
  ];
}

function buildHandlers(rootDir) {
  const { ast, tailwind, theme, git } = loadEngines();
  // Track recent writes so snapshot tools can wait for Next.js HMR to settle
  // before screenshotting (otherwise the second snapshot races the first).
  // 1500ms empirically covers Next.js dev recompile + Chrome resource refetch
  // even when the file change happens mid-session.
  let lastWriteAt = 0;
  const HMR_SETTLE_MS = 1500;
  async function waitForHmrSettle() {
    const since = Date.now() - lastWriteAt;
    if (since >= 0 && since < HMR_SETTLE_MS) {
      await new Promise((r) => setTimeout(r, HMR_SETTLE_MS - since));
    }
  }

  return {
    list_files: async () => ({
      rootDir,
      files: listFilesRecursive(rootDir).map((f) => ({
        absolute: f,
        relative: relPathFrom(rootDir, f),
      })),
    }),

    find_elements: async (args = {}) => {
      const { filePath, tagName, classNameContains, textContains } = args;
      const limit = Number(args.limit) > 0 ? Number(args.limit) : 200;
      let targets;
      if (filePath) {
        const abs = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
        if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
        targets = [abs];
      } else {
        targets = listFilesRecursive(rootDir);
      }
      const out = [];
      for (const f of targets) {
        let extracted;
        try { extracted = ast.extractElements(f).elements; }
        catch (err) { continue; }
        for (const el of extracted) {
          if (tagName && el.tagName !== tagName) continue;
          if (classNameContains &&
              (!el.className || !el.className.includes(classNameContains))) continue;
          if (textContains &&
              (!el.textContent || !el.textContent.includes(textContains))) continue;
          out.push({
            framelabId: el.framelabId,
            tagName: el.tagName,
            file: relPathFrom(rootDir, f),
            line: el.line,
            className: el.className,
            classNameKind: el.classNameKind,
            textContent: el.textContent,
            textKind: el.textKind,
          });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
      return { count: out.length, truncated: out.length >= limit, elements: out };
    },

    get_element: async ({ framelabId }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const { elements } = ast.extractElements(filePath);
      const el = elements.find((e) => e.framelabId === framelabId);
      if (!el) throw new Error(`Element not found in source: ${framelabId}`);
      const parsed = el.className ? tailwind.parseClassName(el.className) : null;
      return {
        ...el,
        file: relPathFrom(rootDir, filePath),
        parsedProps: parsed,
      };
    },

    list_design_tokens: async () => {
      return await theme.loadTheme(rootDir);
    },

    update_styles: async ({ framelabId, props }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const current = ast.getClassName(filePath, framelabId);
      if (!current.found) throw new Error(`Element not found: ${framelabId}`);
      if (current.kind === 'expression') {
        throw new Error('className uses an expression (cn()/template literal); cannot edit programmatically.');
      }
      const nextClassName = tailwind.mergeProps(current.className || '', props || {});
      const result = ast.updateClassName(filePath, framelabId, nextClassName);
      if (!result.ok) throw new Error(`Update failed: ${result.reason}`);
      // Mark that we just wrote, so the next snapshot waits a beat for HMR.
      lastWriteAt = Date.now();
      return {
        ok: true,
        file: relPathFrom(rootDir, filePath),
        previousClassName: current.className,
        nextClassName,
      };
    },

    update_text: async ({ framelabId, content }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const result = ast.updateTextContent(filePath, framelabId, content);
      if (!result.ok) throw new Error(`Update failed: ${result.reason}`);
      lastWriteAt = Date.now();
      return {
        ok: true,
        file: relPathFrom(rootDir, filePath),
        previousText: result.previous,
        nextText: result.next,
      };
    },

    move_sibling: async ({ sourceId, targetId, position }) => {
      const filePath = filePathFromFramelabId(sourceId);
      const result = ast.moveElement(filePath, sourceId, targetId, position);
      if (!result.ok) throw new Error(`Move failed: ${result.reason}`);
      lastWriteAt = Date.now();
      return { ok: true, file: relPathFrom(rootDir, filePath), noChange: !!result.noChange };
    },

    commit: async ({ message }) => {
      const result = await git.commit(rootDir, message);
      if (!result.ok) throw new Error(`Commit failed: ${result.reason}`);
      return { ok: true, sha: result.sha };
    },

    get_diff: async () => {
      const status = await git.getStatus(rootDir);
      const diff = await git.getDiff(rootDir);
      return {
        initialized: status.initialized,
        files: status.files,
        diff: diff.diff,
      };
    },

    snapshot: async (args = {}) => {
      // If we just wrote a file, give Next.js a moment to recompile so the
      // screenshot reflects the *post-edit* render rather than the stale one.
      await waitForHmrSettle();
      let appUrl = args.appUrl;
      if (!appUrl) {
        const detected = await detect.findRunningDevServer(rootDir);
        if (!detected) {
          throw new Error(
            'No running dev server found. Start your app first (e.g. npm run dev), ' +
            'or pass appUrl explicitly.'
          );
        }
        appUrl = detected.url;
      }
      // Apply optional path
      if (args.path) {
        appUrl = appUrl.replace(/\/$/, '') + (args.path.startsWith('/') ? args.path : '/' + args.path);
      }
      const viewport = {
        width: Number(args.width) > 0 ? Number(args.width) : 1280,
        height: Number(args.height) > 0 ? Number(args.height) : 800,
      };

      const t0 = Date.now();
      let raw;
      let kind;
      if (args.framelabId) {
        kind = 'element';
        raw = await snapshot.snapshotElement({
          appUrl,
          framelabId: args.framelabId,
          viewport,
        });
      } else {
        kind = 'page';
        raw = await snapshot.snapshotPage({
          appUrl,
          viewport,
          fullPage: !!args.fullPage,
        });
      }
      const ms = Date.now() - t0;
      // Newer puppeteer returns Uint8Array; coerce to Buffer for base64 encoding
      const png = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

      // Return as MCP content array: a description text + the image itself.
      return [
        {
          type: 'text',
          text: `Captured ${kind} screenshot of ${appUrl} ` +
                `(${viewport.width}x${viewport.height}, ${png.length} bytes, ${ms}ms)`,
        },
        {
          type: 'image',
          data: png.toString('base64'),
          mimeType: 'image/png',
        },
      ];
    },
  };
}

// ---------- JSON-RPC stdio loop ----------

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  send({ jsonrpc: '2.0', id, error: err });
}

function logStderr(...args) {
  process.stderr.write(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') + '\n');
}

async function handleMessage(msg, ctx) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: { listChanged: false } },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'tools/list') return reply(id, { tools: ctx.tools });
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const handler = ctx.handlers[name];
    if (!handler) return replyError(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await handler(args || {});
      // If the handler returns a content array (e.g. for image responses),
      // pass it through unchanged. Otherwise wrap as a single text block.
      let content;
      if (Array.isArray(result)) {
        content = result;
      } else {
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        content = [{ type: 'text', text }];
      }
      return reply(id, { content, isError: false });
    } catch (err) {
      return reply(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }
  if (id !== undefined) replyError(id, -32601, `Unknown method: ${method}`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.rootDir = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`
framelab mcp — MCP server (stdio) for AI clients

Usage:
  framelab mcp [--root <dir>]

Options:
  --root <dir>    Project root to operate on (default: cwd)

This is a Model Context Protocol server. Configure it in Claude Code,
Cursor, or any MCP-aware client like:

  {
    "framelab": {
      "command": "npx",
      "args": ["framelab", "mcp", "--root", "/path/to/your/project"]
    }
  }

Tools exposed: list_files, find_elements, get_element,
list_design_tokens, update_styles, update_text, move_sibling, commit, get_diff.
`);
}

async function startMcp(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { printHelp(); return; }

  const rootDir = path.resolve(opts.rootDir || process.cwd());
  if (!fs.existsSync(rootDir)) {
    logStderr(`[framelab mcp] root directory not found: ${rootDir}`);
    process.exit(1);
  }

  const tools = buildTools(rootDir);
  const handlers = buildHandlers(rootDir);
  const ctx = { rootDir, tools, handlers };

  logStderr(`[framelab mcp] ready; rootDir=${rootDir}; tools=${tools.length}`);

  process.stdin.setEncoding('utf8');
  const rl = readline.createInterface({ input: process.stdin });
  // Track in-flight requests so we don't exit while a tool call (e.g. git
  // commit, which spawns a subprocess) is still running.
  const pending = new Set();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); }
    catch (err) {
      logStderr('[framelab mcp] invalid JSON line:', trimmed.slice(0, 200));
      return;
    }
    const p = handleMessage(msg, ctx).catch((err) => {
      logStderr('[framelab mcp] handler error:', err.stack || err.message);
      if (msg.id !== undefined) replyError(msg.id, -32000, err.message);
    });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  rl.on('close', async () => {
    if (pending.size) await Promise.allSettled([...pending]);
    try { await snapshot.shutdown(); } catch {}
    process.exit(0);
  });
}

module.exports = startMcp;
