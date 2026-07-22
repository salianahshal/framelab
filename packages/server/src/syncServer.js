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

const SUPPORTED_EXT = new Set(['.tsx', '.jsx']);

function isSupportedFile(filePath) {
  return SUPPORTED_EXT.has(path.extname(filePath));
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
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && isSupportedFile(full)) out.push(full);
    }
  }
  return out.sort();
}

function snapshotFile(filePath) {
  const { code, elements } = astEngine.extractElements(filePath);
  return {
    filePath,
    code,
    elements: elements.map((el) => ({
      ...el,
      props: el.className !== null ? tailwindParser.parseClassName(el.className) : null,
    })),
  };
}

function defaultCanvasDir() {
  // Installed from npm: the canvas ships as @framelab/canvas.
  try { return path.dirname(require.resolve('@framelab/canvas/index.html')); }
  catch {}
  // Monorepo checkout: sibling packages/canvas directory.
  return path.resolve(__dirname, '..', '..', 'canvas');
}

function createSyncServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const port = options.port || 3131;
  const canvasPort = options.canvasPort || 3133;
  const canvasDir = options.canvasDir || defaultCanvasDir();
  const serveCanvas = options.serveCanvas !== false;
  const watchedFiles = new Set();
  let suppressedFiles = new Map();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rootDir, watching: [...watchedFiles] });
  });

  app.get('/files', (_req, res) => {
    res.json({ rootDir, files: listFiles(rootDir) });
  });

  app.get('/snapshot', (req, res) => {
    const filePath = req.query.filePath ? path.resolve(String(req.query.filePath)) : null;
    if (filePath) {
      try {
        return res.json(snapshotFile(filePath));
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    const files = [...watchedFiles];
    const snapshots = files.map((f) => {
      try {
        return snapshotFile(f);
      } catch (err) {
        return { filePath: f, error: err.message };
      }
    });
    res.json({ rootDir, snapshots });
  });

  app.post('/watch', (req, res) => {
    const filePath = path.resolve(String(req.body.filePath || ''));
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

  // ---------- Theme (Tailwind config tokens) ----------

  let themeCache = null;
  async function buildThemePayload() {
    return themeEngine.loadTheme(rootDir);
  }
  async function refreshTheme() {
    themeCache = await buildThemePayload();
    broadcast({ type: 'THEME_SYNC', theme: themeCache });
    return themeCache;
  }

  app.get('/theme', async (_req, res) => {
    try {
      const payload = await buildThemePayload();
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---------- Diff (git-native) ----------

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

  function broadcastDiff() {
    buildDiffPayload()
      .then((payload) => broadcast({ type: 'DIFF_SYNC', diff: payload }))
      .catch(() => {});
  }

  app.get('/diff', async (_req, res) => {
    try {
      res.json(await buildDiffPayload());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/diff/revert-file', async (req, res) => {
    const { filePath: rawPath } = req.body || {};
    if (!rawPath) return res.status(400).json({ error: 'filePath required' });
    const filePath = path.resolve(String(rawPath));
    suppressedFiles.set(filePath, Date.now() + 1500);
    try {
      const r = await gitEngine.revertFile(rootDir, filePath);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      const snap = snapshotFile(filePath);
      broadcast({ type: 'FILE_SYNC', source: 'revert', snapshot: snap });
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
    const filePath = path.resolve(rootDir, String(rawPath));
    suppressedFiles.set(filePath, Date.now() + 1500);
    try {
      const r = await gitEngine.revertHunk(rootDir, filePath, hunkIndex);
      if (!r.ok) return res.status(400).json({ error: r.reason, detail: r.detail });
      // file changed on disk; refresh snapshot + diff
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
    try {
      const r = await gitEngine.commit(rootDir, message, files);
      if (!r.ok) return res.status(400).json({ error: r.reason });
      broadcastDiff();
      res.json({ ok: true, sha: r.sha });
    } catch (err) {
      res.status(500).json({ error: err.message || 'commit failed' });
    }
  });

  app.post('/move', (req, res) => {
    const { filePath: rawPath, sourceId, targetId, position } = req.body || {};
    if (!rawPath || !sourceId || !targetId || !position) {
      return res.status(400).json({ error: 'filePath, sourceId, targetId, position required' });
    }
    const filePath = path.resolve(String(rawPath));
    suppressedFiles.set(filePath, Date.now() + 1500);
    const result = astEngine.moveElement(filePath, sourceId, targetId, position);
    if (!result.ok) return res.status(409).json({ error: result.reason });

    let snap;
    try {
      snap = snapshotFile(filePath);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    broadcast({ type: 'FILE_SYNC', source: 'move', snapshot: snap });
    broadcastDiff();
    res.json({ ok: true, snapshot: snap, noChange: !!result.noChange });
  });

  app.post('/update', (req, res) => {
    const body = req.body || {};
    const { filePath: rawPath, elementId, props, className, textContent } = body;
    if (!rawPath || !elementId) {
      return res.status(400).json({ error: 'filePath and elementId required' });
    }
    const filePath = path.resolve(String(rawPath));
    const applied = {};

    suppressedFiles.set(filePath, Date.now() + 1500);

    if (typeof textContent === 'string') {
      const r = astEngine.updateTextContent(filePath, elementId, textContent);
      if (!r.ok) return res.status(409).json({ error: r.reason });
      applied.textContent = textContent;
    }

    const wantsClassName =
      typeof className === 'string' ||
      (props && Object.keys(props).length > 0);

    if (wantsClassName) {
      let nextClassName;
      if (typeof className === 'string') {
        nextClassName = className;
      } else {
        const current = astEngine.getClassName(filePath, elementId);
        if (!current.found) return res.status(404).json({ error: 'element not found' });
        if (current.kind === 'expression') {
          return res.status(409).json({ error: 'className is not a static string' });
        }
        nextClassName = tailwindParser.mergeProps(current.className || '', props || {});
      }
      const result = astEngine.updateClassName(filePath, elementId, nextClassName);
      if (!result.ok) return res.status(409).json({ error: result.reason });
      applied.className = nextClassName;
    }

    let snap;
    try {
      snap = snapshotFile(filePath);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    broadcast({ type: 'FILE_SYNC', source: 'update', snapshot: snap });
    broadcastDiff();
    res.json({ ok: true, snapshot: snap, applied });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'UPDATE') {
        const filePath = path.resolve(String(msg.filePath || ''));
        try {
          let nextClassName;
          if (typeof msg.className === 'string') {
            nextClassName = msg.className;
          } else {
            const current = astEngine.getClassName(filePath, msg.elementId);
            if (!current.found) return;
            if (current.kind === 'expression') return;
            nextClassName = tailwindParser.mergeProps(current.className || '', msg.props || {});
          }
          suppressedFiles.set(filePath, Date.now() + 1500);
          astEngine.updateClassName(filePath, msg.elementId, nextClassName);
          const snap = snapshotFile(filePath);
          broadcast({ type: 'FILE_SYNC', source: 'update', snapshot: snap });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'ERROR', error: err.message }));
        }
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

  const watcher = chokidar.watch(rootDir, {
    ignored: (p) =>
      p.includes(`${path.sep}node_modules${path.sep}`) ||
      p.includes(`${path.sep}.next${path.sep}`) ||
      p.includes(`${path.sep}.git${path.sep}`),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });

  function isThemeConfig(filePath) {
    const base = path.basename(filePath);
    return themeEngine.CONFIG_CANDIDATES.includes(base);
  }

  watcher.on('change', (filePath) => {
    if (isThemeConfig(filePath)) {
      refreshTheme().catch(() => {});
      return;
    }
    if (!isSupportedFile(filePath)) return;
    const until = suppressedFiles.get(filePath);
    if (until && until > Date.now()) {
      suppressedFiles.delete(filePath);
      // suppress FILE_SYNC for our own writes, but still refresh diff
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
    canvasApp.use(cors());
    canvasApp.use(express.static(canvasDir, { index: 'index.html' }));
    canvasServer = http.createServer(canvasApp);
  }

  return {
    app,
    server,
    wss,
    watcher,
    canvasServer,
    listen() {
      return Promise.all([
        new Promise((resolve) => server.listen(port, () => resolve({ port }))),
        canvasServer
          ? new Promise((resolve) =>
              canvasServer.listen(canvasPort, () => resolve({ canvasPort }))
            )
          : Promise.resolve(null),
      ]).then(([api, canvas]) => ({ ...api, ...(canvas || {}) }));
    },
    close() {
      return new Promise((resolve) => {
        watcher.close().finally(() => {
          wss.close(() => {
            const closers = [
              new Promise((r) => server.close(() => r())),
            ];
            if (canvasServer) closers.push(new Promise((r) => canvasServer.close(() => r())));
            Promise.all(closers).then(() => resolve());
          });
        });
      });
    },
    broadcast,
  };
}

module.exports = { createSyncServer, listFiles, snapshotFile };
