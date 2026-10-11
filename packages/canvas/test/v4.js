'use strict';

// The canvas against a Tailwind v4 project.
//
// Everything about v4 is tested at the unit level — @theme parsing, oklch
// conversion, calc() evaluation, drift — but nothing proved the result reaches
// the UI. These checks are deliberately narrow: not the whole inspector again,
// only the things that are different because the project is on v4.
//
// The project here has no tailwind.config.js. Its tokens live in @theme blocks
// written the way shadcn/ui generates them: references into :root, oklch
// colours, and a radius scale built out of calc().

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..', '..');
const { createSyncServer } = require(path.join(REPO, 'packages/server/src/syncServer'));
const { RUNTIME_SOURCE } = require(path.join(REPO, 'packages/babel-plugin/src/runtime'));
const puppeteer = require(path.join(REPO, 'node_modules/puppeteer-core'));

const CHROME = process.env.CHROME_PATH ||
  require(path.join(REPO, 'packages/cli/src/snapshot')).detectChromePath();
const API_PORT = 3151;
const CANVAS_PORT = 3153;
const APP_PORT = 3154;
const SHOT_DIR = process.env.FRAMELAB_SHOTS || path.join(os.tmpdir(), 'framelab-shots-v4');

// The v4 unit fixture already carries a stubbed tailwindcss install with the
// real theme.css, which is where the stock palette comes from.
const V4_FIXTURE = path.join(REPO, 'packages/server/test/fixtures/v4-app');

const PAGE_SOURCE = `export default function Page() {
  return (
    <main className="min-h-screen bg-background p-gutter">
      <h1 className="text-hero font-bold text-brand">Tokens from CSS</h1>
      <article className="rounded-card bg-card p-6 shadow-card">
        <p className="text-foreground">Resolved through :root.</p>
      </article>
      <aside className="rounded-[0.875rem] bg-[#6e56cf] p-[1.75rem]">
        <p className="text-[oklch(0.145_0_0)]">Hardcoded.</p>
      </aside>
    </main>
  );
}
`;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

// The canvas only needs tagged nodes with the right ids; the styling of the
// served page is irrelevant to what these checks assert.
function buildAppHtml(elements) {
  const byParent = new Map();
  for (const el of elements) {
    const key = el.parentKey || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(el);
  }
  function render(list) {
    return (list || []).map((el) => {
      const inner = render(byParent.get(el.stableKey)) || '';
      const tag = /^[a-z]/.test(el.tagName) ? el.tagName : 'div';
      const cls = (el.className || '').replace(/__FRAMELAB_EXPR_\d+__/g, '').trim();
      return `<${tag} data-framelab-id="${esc(el.framelabId)}" class="${esc(cls)}">${inner}</${tag}>`;
    }).join('');
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fff}
main{padding:24px} h1{font-size:28px} article,aside{margin-top:16px;padding:16px;border:1px solid #ddd}</style>
</head><body>
${render(byParent.get('__root__') || [])}
<script>${RUNTIME_SOURCE}</script>
</body></html>`;
}

async function main() {
  if (!CHROME) {
    console.log('  skipped: no Chrome/Chromium found (set CHROME_PATH to run)');
    return;
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-v4-'));
  const pageFile = path.join(root, 'Page.tsx');
  fs.writeFileSync(pageFile, PAGE_SOURCE, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: 'v4-canvas', private: true, dependencies: { tailwindcss: '^4' } }), 'utf8');
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.cpSync(path.join(V4_FIXTURE, 'app'), path.join(root, 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  try {
    fs.symlinkSync(path.join(V4_FIXTURE, 'node_modules', 'tailwindcss'),
      path.join(root, 'node_modules', 'tailwindcss'));
  } catch {}

  const server = createSyncServer({
    rootDir: root, port: API_PORT, canvasPort: CANVAS_PORT,
    canvasDir: path.join(REPO, 'packages/canvas'),
  });
  await server.listen();

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  let browser;
  let appServer;
  try {
    // ---- the theme the canvas is handed ----
    const theme = await get(`http://127.0.0.1:${API_PORT}/theme`);
    check('the project is read as Tailwind v4', theme.tailwind === 4, `tailwind=${theme.tailwind}`);
    check('its tokens come from a stylesheet, not a config',
      /\.css$/.test(theme.configFile || ''), path.basename(theme.configFile || ''));

    const snap = await get(`http://127.0.0.1:${API_PORT}/snapshot?filePath=${encodeURIComponent(pageFile)}`);
    const appHtml = buildAppHtml(snap.elements);
    appServer = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(appHtml);
    });
    await new Promise((r) => appServer.listen(APP_PORT, '127.0.0.1', r));

    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon/.test(m.text())) consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

    await page.goto(
      `http://localhost:${CANVAS_PORT}/?server=${encodeURIComponent('http://localhost:' + API_PORT)}` +
      `&app=${encodeURIComponent('http://localhost:' + APP_PORT)}`,
      { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1200));
    check('the canvas boots against a v4 project without errors',
      consoleErrors.length === 0, consoleErrors.join(' | '));

    await page.click(`#file-tree [data-file="${pageFile}"]`);
    await new Promise((r) => setTimeout(r, 700));

    // ---- v4 class names are understood, not shown as unknown ----
    const h1 = snap.elements.find((e) => e.tagName === 'h1');
    await page.click(`#layer-tree [data-key="${h1.stableKey}"]`);
    await new Promise((r) => setTimeout(r, 600));
    const colorValue = await page.$eval('input[data-prop="textColor"]', (n) => n.value);
    check('a colour defined in @theme reads back as its token name',
      colorValue === 'brand', colorValue);
    const sizeValue = await page.$eval('input[data-prop="fontSize"]', (n) => n.value);
    check('a font size from @theme reads back as its token name',
      sizeValue === 'hero', sizeValue);

    // ---- the swatches are the resolved values, not var() strings ----
    // The popover opens from the caret beside the field, not the input.
    // The inline swatch beside the field is itself proof the value resolved:
    // the token is `var(--brand)` in the stylesheet and oklch under that.
    const inlineSwatch = await page.$eval('.color-field .swatch-fill',
      (n) => (n.getAttribute('style') || '').trim());
    check('the field swatch shows a resolved colour, not var() or oklch',
      /^background:\s*#[0-9a-f]{6}$/i.test(inlineSwatch), inlineSwatch);

    // Colour fields open their popover from the swatch button.
    await page.click('.color-field .swatch');
    await new Promise((r) => setTimeout(r, 500));

    const swatches = await page.$$eval('#popover .pop-item .pi-swatch', (nodes) =>
      nodes.map((n) => n.getAttribute('style') || ''));
    check('the colour popover paints real swatches', swatches.length > 0, `${swatches.length} swatches`);
    // oklch and var() would both be useless as a swatch; the theme reader
    // resolves them to hex before the canvas ever sees them.
    check('no swatch is an unresolved var()',
      swatches.every((s) => !s.includes('var(')), swatches.find((s) => s.includes('var(')) || 'none');
    check('no swatch is raw oklch',
      swatches.every((s) => !/oklch/i.test(s)), swatches.find((s) => /oklch/i.test(s)) || 'none');

    const groups = await page.$$eval('#popover .pop-group', (n) => n.map((x) => x.textContent.trim()));
    check('the popover separates project tokens from stock Tailwind',
      groups.includes('project') && groups.includes('tailwind'), groups.join('/'));

    // Everything listed under "project" before the next group heading.
    const projectItems = await page.evaluate(() => {
      const out = [];
      let inProject = false;
      for (const node of document.querySelectorAll('#popover .pop-group, #popover .pop-item')) {
        if (node.classList.contains('pop-group')) {
          inProject = node.textContent.trim() === 'project';
          continue;
        }
        if (inProject) out.push(node.querySelector('span:not(.pi-swatch)')?.textContent.trim());
      }
      return out.filter(Boolean);
    });
    check('the project group is the @theme colours',
      ['background', 'brand', 'card', 'foreground'].every((t) => projectItems.includes(t)),
      projectItems.slice(0, 8).join(','));
    await page.screenshot({ path: path.join(SHOT_DIR, '01-v4-tokens.png') });
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));

    // ---- a calc()-derived token is offered and writes correctly ----
    const article = snap.elements.find((e) => e.tagName === 'article');
    await page.click(`#layer-tree [data-key="${article.stableKey}"]`);
    await new Promise((r) => setTimeout(r, 600));
    const radius = await page.$eval('input[data-prop="borderRadius"]', (n) => n.value);
    check('a calc() radius reads back as its token name', radius === 'card', radius);

    // ---- editing writes a v4 token, not a resolved value ----
    const bg = await page.$('input[data-prop="background"]');
    await bg.click({ clickCount: 3 });
    await page.keyboard.type('brand-muted');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 1400));
    const after = fs.readFileSync(pageFile, 'utf8');
    check('the edit writes the token name, not its hex',
      /bg-brand-muted/.test(after) && !/bg-\[#/.test(after.split('\n')[4] || ''),
      (after.match(/<article className="([^"]*)"/) || [])[1]);

    check('no console errors across the session', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    // Every listener has to go, or the process never exits once the checks
    // pass — only a failing run was calling process.exit to paper over it.
    if (browser) await browser.close();
    if (appServer) await new Promise((r) => appServer.close(r));
    await server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} v4 canvas checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('V4 CANVAS ERROR:', err);
  process.exit(1);
});
