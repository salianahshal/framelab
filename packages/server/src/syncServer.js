'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');

const astEngine = require('./astEngine');
const tailwindParser = require('./tailwindParser');
const gitEngine = require('./gitEngine');
const themeEngine = require('./themeEngine');
const session = require('./session');

const SUPPORTED_EXT = new Set(['.tsx', '.jsx']);

function isSupportedFile(filePath) {
  return SUPPORTED_EXT.has(path.extname(filePath));
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
//
// This process writes to the filesystem on request. It listens on localhost,
// but "localhost" is reachable by any page the user happens to have open, so
// two guards are non-negotiable:
//
//   1. Every path in a request must resolve inside the watched root. Without
//      it, `{"filePath": "/Users/me/.zshrc"}` is a valid write.
//   2. Requests carrying a foreign Origin are refused, and the Host header must
//      be a loopback name. CORS alone does not help: the browser sends the
//      request and merely hides the response, which is plenty for a write.

// Resolve a path through symlinks as far as it exists. On macOS the temp and
// home directories are symlinks (/var -> /private/var), and bundlers report the
// resolved form while the CLI is started from the unresolved one. Comparing the
// two literally would reject the project's own files.
function canonical(p) {
  let current = path.resolve(p);
  const trailing = [];
  for (let i = 0; i < 40; i++) {
    try {
      return path.join(fs.realpathSync(current), ...trailing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
  return path.resolve(p);
}

function containedIn(rootDir, abs) {
  const pairs = [
    [path.resolve(rootDir), path.resolve(abs)],
    [canonical(rootDir), canonical(abs)],
  ];
  for (const [root, target] of pairs) {
    const rel = path.relative(root, target);
    if (rel === '') return true;
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}

function resolveInside(rootDir, candidate) {
  if (!candidate) return null;
  const raw = String(candidate);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootDir, raw);
  return containedIn(rootDir, abs) ? abs : null;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

function hostnameOf(value) {
  if (!value) return null;
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`http://${value}`);
    return url.hostname;
  } catch {
    return null;
  }
}

function isLoopback(name) {
  if (!name) return false;
  return LOOPBACK_HOSTS.has(name) || name === '::1';
}

function originGuard(req, res, next) {
  const host = hostnameOf(req.headers.host);
  if (host && !isLoopback(host)) {
    return res.status(403).json({ error: 'non-loopback Host rejected' });
  }
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const originHost = hostnameOf(origin);
    if (!isLoopback(originHost)) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
  }
  next();
}

function listFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.next' ||
          entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && isSupportedFile(full)) out.push(full);
    }
  }
  return out.sort();
}

function defaultCanvasDir() {
  try { return path.dirname(require.resolve('@framelab/canvas/index.html')); }
  catch {}
  return path.resolve(__dirname, '..', '..', 'canvas');
}

function createSyncServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const port = options.port || 3131;
  const canvasPort = options.canvasPort || 3133;
  const host = options.host || '127.0.0.1';
  const canvasDir = options.canvasDir || defaultCanvasDir();
  const serveCanvas = options.serveCanvas !== false;
  const watchedFiles = new Set();
  const suppressedFiles = new Map();

  // Theme tokens make class parsing exact (`rounded-card` is a radius, not
  // junk). Loaded once at boot and refreshed when tailwind.config changes.
  let themeCache = null;
  let themeKeys = null;

  function snapshotFile(filePath) {
    const { code, elements } = astEngine.extractElements(filePath);
    const opts = themeKeys ? { theme: themeKeys } : undefined;
    return {
      filePath,
      code,
      elements: elements.map((el) => ({
        ...el,
        props: el.className !== null
          ? tailwindParser.parseClassName(el.className, opts)
          : null,
      })),
    };
  }

  const app = express();
  app.use(cors({ origin: (o, cb) => cb(null, !o || isLoopback(hostnameOf(o))) }));
  app.use(express.json({ limit: '4mb' }));
  // A malformed body should come back as JSON like every other error here,
  // not as Express's default HTML error page.
  app.use((err, _req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    return next(err);
  });
  app.use(originGuard);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rootDir, watching: [...watchedFiles] });
  });

  app.get('/files', (_req, res) => {
    res.json({ rootDir, files: listFiles(rootDir) });
  });

  app.get('/snapshot', (req, res) => {
    if (req.query.filePath) {
      const filePath = resolveInside(rootDir, String(req.query.filePath));
      if (!filePath) return res.status(403).json({ error: 'path outside project root' });
      if (!isSupportedFile(filePath)) return res.status(400).json({ error: 'unsupported file' });
      try {
        return res.json(snapshotFile(filePath));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    const snapshots = [...watchedFiles].map((f) => {
      try { return snapshotFile(f); }
      catch (err) { return { filePath: f, error: err.message }; }
    });
    res.json({ rootDir, snapshots });
  });

  app.post('/watch', (req, res) => {
    const filePath = resolveInside(rootDir, (req.body || {}).filePath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    if (!fs.existsSync(filePath) || !isSupportedFile(filePath)) {
      return res.status(400).json({ error: 'unsupported or missing file' });
    }
    watchedFiles.add(filePath);
    try {
      const snap = snapshotFile(filePath);
      broadcast({ type: 'FILE_SYNC', source: 'watch', snapshot: snap });
      res.json({ ok: true, snapshot: snap });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- Theme ----------

  async function refreshTheme() {
    themeCache = await themeEngine.loadTheme(rootDir);
    themeKeys = themeCache && themeCache.tokens ? themeCache.tokens : null;
    broadcast({ type: 'THEME_SYNC', theme: themeCache });
    return themeCache;
  }

  app.get('/theme', async (_req, res) => {
    try {
      if (!themeCache) await refreshTheme();
      res.json(themeCache);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- Selection ----------
  //
  // The canvas publishes whatever the user has selected. `framelab mcp` runs in
  // a different process, so this is how an AI client answers "what is the user
  // pointing at?" without a browser extension or a screen grab.
  let selection = null;

  app.post('/selection', (req, res) => {
    const body = req.body || {};
    if (body.selected === false || !body.framelabId) {
      selection = null;
      return res.json({ ok: true, selected: false });
    }
    const filePath = body.filePath ? resolveInside(rootDir, body.filePath) : null;
    if (body.filePath && !filePath) {
      return res.status(403).json({ error: 'path outside project root' });
    }
    selection = {
      selected: true,
      framelabId: body.framelabId,
      stableKey: body.stableKey || null,
      filePath,
      breakpoint: body.breakpoint || '',
      state: body.state || '',
      viewportWidth: body.viewportWidth || null,
      computed: body.computed || null,
      rect: body.rect || null,
      updatedAt: Date.now(),
    };
    res.json({ ok: true });
  });

  // Rebuilt from the current file on every read, so an agent never acts on a
  // class string that went stale while it was thinking.
  app.get('/selection', (req, res) => {
    if (!selection || !selection.filePath) {
      return res.json({
        selected: false,
        rootDir,
        hint: 'Nothing is selected. Click an element in the Framelab canvas.',
      });
    }
    let snap;
    try { snap = snapshotFile(selection.filePath); }
    catch (err) { return res.status(500).json({ error: err.message }); }

    const byId = new Map(snap.elements.map((e) => [e.framelabId, e]));
    const el =
      byId.get(selection.framelabId) ||
      snap.elements.find((e) => e.stableKey === selection.stableKey);
    if (!el) {
      return res.json({
        selected: false,
        rootDir,
        hint: 'The selected element is no longer in the file. Re-select it in the canvas.',
      });
    }

    const ancestors = [];
    let cursor = el;
    let guard = 0;
    while (cursor && cursor.parentId && guard++ < 40) {
      const parent = byId.get(cursor.parentId);
      if (!parent) break;
      ancestors.unshift({
        tagName: parent.tagName,
        line: parent.line,
        framelabId: parent.framelabId,
        className: parent.className,
      });
      cursor = parent;
    }
    const children = snap.elements
      .filter((e) => e.parentId === el.framelabId)
      .map((e) => ({
        tagName: e.tagName, line: e.line, framelabId: e.framelabId,
        className: e.className, textContent: e.textContent,
      }));

    res.json({
      selected: true,
      rootDir,
      filePath: selection.filePath,
      file: path.relative(rootDir, selection.filePath),
      element: {
        framelabId: el.framelabId,
        stableKey: el.stableKey,
        tagName: el.tagName,
        line: el.line,
        column: el.column,
        className: el.className,
        classNameKind: el.classNameKind,
        editable: el.classNameEditable,
        helper: el.classNameHelper,
        textContent: el.textContent,
        textKind: el.textKind,
        props: el.props ? el.props.props : null,
        variants: el.props ? el.props.variants : [],
        variantProps: el.props ? el.props.variantProps : {},
      },
      ancestors,
      children,
      // What the user currently has open in the inspector: an agent editing on
      // their behalf should write to the same breakpoint and state.
      editingVariant: {
        breakpoint: selection.breakpoint,
        state: selection.state,
        prefix: [selection.breakpoint, selection.state].filter(Boolean).join(':'),
      },
      viewportWidth: selection.viewportWidth,
      computedStyle: selection.computed,
      rect: selection.rect,
      updatedAt: selection.updatedAt,
    });
  });

  // ---------- Diff ----------

  async function buildDiffPayload() {
    const [status, diff, suggested] = await Promise.all([
      gitEngine.getStatus(rootDir),
      gitEngine.getDiff(rootDir),
      gitEngine.suggestCommitMessage(rootDir).catch(() => ''),
    ]);
    return {
      initialized: status.initialized,
      files: status.files,
      diff: diff.diff,
      suggestedMessage: suggested,
    };
  }

  // Several writes can land in one gesture (a drag across a slider). Coalesce
  // the git work instead of shelling out three times per keystroke.
  let diffTimer = null;
  function broadcastDiff() {
    if (diffTimer) return;
    diffTimer = setTimeout(() => {
      diffTimer = null;
      buildDiffPayload()
        .then((payload) => broadcast({ type: 'DIFF_SYNC', diff: payload }))
        .catch(() => {});
    }, 120);
    if (diffTimer.unref) diffTimer.unref();
  }

  app.get('/diff', async (_req, res) => {
    try {
      res.json(await buildDiffPayload());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/diff/revert-file', async (req, res) => {
    const filePath = resolveInside(rootDir, (req.body || {}).filePath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    suppress(filePath);
    try {
      const r = await gitEngine.revertFile(rootDir, filePath);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      let snap = null;
      try { snap = snapshotFile(filePath); } catch {}
      if (snap) broadcast({ type: 'FILE_SYNC', source: 'revert', snapshot: snap });
      broadcastDiff();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/diff/revert-hunk', async (req, res) => {
    const { filePath: rawPath, hunkIndex } = req.body || {};
    if (!rawPath || typeof hunkIndex !== 'number') {
      return res.status(400).json({ error: 'filePath and hunkIndex required' });
    }
    const filePath = resolveInside(rootDir, rawPath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    suppress(filePath);
    try {
      const r = await gitEngine.revertHunk(rootDir, filePath, hunkIndex);
      if (!r.ok) return res.status(400).json({ error: r.reason, detail: r.detail });
      let snap = null;
      try { snap = snapshotFile(filePath); } catch {}
      if (snap) broadcast({ type: 'FILE_SYNC', source: 'revert-hunk', snapshot: snap });
      broadcastDiff();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/diff/discard-all', async (_req, res) => {
    try {
      const r = await gitEngine.discardAll(rootDir);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      broadcast({ type: 'DISCARD_ALL' });
      broadcastDiff();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/diff/commit', async (req, res) => {
    const { message, files } = req.body || {};
    const resolved = (files || [])
      .map((f) => resolveInside(rootDir, f))
      .filter(Boolean);
    try {
      const r = await gitEngine.commit(rootDir, message, resolved);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      broadcastDiff();
      res.json({ ok: true, sha: r.sha });
    } catch (err) {
      res.status(500).json({ error: err.message || 'commit failed' });
    }
  });

  app.post('/move', (req, res) => {
    const { filePath: rawPath, sourceId, targetId, position, sourceKey, targetKey } = req.body || {};
    if (!rawPath || !sourceId || !targetId || !position) {
      return res.status(400).json({ error: 'filePath, sourceId, targetId, position required' });
    }
    const filePath = resolveInside(rootDir, rawPath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    suppress(filePath);
    const result = astEngine.moveElement(filePath, sourceId, targetId, position, {
      sourceKey, targetKey,
    });
    if (!result.ok) return res.status(409).json({ error: result.reason, detail: result.detail });

    let snap;
    try { snap = snapshotFile(filePath); }
    catch (err) { return res.status(500).json({ error: err.message }); }
    broadcast({ type: 'FILE_SYNC', source: 'move', snapshot: snap });
    broadcastDiff();
    res.json({ ok: true, snapshot: snap, noChange: !!result.noChange });
  });

  app.post('/delete', (req, res) => {
    const { filePath: rawPath, elementId, stableKey } = req.body || {};
    if (!rawPath || !elementId) {
      return res.status(400).json({ error: 'filePath and elementId required' });
    }
    const filePath = resolveInside(rootDir, rawPath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    if (!isSupportedFile(filePath)) return res.status(400).json({ error: 'unsupported file' });

    suppress(filePath);
    const result = astEngine.deleteElement(filePath, elementId, { stableKey });
    if (!result.ok) return res.status(409).json({ error: result.reason, detail: result.detail });

    let snap;
    try { snap = snapshotFile(filePath); }
    catch (err) { return res.status(500).json({ error: err.message }); }
    broadcast({ type: 'FILE_SYNC', source: 'delete', snapshot: snap });
    broadcastDiff();
    res.json({
      ok: true,
      snapshot: snap,
      removed: result.removed,
      parentKey: result.parentKey,
      index: result.index,
      tagName: result.tagName,
    });
  });

  // Put a deleted element back where it was. The only accepted source is a
  // fragment the server itself handed out from /delete, which is what keeps
  // this from being a general "write arbitrary code" endpoint.
  app.post('/insert', (req, res) => {
    const { filePath: rawPath, parentKey, index, source } = req.body || {};
    if (!rawPath || !parentKey || typeof source !== 'string') {
      return res.status(400).json({ error: 'filePath, parentKey and source required' });
    }
    const filePath = resolveInside(rootDir, rawPath);
    if (!filePath) return res.status(403).json({ error: 'path outside project root' });
    if (!isSupportedFile(filePath)) return res.status(400).json({ error: 'unsupported file' });

    suppress(filePath);
    const result = astEngine.insertElement(filePath, parentKey, Number(index) || 0, source);
    if (!result.ok) return res.status(409).json({ error: result.reason, detail: result.detail });

    let snap;
    try { snap = snapshotFile(filePath); }
    catch (err) { return res.status(500).json({ error: err.message }); }
    broadcast({ type: 'FILE_SYNC', source: 'insert', snapshot: snap });
    broadcastDiff();
    res.json({ ok: true, snapshot: snap });
  });

  // Apply a className/text change. Accepts three shapes, most specific first:
  //   className  — an exact string to write
  //   edits      — variant-aware token edits (the inspector's normal path)
  //   props      — legacy flat property patch (MCP, older clients)
  function applyUpdate(body) {
    const filePath = resolveInside(rootDir, body.filePath);
    if (!filePath) return { status: 403, payload: { error: 'path outside project root' } };
    if (!body.elementId) return { status: 400, payload: { error: 'elementId required' } };
    if (!isSupportedFile(filePath)) {
      return { status: 400, payload: { error: 'unsupported file' } };
    }

    const lookup = body.stableKey ? { stableKey: body.stableKey } : undefined;
    const applied = {};
    let warnings = [];
    suppress(filePath);

    if (typeof body.textContent === 'string') {
      const r = astEngine.updateTextContent(filePath, body.elementId, body.textContent, lookup);
      if (!r.ok) return { status: 409, payload: { error: r.reason, detail: r.detail } };
      applied.textContent = body.textContent;
    }

    const wantsClassName =
      typeof body.className === 'string' ||
      (Array.isArray(body.edits) && body.edits.length > 0) ||
      (body.props && Object.keys(body.props).length > 0);

    if (wantsClassName) {
      let nextClassName;
      if (typeof body.className === 'string') {
        nextClassName = body.className;
      } else {
        const current = astEngine.getClassName(filePath, body.elementId, lookup);
        if (!current.found) return { status: 404, payload: { error: 'element not found' } };
        if (!current.editable) {
          return { status: 409, payload: { error: 'className is not a static string' } };
        }
        const opts = themeKeys ? { theme: themeKeys } : undefined;
        const editList = Array.isArray(body.edits)
          ? body.edits
          : Object.entries(body.props || {}).map(([prop, value]) => ({
              prop: tailwindParser.PROP_ALIASES[prop] || prop, value, variants: [],
            }));
        // Values that are not part of the project's scales are reported back
        // rather than silently written as classes Tailwind will ignore.
        warnings = tailwindParser.validateEdits(editList, themeKeys);
        if (warnings.length && body.strict) {
          return {
            status: 422,
            payload: {
              error: 'value not in the project design system',
              warnings,
            },
          };
        }
        nextClassName = Array.isArray(body.edits)
          ? tailwindParser.applyEdits(current.className || '', body.edits, opts)
          : tailwindParser.mergeProps(current.className || '', body.props || {}, opts);
      }

      // A preview answers "what would this produce?" without touching the file.
      if (body.preview) {
        const before = astEngine.getClassName(filePath, body.elementId, lookup);
        return {
          status: 200,
          payload: {
            ok: true, preview: true,
            previousClassName: before.className,
            className: nextClassName,
            warnings,
          },
        };
      }
      const result = astEngine.updateClassName(filePath, body.elementId, nextClassName, lookup);
      if (!result.ok) {
        return { status: 409, payload: { error: result.reason, detail: result.detail } };
      }
      applied.className = nextClassName;
      applied.previousClassName = result.previous;
    }

    let snap;
    try { snap = snapshotFile(filePath); }
    catch (err) { return { status: 500, payload: { error: err.message } }; }

    broadcast({ type: 'FILE_SYNC', source: 'update', snapshot: snap });
    broadcastDiff();
    return { status: 200, payload: { ok: true, snapshot: snap, applied, warnings } };
  }

  app.post('/update', (req, res) => {
    const { status, payload } = applyUpdate(req.body || {});
    res.status(status).json(payload);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ origin, req }) => {
      const h = hostnameOf(req.headers.host);
      if (h && !isLoopback(h)) return false;
      if (!origin) return true;
      return isLoopback(hostnameOf(origin));
    },
  });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { return; }
      if (msg.type !== 'UPDATE') return;
      try {
        const { status, payload } = applyUpdate(msg);
        if (status !== 200) {
          ws.send(JSON.stringify({ type: 'ERROR', error: payload.error, requestId: msg.requestId }));
        } else if (msg.requestId) {
          ws.send(JSON.stringify({ type: 'UPDATE_OK', requestId: msg.requestId, applied: payload.applied }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', error: err.message, requestId: msg.requestId }));
      }
    });
    ws.send(JSON.stringify({ type: 'HELLO', rootDir }));
  });

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  // Our own writes come back through the watcher. Ignore them for a beat so
  // the canvas doesn't re-render an element the user is still dragging.
  function suppress(filePath) {
    suppressedFiles.set(filePath, Date.now() + 1200);
  }
  function isSuppressed(filePath) {
    const until = suppressedFiles.get(filePath);
    if (!until) return false;
    if (until <= Date.now()) {
      suppressedFiles.delete(filePath);
      return false;
    }
    return true;
  }

  const watcher = chokidar.watch(rootDir, {
    ignored: (p) =>
      p.includes(`${path.sep}node_modules${path.sep}`) ||
      p.includes(`${path.sep}.next${path.sep}`) ||
      p.includes(`${path.sep}.git${path.sep}`),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });

  function isThemeConfig(filePath) {
    return themeEngine.CONFIG_CANDIDATES.includes(path.basename(filePath));
  }

  watcher.on('change', (filePath) => {
    if (isThemeConfig(filePath)) {
      refreshTheme().catch(() => {});
      return;
    }
    if (!isSupportedFile(filePath)) return;
    if (isSuppressed(filePath)) {
      broadcastDiff();
      return;
    }
    try {
      const snap = snapshotFile(filePath);
      broadcast({ type: 'FILE_SYNC', source: 'fs', snapshot: snap });
      broadcastDiff();
    } catch (err) {
      broadcast({ type: 'FILE_ERROR', filePath, error: err.message });
    }
  });

  let canvasServer = null;
  if (serveCanvas && fs.existsSync(canvasDir)) {
    const canvasApp = express();
    canvasApp.use(express.static(canvasDir, { index: 'index.html' }));
    canvasServer = http.createServer(canvasApp);
  }

  return {
    app,
    server,
    wss,
    watcher,
    canvasServer,
    refreshTheme,
    listen() {
      const started = refreshTheme().catch(() => null);
      return started.then(() =>
        Promise.all([
          new Promise((resolve) => server.listen(port, host, () => resolve({ port }))),
          canvasServer
            ? new Promise((resolve) =>
                canvasServer.listen(canvasPort, host, () => resolve({ canvasPort }))
              )
            : Promise.resolve(null),
        ]).then(([api, canvas]) => {
          // Advertise this server so `framelab mcp` in another terminal can
          // find it and read the current selection.
          session.write(rootDir, { port, canvasPort: canvas ? canvasPort : null });
          return { ...api, ...(canvas || {}) };
        })
      );
    },
    close() {
      return new Promise((resolve) => {
        session.clear(rootDir);
        if (diffTimer) clearTimeout(diffTimer);
        watcher.close().finally(() => {
          for (const client of wss.clients) {
            try { client.terminate(); } catch {}
          }
          wss.close(() => {
            const closers = [new Promise((r) => server.close(() => r()))];
            if (canvasServer) closers.push(new Promise((r) => canvasServer.close(() => r())));
            Promise.all(closers).then(() => resolve());
          });
        });
      });
    },
    broadcast,
    snapshotFile,
  };
}

module.exports = { createSyncServer, listFiles, resolveInside, canonical, containedIn };
