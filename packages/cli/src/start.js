'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const t = require('./term');
const { findRunningDevServer, isPortFree, findFreePort, detectFramework } = require('./detect');

function loadConfig(cwd) {
  for (const name of ['.framelabrc.json', '.framelabrc']) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch (e) {
        t.warn(`Could not parse ${name}: ${e.message}`);
      }
    }
  }
  return {};
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--app-url' || a === '--app') opts.appUrl = args[++i];
    else if (a === '--port' || a === '--canvas-port') opts.canvasPort = Number(args[++i]);
    else if (a === '--api-port') opts.apiPort = Number(args[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--root') opts.rootDir = args[++i];
  }
  return opts;
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'cmd'
            : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}

async function start(args) {
  const cwd = process.cwd();
  const cliArgs = parseArgs(args);
  const config = loadConfig(cwd);
  const opts = { open: true, ...config, ...cliArgs };

  const rootDir = path.resolve(opts.rootDir || cwd);
  const fw = detectFramework(rootDir);
  if (!fw.framework) {
    t.warn('No package.json or recognized framework here.');
    t.info('Framelab still works as a generic JSX editor — make sure you ran `framelab init`.');
  }

  // Resolve API + canvas ports (with fallback if busy)
  const wantedApi = opts.apiPort || 3131;
  const wantedCanvas = opts.canvasPort || 3133;
  const apiPort = (await isPortFree(wantedApi)) ? wantedApi : await findFreePort(wantedApi);
  const canvasPort = (await isPortFree(wantedCanvas)) ? wantedCanvas : await findFreePort(wantedCanvas);
  if (!apiPort || !canvasPort) {
    t.err('Could not find a free port for the API or canvas server.');
    process.exit(1);
  }
  if (apiPort !== wantedApi) t.warn(`API port ${wantedApi} busy → using ${apiPort}`);
  if (canvasPort !== wantedCanvas) t.warn(`Canvas port ${wantedCanvas} busy → using ${canvasPort}`);

  // Resolve the app URL (the user's running dev server)
  let appUrl = opts.appUrl;
  if (!appUrl) {
    const detected = await findRunningDevServer(rootDir);
    if (!detected) {
      t.err('Couldn\'t find a running dev server.');
      console.log();
      t.info('Start your app first:');
      console.log('    ' + t.hl('npm run dev'));
      console.log();
      t.info('Then come back and run ' + t.hl('npx framelab') + '.');
      t.info('Or pass --app-url http://localhost:3000');
      process.exit(1);
    }
    appUrl = detected.url;
    t.ok('Detected dev server at ' + t.bold(appUrl));
  } else {
    t.ok('Using app URL ' + t.bold(appUrl));
  }

  // Boot the server
  let createSyncServer;
  try {
    ({ createSyncServer } = require('@framelab/server'));
  } catch (e) {
    t.err('Could not load @framelab/server.');
    t.info('Run `npm install` from the framelab repo, or install the published package.');
    console.error(e.message);
    process.exit(1);
  }
  const server = createSyncServer({ rootDir, port: apiPort, canvasPort });
  await server.listen();

  console.log();
  t.ok(`Watching ${t.bold(rootDir)}`);
  t.ok(`API + WebSocket on http://localhost:${apiPort}`);
  t.ok(`Canvas on ` + t.bold(`http://localhost:${canvasPort}`));
  console.log();

  const canvasUrl =
    `http://localhost:${canvasPort}/?app=${encodeURIComponent(appUrl)}`;
  console.log('  ' + t.bold(t.hl(canvasUrl)));
  console.log();
  t.info('Ctrl+C to stop.');

  if (opts.open !== false) {
    if (openBrowser(canvasUrl)) t.info('(opening in your browser…)');
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    console.log();
    t.info('shutting down…');
    try { await server.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}

module.exports = start;
