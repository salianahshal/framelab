'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

function readPkg(rootDir) {
  const p = path.join(rootDir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function detectFramework(rootDir) {
  const pkg = readPkg(rootDir);
  if (!pkg) return { framework: null, version: null };
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (all.next) return { framework: 'next', version: all.next };
  if (all.vite) return { framework: 'vite', version: all.vite };
  if (all['react-scripts']) return { framework: 'cra', version: all['react-scripts'] };
  return { framework: null, version: null };
}

// Resolve the installed Next.js version when we can, since package.json may
// hold a range ("^16") rather than a version. Falls back to parsing the range.
function detectNextVersion(rootDir) {
  try {
    const pkgPath = require('module')
      .createRequire(path.resolve(rootDir, 'package.json'))
      .resolve('next/package.json');
    const v = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    const m = String(v).match(/^(\d+)\.(\d+)/);
    if (m) return { major: Number(m[1]), minor: Number(m[2]), version: v, installed: true };
  } catch {}
  const pkg = readPkg(rootDir);
  const all = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const m = String(all.next || '').match(/(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] ? Number(m[2]) : 0,
    version: all.next,
    installed: false,
  };
}

/**
 * Next.js 16.3 added `instrumentationClientInject`, which is how the click
 * runtime reaches the browser without a `pages/_app` — the only way to support
 * the App Router.
 */
function supportsClientInject(rootDir) {
  const v = detectNextVersion(rootDir);
  if (!v) return false;
  return v.major > 16 || (v.major === 16 && v.minor >= 3);
}

function detectRouter(rootDir) {
  const pages = fs.existsSync(path.join(rootDir, 'pages')) ||
                fs.existsSync(path.join(rootDir, 'src/pages'));
  const app = fs.existsSync(path.join(rootDir, 'app')) ||
              fs.existsSync(path.join(rootDir, 'src/app'));
  if (pages) return 'pages';
  if (app) return 'app';
  return null;
}

// Pull the port out of `next dev -p 3000` / `next dev --port 3000` / etc.
function detectAppPort(rootDir) {
  const pkg = readPkg(rootDir);
  if (!pkg || !pkg.scripts) return null;
  const candidates = ['dev', 'start', 'serve'];
  for (const key of candidates) {
    const cmd = pkg.scripts[key];
    if (!cmd) continue;
    const m = cmd.match(/(?:-p|--port)[\s=](\d{2,5})/);
    if (m) return Number(m[1]);
  }
  return null;
}

function checkUrl(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        // Anything that gets us a response (even 404) means a server is alive
        resolve(true);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

// Try the port from package.json first, then common dev-server ports.
async function findRunningDevServer(rootDir) {
  const seen = new Set();
  const order = [];
  const fromPkg = detectAppPort(rootDir);
  if (fromPkg) order.push(fromPkg);
  for (const p of [3000, 3001, 3002, 3003, 4000, 5173, 5174, 8080]) {
    if (!seen.has(p)) { order.push(p); seen.add(p); }
  }
  for (const port of order) {
    const url = `http://localhost:${port}`;
    if (await checkUrl(url)) return { url, port };
  }
  return null;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const net = require('net');
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start) {
  for (let p = start; p < start + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  return null;
}

module.exports = {
  readPkg,
  detectFramework,
  detectRouter,
  detectNextVersion,
  supportsClientInject,
  detectAppPort,
  checkUrl,
  findRunningDevServer,
  isPortFree,
  findFreePort,
};
