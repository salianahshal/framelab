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
const http = require('http');
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

// Reach the canvas server, if one is running for this project. It is started
// in a separate terminal, so its port comes from the session registry it writes.
function canvasSession(rootDir) {
  try {
    const { session } = require('@framelab/server');
    return session.read(rootDir);
  } catch {
    return null;
  }
}

function getJson(port, urlPath, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: urlPath, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
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
      name: 'get_selection',
      description:
        'Return the element the user currently has selected in the Framelab canvas — ' +
        'what they are pointing at right now.\n\n' +
        'Use this FIRST whenever the user says "this", "that button", "the header here", ' +
        'or otherwise refers to something on screen without naming a file. It saves ' +
        'searching the codebase and removes the guesswork about which element they mean.\n\n' +
        'Returns the exact source location (file and line), the framelabId to pass to ' +
        'update_styles / update_text / snapshot, the parsed Tailwind props, the variant ' +
        'map, the ancestor and child chain, and the element\'s computed style as rendered.\n\n' +
        'It also returns `editingVariant`: if the user has a breakpoint or state tab open ' +
        'in the inspector, they mean that variant. Pass the same `variants` to ' +
        'update_styles so the edit lands where they are looking.\n\n' +
        'Requires the canvas to be running (`npx framelab` in another terminal).',
      inputSchema: { type: 'object', properties: {} },
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
        'Edit Tailwind classes on an element via structured props. Only the tokens ' +
        'for the properties you name are replaced: class order, unrecognised ' +
        'utilities, responsive variants and comments are all preserved byte for byte.\n\n' +
        'Example props:\n' +
        '  { "background": "blue-600" }              → bg-blue-600\n' +
        '  { "background": "[#ff0000]" }             → bg-[#ff0000] (arbitrary value)\n' +
        '  { "padding": { "top": "4", "right": "6", "bottom": "4", "left": "6" } }\n' +
        '  { "borderRadius": "lg", "borderWidth": "2", "borderColor": "zinc-200" }\n' +
        '  { "display": "flex", "flexDirection": "col", "gap": "4" }\n' +
        '  { "textAlign": "center", "fontSize": "lg", "boxShadow": "card" }\n\n' +
        'Set a value to null to remove that style.\n\n' +
        'Pass `variants` to target a responsive or state variant instead of the base ' +
        'styles: variants ["md"] writes md:*, ["hover"] writes hover:*, ["md","hover"] ' +
        'writes md:hover:*. Base styles are left alone.\n\n' +
        'Call list_design_tokens first and prefer the project\'s own token names. ' +
        'Works on plain strings, template literals (interpolations are preserved in ' +
        'place) and cn()/clsx()/twMerge() calls (the first string argument is edited). ' +
        'Refuses ternaries and other expressions it cannot rewrite safely.',
      inputSchema: {
        type: 'object',
        required: ['framelabId', 'props'],
        properties: {
          framelabId: { type: 'string' },
          props: {
            type: 'object',
            description: 'Tailwind property patch (see tool description for examples)',
          },
          variants: {
            type: 'array',
            items: { type: 'string' },
            description: 'Variant prefixes to write under, e.g. ["md"] or ["md","hover"]. Omit for base styles.',
          },
          preview: {
            type: 'boolean',
            description: 'Return the resulting className without writing the file. Use it to check your work first.',
          },
          force: {
            type: 'boolean',
            description: 'Write values that are not in the project design system anyway. Prefer a real token or a bracketed arbitrary value.',
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
      name: 'delete_element',
      description:
        'Remove a JSX element and everything inside it from the source. The line ' +
        'break and indentation that introduced it go too, so no blank line is left ' +
        'behind.\n\n' +
        'Returns the removed source text along with `parentKey` and `index`, which ' +
        'restore_element takes to put it back exactly where it was. Keep them if ' +
        'there is any chance the user wants it undone.\n\n' +
        'Refuses the outermost element of a component, which would leave the ' +
        'component returning nothing.',
      inputSchema: {
        type: 'object',
        required: ['framelabId'],
        properties: {
          framelabId: { type: 'string', description: 'From find_elements' },
        },
      },
    },
    {
      name: 'duplicate_element',
      description:
        'Copy an element and everything inside it, inserting the copy directly ' +
        'after the original as its next sibling. Indentation matches its ' +
        'neighbours.\n\n' +
        'Use it to add a card to a grid, a row to a list, or a second button — ' +
        'then update_text and update_styles the copy. Refuses the outermost ' +
        'element of a component, which has no sibling slot.',
      inputSchema: {
        type: 'object',
        required: ['framelabId'],
        properties: { framelabId: { type: 'string', description: 'From find_elements' } },
      },
    },
    {
      name: 'find_drift',
      description:
        'Find hardcoded values that a project design token already covers — ' +
        '`bg-[#6e56cf]` where the config defines `brand`, `p-[16px]` where the ' +
        'spacing scale has `4`, `rounded-[14px]` where there is a `card` radius.\n\n' +
        'These render identically today and diverge the moment the token changes, ' +
        'so they are the measurable form of design-system drift. Units are ' +
        'normalised, so `1rem` and `16px` match, and a project\'s own token is ' +
        'preferred over a stock Tailwind step of the same value.\n\n' +
        'Pass a filePath to scan one file, or omit it to scan the project. ' +
        'Use fix_drift to apply the replacements.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'One file to scan. Omit to scan everything.' },
        },
      },
    },
    {
      name: 'fix_drift',
      description:
        'Replace hardcoded values with the project tokens that already match ' +
        'them, as reported by find_drift. Only the drifted class tokens change; ' +
        'everything else in the file is untouched.\n\n' +
        'Scope it with filePath, or omit to fix the whole project. Run find_drift ' +
        'first and show the user what will change — this rewrites source.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'One file to fix. Omit to fix everything.' },
          framelabId: { type: 'string', description: 'Fix a single element only.' },
        },
      },
    },
    {
      name: 'restore_element',
      description:
        'Undo a delete_element by re-inserting the source it returned at the same ' +
        'position. Pass back the `filePath`, `parentKey`, `index` and `removed` ' +
        'values from that call; the file is restored byte for byte.',
      inputSchema: {
        type: 'object',
        required: ['filePath', 'parentKey', 'index', 'source'],
        properties: {
          filePath: { type: 'string', description: 'File the element was deleted from' },
          parentKey: { type: 'string', description: 'parentKey from delete_element' },
          index: { type: 'number', description: 'index from delete_element' },
          source: { type: 'string', description: 'removed source from delete_element' },
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
  // Project token names make class parsing exact (`shadow-card` is a shadow,
  // not junk), so load them once and reuse.
  let themeTokensCache;
  async function loadThemeTokens() {
    if (themeTokensCache !== undefined) return themeTokensCache;
    try {
      const loaded = await theme.loadTheme(rootDir);
      themeTokensCache = (loaded && loaded.tokens) || null;
    } catch {
      themeTokensCache = null;
    }
    return themeTokensCache;
  }
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

    get_selection: async () => {
      const info = canvasSession(rootDir);
      if (!info) {
        return {
          selected: false,
          reason: 'canvas-not-running',
          hint: 'No Framelab canvas is running for this project. Ask the user to run ' +
                '`npx framelab` in another terminal, then click the element they mean.',
        };
      }
      const payload = await getJson(info.port, '/selection');
      if (!payload) {
        return {
          selected: false,
          reason: 'canvas-unreachable',
          hint: `The canvas server on port ${info.port} did not respond. It may have just exited.`,
        };
      }
      if (!payload.selected) return payload;
      return {
        ...payload,
        next: 'Pass element.framelabId to update_styles, update_text or snapshot. ' +
              'If editingVariant.prefix is set, pass those variants to update_styles.',
      };
    },

    get_element: async ({ framelabId }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const { elements } = ast.extractElements(filePath);
      const el = elements.find((e) => e.framelabId === framelabId);
      if (!el) throw new Error(`Element not found in source: ${framelabId}`);
      const themeTokens = await loadThemeTokens();
      const parsed = el.className
        ? tailwind.parseClassName(el.className, themeTokens ? { theme: themeTokens } : undefined)
        : null;
      return {
        ...el,
        file: relPathFrom(rootDir, filePath),
        parsedProps: parsed ? { props: parsed.props, unknown: parsed.unknown } : null,
        variants: parsed ? parsed.variants : [],
        variantProps: parsed ? parsed.variantProps : {},
      };
    },

    list_design_tokens: async () => {
      return await theme.loadTheme(rootDir);
    },

    update_styles: async ({ framelabId, props, variants, preview, force }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const current = ast.getClassName(filePath, framelabId);
      if (!current.found) throw new Error(`Element not found: ${framelabId}`);
      if (!current.editable) {
        throw new Error(
          'className is an expression Framelab will not rewrite (a ternary or a ' +
          'variable). Edit this element in the source directly.'
        );
      }
      const themeTokens = await loadThemeTokens();
      const opts = themeTokens ? { theme: themeTokens } : undefined;
      const edits = Object.entries(props || {}).map(([prop, value]) => ({
        prop: tailwind.PROP_ALIASES[prop] || prop,
        value,
        variants: Array.isArray(variants) ? variants : [],
      }));

      // The project's own scales are the schema. A value outside them would
      // compile to a class Tailwind silently drops, so it is refused with the
      // nearest real names attached rather than written and forgotten.
      const problems = tailwind.validateEdits(edits, themeTokens);
      if (problems.length && !force) {
        const lines = problems.map((p) => '  - ' + p.message);
        throw new Error(
          'These values are not part of the project\'s design system:\n' +
          lines.join('\n') +
          '\n\nUse one of the suggested tokens, an arbitrary value in brackets ' +
          '(e.g. "[#ff0000]" or "[13px]") if you genuinely mean to step off the ' +
          'scale, or pass force: true to write it anyway.'
        );
      }

      const nextClassName = tailwind.applyEdits(current.className || '', edits, opts);

      if (preview) {
        return {
          preview: true,
          file: relPathFrom(rootDir, filePath),
          previousClassName: current.className,
          nextClassName,
          note: 'Nothing was written. Call again without preview to apply.',
        };
      }
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

    delete_element: async ({ framelabId }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const result = ast.deleteElement(filePath, framelabId);
      if (!result.ok) {
        if (result.reason === 'cannot-delete-root') {
          throw new Error(
            'That is the outermost element of the component; deleting it would ' +
            'leave the component returning nothing. Remove the component itself instead.'
          );
        }
        throw new Error(`Delete failed: ${result.reason}`);
      }
      lastWriteAt = Date.now();
      return {
        ok: true,
        file: relPathFrom(rootDir, filePath),
        filePath,
        tagName: result.tagName,
        removed: result.removed,
        parentKey: result.parentKey,
        index: result.index,
        restoreWith: 'restore_element',
      };
    },

    duplicate_element: async ({ framelabId }) => {
      const filePath = filePathFromFramelabId(framelabId);
      const result = ast.duplicateElement(filePath, framelabId);
      if (!result.ok) {
        if (result.reason === 'cannot-duplicate-root') {
          throw new Error(
            'That is the outermost element of the component, so it has no sibling ' +
            'slot to duplicate into. Duplicate one of its children instead.'
          );
        }
        throw new Error(`Duplicate failed: ${result.reason}`);
      }
      lastWriteAt = Date.now();
      const elements = ast.extractElements(filePath).elements;
      const copy = elements.find((e) => e.stableKey === `${result.parentKey}.${result.index}`);
      return {
        ok: true,
        file: relPathFrom(rootDir, filePath),
        tagName: result.tagName,
        index: result.index,
        copyFramelabId: copy ? copy.framelabId : null,
        next: 'Edit the copy with update_text / update_styles using copyFramelabId.',
      };
    },

    find_drift: async ({ filePath }) => {
      const themeTokens = await loadThemeTokens();
      if (!themeTokens) {
        return {
          available: false,
          reason: 'no-tailwind-config',
          hint: 'No tailwind.config could be resolved, so there are no tokens to compare against.',
        };
      }
      const targets = filePath
        ? [path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath)]
        : listFilesRecursive(rootDir);

      const files = [];
      let total = 0;
      for (const f of targets) {
        let elements;
        try { elements = ast.extractElements(f).elements; }
        catch { continue; }
        const hits = [];
        for (const el of elements) {
          if (!el.className) continue;
          const drift = tailwind.findDrift(el.className, themeTokens);
          if (!drift.length) continue;
          total += drift.length;
          hits.push({
            framelabId: el.framelabId,
            tagName: el.tagName,
            line: el.line,
            editable: el.classNameEditable,
            replacements: drift.map((d) => ({
              from: d.raw, to: d.suggestedClass, token: d.token, value: d.tokenValue,
            })),
          });
        }
        if (hits.length) files.push({ file: relPathFrom(rootDir, f), elements: hits });
      }
      return {
        available: true,
        total,
        files,
        summary: total
          ? `${total} hardcoded value${total === 1 ? '' : 's'} across ` +
            `${files.length} file${files.length === 1 ? '' : 's'} already have a project token.`
          : 'No drift: every value in scope is either a token or a deliberate one-off.',
        next: total ? 'Call fix_drift to apply these, optionally scoped to one file.' : undefined,
      };
    },

    fix_drift: async ({ filePath, framelabId }) => {
      const themeTokens = await loadThemeTokens();
      if (!themeTokens) throw new Error('No tailwind.config could be resolved.');
      const targets = filePath
        ? [path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath)]
        : listFilesRecursive(rootDir);

      const changed = [];
      let replaced = 0;
      for (const f of targets) {
        const done = new Set();
        let touched = false;
        // Re-read between writes: each one moves the offsets in the ids.
        for (let pass = 0; pass < 500; pass++) {
          let elements;
          try { elements = ast.extractElements(f).elements; }
          catch { break; }
          const next = elements.find((e) =>
            (!framelabId || e.framelabId === framelabId) &&
            !done.has(e.stableKey) &&
            e.className && e.classNameEditable !== false &&
            tailwind.findDrift(e.className, themeTokens).length > 0);
          if (!next) break;
          done.add(next.stableKey);
          const { className, fixed } = tailwind.applyDriftFixes(next.className, themeTokens);
          if (!fixed.length) continue;
          const r = ast.updateClassName(f, next.framelabId, className, {
            stableKey: next.stableKey,
          });
          if (!r.ok) continue;
          replaced += fixed.length;
          touched = true;
        }
        if (touched) changed.push(relPathFrom(rootDir, f));
      }
      lastWriteAt = Date.now();
      return { ok: true, replaced, files: changed };
    },

    restore_element: async ({ filePath, parentKey, index, source }) => {
      const abs = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
      const result = ast.insertElement(abs, parentKey, Number(index) || 0, source);
      if (!result.ok) throw new Error(`Restore failed: ${result.reason}`);
      lastWriteAt = Date.now();
      return { ok: true, file: relPathFrom(rootDir, abs) };
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
list_design_tokens, update_styles, update_text, move_sibling, delete_element,
restore_element, commit, get_diff, snapshot.
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
