'use strict';

// The full agent loop, across process boundaries.
//
// A user clicks an element in the canvas (browser). A completely separate
// `framelab mcp` process — the one Claude Code or Cursor talks to — asks
// "what is the user pointing at?" and gets the exact source node back, then
// edits it through the schema-constrained write path.
//
// Run with: npm run test:agent --workspace @framelab/canvas

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const { createSyncServer } = require(path.join(REPO, 'packages/server/src/syncServer'));
const { RUNTIME_SOURCE } = require(path.join(REPO, 'packages/babel-plugin/src/runtime'));
const puppeteer = require(path.join(REPO, 'node_modules/puppeteer-core'));
const CHROME = process.env.CHROME_PATH ||
  require(path.join(REPO, 'packages/cli/src/snapshot')).detectChromePath();

const API_PORT = 3341;
const CANVAS_PORT = 3343;
const APP_PORT = 3344;

const PAGE_SOURCE = `export default function Page() {
  return (
    <main className="min-h-screen bg-surface p-8">
      <h1 className="text-3xl font-semibold text-zinc-900">Title</h1>
      <button className="px-4 py-2 rounded-card bg-brand text-white">Buy now</button>
    </main>
  );
}
`;

const TAILWIND_CONFIG = `module.exports = {
  content: ['./*.tsx'],
  theme: {
    extend: {
      colors: { brand: '#6e56cf', ember: '#e0490d', surface: '#0c0c0e' },
      borderRadius: { card: '14px' },
      spacing: { gutter: '1.75rem' },
    },
  },
};
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal MCP client over stdio, exactly how an AI editor drives the server.
function mcpClient(rootDir) {
  const proc = spawn('node', [path.join(REPO, 'packages/cli/bin/framelab.js'), 'mcp', '--root', rootDir], {
    cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = new Map();
  let id = 0;
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const rpc = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  return {
    proc,
    rpc,
    async call(name, args) {
      const res = await rpc('tools/call', { name, arguments: args || {} });
      const text = res.result.content[0].text;
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      return { isError: !!res.result.isError, data: parsed, text };
    },
  };
}

async function main() {
  if (!CHROME) {
    console.log('  skipped: no Chrome/Chromium found (set CHROME_PATH to run)');
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-agent-'));
  const pageFile = path.join(root, 'Page.tsx');
  fs.writeFileSync(pageFile, PAGE_SOURCE, 'utf8');
  fs.writeFileSync(path.join(root, 'tailwind.config.js'), TAILWIND_CONFIG, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'agent-e2e', private: true }), 'utf8');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  try {
    fs.symlinkSync(
      path.join(REPO, 'examples/test-next-app/node_modules/tailwindcss'),
      path.join(root, 'node_modules/tailwindcss')
    );
  } catch {}

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const server = createSyncServer({
    rootDir: root, port: API_PORT, canvasPort: CANVAS_PORT,
    canvasDir: path.join(REPO, 'packages/canvas'),
  });
  await server.listen();

  const snap = await new Promise((resolve) => {
    http.get(
      `http://127.0.0.1:${API_PORT}/snapshot?filePath=${encodeURIComponent(pageFile)}`,
      (res) => {
        const c = [];
        res.on('data', (x) => c.push(x));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString())));
      }
    );
  });

  // A stand-in for the running app, carrying the ids the babel plugin emits.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const byParent = new Map();
  for (const el of snap.elements) {
    const k = el.parentId || '__root__';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(el);
  }
  const render = (list) => list.map((el) => {
    const kids = byParent.get(el.framelabId) || [];
    return `<${el.tagName} data-framelab-id="${esc(el.framelabId)}" style="padding:14px;margin:8px;border:1px solid #ccc">` +
      (kids.length ? render(kids) : esc(el.textContent || '')) + `</${el.tagName}>`;
  }).join('');
  const appHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body>` +
    render(byParent.get('__root__') || []) + `<script>${RUNTIME_SOURCE}</script></body></html>`;

  const appServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(appHtml);
  });
  await new Promise((r) => appServer.listen(APP_PORT, '127.0.0.1', r));

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto(
    `http://localhost:${CANVAS_PORT}/?server=${encodeURIComponent('http://localhost:' + API_PORT)}` +
    `&app=${encodeURIComponent('http://localhost:' + APP_PORT)}`,
    { waitUntil: 'networkidle0', timeout: 20000 }
  );
  await sleep(1200);

  const mcp = mcpClient(root);
  await mcp.rpc('initialize', {});

  try {
    // ---- Nothing selected yet ----
    let sel = await mcp.call('get_selection');
    check('with nothing selected the agent is told plainly',
      sel.data.selected === false && !!sel.data.hint, sel.data.hint || '');

    // ---- The user clicks the button in the canvas ----
    const button = snap.elements.find((e) => e.tagName === 'button');
    const frame = page.frames().find(
      (f) => f !== page.mainFrame() && f.url().startsWith('http://localhost:' + APP_PORT)
    );
    await frame.click(`[data-framelab-id="${button.framelabId.replace(/"/g, '\\"')}"]`);
    await sleep(900);

    sel = await mcp.call('get_selection');
    check('the agent sees what the user clicked',
      sel.data.selected === true && sel.data.element.tagName === 'button',
      sel.data.selected ? sel.data.element.tagName : JSON.stringify(sel.data));
    check('it resolves to an exact source location',
      sel.data.file === 'Page.tsx' && sel.data.element.line === 5,
      `${sel.data.file}:${sel.data.element && sel.data.element.line}`);
    check('it carries the parsed design values, not just markup',
      sel.data.element.props && sel.data.element.props.background === 'brand',
      JSON.stringify(sel.data.element.props && sel.data.element.props.background));
    check('it carries the ancestor chain',
      sel.data.ancestors.map((a) => a.tagName).join('>') === 'main',
      sel.data.ancestors.map((a) => a.tagName).join('>'));

    // ---- The user switches to the md breakpoint ----
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.variant-bar .seg button')];
      const md = btns.find((b) => b.textContent.trim() === 'md');
      if (md) md.click();
    });
    await sleep(800);
    sel = await mcp.call('get_selection');
    check('the agent learns which breakpoint the user is editing',
      sel.data.editingVariant.prefix === 'md', sel.data.editingVariant.prefix);

    // ---- The agent edits what the user pointed at ----
    const id = sel.data.element.framelabId;
    const preview = await mcp.call('update_styles', {
      framelabId: id, props: { background: 'ember' }, variants: ['md'], preview: true,
    });
    check('preview shows the result without writing',
      !preview.isError && preview.data.nextClassName.includes('md:bg-ember') &&
      fs.readFileSync(pageFile, 'utf8') === PAGE_SOURCE,
      preview.data.nextClassName);

    const applied = await mcp.call('update_styles', {
      framelabId: id, props: { background: 'ember' }, variants: ['md'],
    });
    const after = fs.readFileSync(pageFile, 'utf8');
    check('the edit lands on the element the user pointed at',
      !applied.isError && /md:bg-ember/.test(after),
      (after.match(/<button className="[^"]*"/) || [''])[0]);
    check('the base styles are untouched',
      after.includes('bg-brand') && after.includes('rounded-card'),
      (after.match(/<button className="[^"]*"/) || [''])[0]);

    // ---- The schema refuses a value the design system does not have ----
    const bogus = await mcp.call('update_styles', {
      framelabId: id, props: { background: 'embr' },
    });
    check('a typo is refused instead of written as a dead class',
      bogus.isError && /not part of the project/i.test(bogus.text), '');
    check('the refusal names the token the model meant',
      bogus.isError && bogus.text.includes('"ember"'),
      bogus.text.split('\n')[1] || '');
    check('nothing was written by the refused edit',
      fs.readFileSync(pageFile, 'utf8') === after, '');

    const forced = await mcp.call('update_styles', {
      framelabId: id, props: { background: 'embr' }, force: true,
    });
    check('force still lets a deliberate off-scale value through',
      !forced.isError && fs.readFileSync(pageFile, 'utf8').includes('bg-embr'), '');
    await mcp.call('update_styles', { framelabId: id, props: { background: 'brand' } });

    check('an arbitrary value is never treated as a typo',
      !(await mcp.call('update_styles', {
        framelabId: id, props: { background: '[#ff0000]' }, preview: true,
      })).isError, '');

    // ---- Clearing the selection is visible to the agent ----
    await page.keyboard.press('Escape');
    await sleep(700);
    sel = await mcp.call('get_selection');
    check('deselecting is reflected for the agent', sel.data.selected === false, '');
  } finally {
    mcp.proc.kill();
    await browser.close().catch(() => {});
    await new Promise((r) => appServer.close(r));
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} agent checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('AGENT E2E ERROR:', err.stack || err.message);
  process.exit(1);
});
