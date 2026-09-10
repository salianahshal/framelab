'use strict';

// End-to-end check of the real canvas against a real sync server.
//
// Instead of booting Next.js (which would collide with the dev server the user
// already has running), this serves a static page whose elements carry the same
// data-framelab-id attributes the babel plugin would emit, with the real click
// runtime injected. Everything downstream — canvas, WebSocket, AST writes — is
// the production code path.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..', '..');
const { createSyncServer } = require(path.join(REPO, 'packages/server/src/syncServer'));
const { RUNTIME_SOURCE } = require(path.join(REPO, 'packages/babel-plugin/src/runtime'));
const puppeteer = require(path.join(REPO, 'node_modules/puppeteer-core'));

// puppeteer-core ships no browser; reuse the CLI's own Chrome detection.
const CHROME = process.env.CHROME_PATH ||
  require(path.join(REPO, 'packages/cli/src/snapshot')).detectChromePath();
const API_PORT = 3141;
const CANVAS_PORT = 3143;
const APP_PORT = 3144;
const SHOT_DIR = process.env.FRAMELAB_SHOTS || path.join(os.tmpdir(), 'framelab-shots');

const PAGE_SOURCE = `import { useState } from 'react';

const focusRing = 'focus:outline-none focus:ring-2';

export default function Page({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <main className="min-h-screen bg-white p-8">
      <section className="mx-auto max-w-3xl rounded-card bg-surface-1 p-6 shadow-card">
        <h1 className="text-3xl font-semibold text-center text-zinc-900 md:text-5xl">
          Ship the change
        </h1>
        <p className="mt-3 text-zinc-500 border-t border-dashed border-zinc-200 pt-3">
          Edit any element and watch the source update.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button className={\`px-4 py-2 rounded-lg bg-brand text-white \${focusRing}\`}>
            Primary
          </button>
          <button className={cn('px-4 py-2 rounded-lg border', open && 'bg-zinc-100')}>
            Secondary
          </button>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-2">
          <li className="rounded border p-3 text-sm">One</li>
          <li className="rounded border p-3 text-sm">Two</li>
        </ul>
      </section>
    </main>
  );
}
`;

const TAILWIND_CONFIG = `module.exports = {
  content: ['./*.tsx'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#6e56cf', light: '#8b72e8' },
        surface: { DEFAULT: '#0c0c0e', 1: '#111114' },
      },
      borderRadius: { card: '14px' },
      boxShadow: { card: '0 4px 24px rgba(0,0,0,0.35)' },
      spacing: { gutter: '1.75rem' },
    },
  },
};
`;

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function buildAppHtml(elements) {
  const byParent = new Map();
  for (const el of elements) {
    const key = el.parentId || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(el);
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const render = (list) => list.map((el) => {
    const kids = byParent.get(el.framelabId) || [];
    const tag = /^[a-z]/.test(el.tagName) ? el.tagName : 'div';
    const inner = kids.length ? render(kids) : esc(el.textContent || '');
    const cls = (el.className || '').replace(/__FRAMELAB_EXPR_\\d+__/g, '').trim();
    return `<${tag} data-framelab-id="${esc(el.framelabId)}" class="${esc(cls)}">${inner}</${tag}>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#6e56cf',light:'#8b72e8'},surface:{DEFAULT:'#0c0c0e',1:'#111114'}},borderRadius:{card:'14px'},boxShadow:{card:'0 4px 24px rgba(0,0,0,0.35)'}}}}</script>
<style>body{margin:0;font-family:system-ui,sans-serif}</style>
</head><body>
${render(byParent.get('__root__') || [])}
<script>${RUNTIME_SOURCE}</script>
</body></html>`;
}


// Run with: npm run test:e2e --workspace @framelab/canvas
// Requires Chrome/Chromium (or CHROME_PATH). Not part of `npm test`, which
// stays dependency-free and headless-CI friendly.
async function main() {
  if (!CHROME) {
    console.log('  skipped: no Chrome/Chromium found (set CHROME_PATH to run)');
    return;
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-e2e-'));
  const pageFile = path.join(root, 'Page.tsx');
  fs.writeFileSync(pageFile, PAGE_SOURCE, 'utf8');
  fs.writeFileSync(path.join(root, 'tailwind.config.js'), TAILWIND_CONFIG, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'e2e', private: true }), 'utf8');
  // Let the theme engine resolve the project's own tailwind install.
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  try {
    fs.symlinkSync(
      path.join(REPO, 'examples/test-next-app/node_modules/tailwindcss'),
      path.join(root, 'node_modules/tailwindcss')
    );
  } catch {}

  const server = createSyncServer({
    rootDir: root,
    port: API_PORT,
    canvasPort: CANVAS_PORT,
    canvasDir: path.join(REPO, 'packages/canvas'),
  });
  await server.listen();
  console.log(`server on :${API_PORT}, canvas on :${CANVAS_PORT}, root ${root}`);

  const snap = await get(`http://127.0.0.1:${API_PORT}/snapshot?filePath=${encodeURIComponent(pageFile)}`);
  console.log(`snapshot: ${snap.elements.length} elements`);
  for (const el of snap.elements) {
    console.log(`  ${el.stableKey.padEnd(8)} <${el.tagName}> kind=${el.classNameKind} editable=${el.classNameEditable} :: ${el.className}`);
  }

  let appHtml = buildAppHtml(snap.elements);
  fs.writeFileSync(path.join(SHOT_DIR, 'app.html'), appHtml, 'utf8');
  console.log(`app html: ${appHtml.length} bytes, ${(appHtml.match(/data-framelab-id/g)||[]).length} tagged nodes`);
  const appServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(appHtml);
  });
  await new Promise((r) => appServer.listen(APP_PORT, '127.0.0.1', r));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', (m) => {
    // favicon.ico is not shipped with the canvas; it is not a product error.
    if (m.type() === 'error' && !/favicon/.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  const canvasUrl =
    `http://localhost:${CANVAS_PORT}/?server=${encodeURIComponent('http://localhost:' + API_PORT)}` +
    `&app=${encodeURIComponent('http://localhost:' + APP_PORT)}`;
  await page.goto(canvasUrl, { waitUntil: 'networkidle0', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // ---- 1. Boot ----
  check('canvas boots without console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  // Open the file so the layer tree has something to show.
  await page.click(`#file-tree [data-file="${pageFile}"]`);
  await new Promise((r) => setTimeout(r, 700));
  const layerCount = await page.$$eval('#layer-tree .layer', (n) => n.length);
  check('layer tree lists every element', layerCount === snap.elements.length, `${layerCount} rows`);

  await page.screenshot({ path: path.join(SHOT_DIR, '01-boot.png') });

  // ---- 2. Click an element inside the app frame ----
  const APP_ORIGIN = 'http://localhost:' + APP_PORT;
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(APP_ORIGIN));
  if (!frame) throw new Error('app frame not found');

  const h1 = snap.elements.find((e) => e.tagName === 'h1');
  await frame.click(`[data-framelab-id="${h1.framelabId.replace(/"/g, '\\"')}"]`);
  await new Promise((r) => setTimeout(r, 600));

  const selectedTag = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
  check('clicking an element selects it in the inspector', selectedTag === '<h1>', selectedTag);
  const overlayShown = await page.$eval('#select-overlay', (n) => n.classList.contains('show'));
  check('selection overlay is drawn', overlayShown);
  const breadcrumb = await page.$$eval('.breadcrumb button', (n) => n.map((x) => x.textContent));
  check('breadcrumb shows the ancestor chain', breadcrumb.join('/') === 'main/section/h1', breadcrumb.join('/'));

  await page.screenshot({ path: path.join(SHOT_DIR, '02-selected.png') });

  // ---- 3. The padding interaction that started all this ----
  const beforeSource = fs.readFileSync(pageFile, 'utf8');
  const paddingBox = await page.$('.boxmodel input[aria-label="padding top"]');
  check('spacing uses a box-model widget, not a dropdown', !!paddingBox);
  const nativePickers = await page.$$eval('#pane-inspector select, #pane-inspector datalist, #pane-inspector input[list]',
    (n) => n.length);
  check('no native select or datalist anywhere in the inspector', nativePickers === 0, `${nativePickers} found`);

  await paddingBox.click({ clickCount: 3 });
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 800));

  const afterPadding = fs.readFileSync(pageFile, 'utf8');
  check('editing padding writes to the source', /pt-10|p-10/.test(afterPadding),
    (afterPadding.match(/<h1 className="[^"]*"/) || [''])[0]);
  check('the sibling classes survive the padding edit',
    afterPadding.includes('text-center') && afterPadding.includes('md:text-5xl') && afterPadding.includes('font-semibold'),
    (afterPadding.match(/<h1 className="[^"]*"/) || [''])[0]);

  // ---- 3b. Focus must survive the file-sync that our own edit triggers ----
  const focusInput = await page.$('.boxmodel input[aria-label="padding left"]');
  await focusInput.click({ clickCount: 3 });
  await page.keyboard.type('7');
  // Do not press Enter: leave the caret in the field while the edit round-trips.
  await new Promise((r) => setTimeout(r, 1400));
  const focusState = await page.evaluate(() => {
    const a = document.activeElement;
    return { label: a && a.getAttribute ? a.getAttribute('aria-label') : null, value: a ? a.value : null };
  });
  check('the inspector keeps focus while an edit syncs',
    focusState.label === 'padding left', JSON.stringify(focusState));
  await page.keyboard.press('Escape');

  // ---- 3c. Hover feedback ----
  const secondaryForHover = snap.elements.find((e) => e.tagName === 'ul');
  await frame.hover(`[data-framelab-id="${secondaryForHover.framelabId.replace(/"/g, '\\"')}"]`);
  await new Promise((r) => setTimeout(r, 500));
  const hoverShown = await page.$eval('#hover-overlay', (n) => ({
    shown: n.classList.contains('show'),
    label: n.querySelector('.overlay-label').textContent,
  }));
  check('hovering the preview draws a hover outline', hoverShown.shown, JSON.stringify(hoverShown));
  check('the hover outline is labelled with the tag', hoverShown.label === 'ul', hoverShown.label);

  // ---- 3d. Agent context ----
  const agentBtn = await page.$('.inspector-head [data-action="agent-context"]');
  check('the inspector offers an agent-context action', !!agentBtn);
  await page.evaluate(() => {
    // Headless Chrome denies clipboard writes; capture what would be copied.
    window.__copied = null;
    navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); };
  });
  await agentBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  const copied = await page.evaluate(() => window.__copied);
  check('it copies a brief an agent can act on',
    !!copied && /Page\.tsx line \d+/.test(copied) && copied.includes('Classes:') &&
    copied.includes('framelabId:'),
    (copied || '').split('\n')[0]);
  const editingLine = (copied || '').split('\n').find((l) => l.startsWith('I am editing'));
  const onBase = await page.$eval('.variant-bar .seg button.active', (n) => n.textContent.trim());
  check('the brief mentions an editing variant only when one is open',
    onBase === 'Base' ? !editingLine : !!editingLine,
    `active tab "${onBase}", line ${JSON.stringify(editingLine || null)}`);

  // ---- 4. Popover behaviour ----
  const fieldBtn = await page.$('.section .field .field-btn');
  await fieldBtn.click();
  await new Promise((r) => setTimeout(r, 350));
  const pop = await page.$eval('#popover', (n) => {
    const r = n.getBoundingClientRect();
    return { shown: n.classList.contains('show'), width: r.width, height: r.height, top: r.top };
  });
  check('the token menu opens as a compact popover', pop.shown && pop.height <= 340 && pop.width <= 300,
    `${Math.round(pop.width)}x${Math.round(pop.height)}`);
  const panelBox = await page.$eval('#pane-inspector', (n) => {
    const r = n.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  check('the popover does not cover the whole inspector',
    pop.height < panelBox.height * 0.75,
    `popover ${Math.round(pop.height)}px vs panel ${Math.round(panelBox.height)}px`);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-popover.png') });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));

  // ---- 5. Responsive editing ----
  const basePaddingBefore = ((fs.readFileSync(pageFile, 'utf8')
    .match(/<h1 className="([^"]*)"/) || [])[1] || '')
    .split(/\s+/).filter((c) => /^p-/.test(c)).join(' ');
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.variant-bar .seg button')];
    btns.find((b) => b.textContent.trim() === 'md').click();
  });
  await new Promise((r) => setTimeout(r, 500));
  const mdInput = await page.$('.boxmodel input[aria-label="padding top"]');
  await mdInput.click({ clickCount: 3 });
  await page.keyboard.type('16');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 800));

  const afterMd = fs.readFileSync(pageFile, 'utf8');
  check('a breakpoint edit writes a responsive class', /md:p(t)?-16/.test(afterMd),
    (afterMd.match(/<h1 className="[^"]*"/) || [''])[0]);
  const basePaddingAfter = ((afterMd.match(/<h1 className="([^"]*)"/) || [])[1] || '')
    .split(/\s+/).filter((c) => /^p-/.test(c)).join(' ');
  check('the base padding is untouched by the breakpoint edit',
    basePaddingAfter === basePaddingBefore && basePaddingBefore !== '',
    `before "${basePaddingBefore}" after "${basePaddingAfter}"`);
  await page.screenshot({ path: path.join(SHOT_DIR, '04-responsive.png') });

  // ---- 6. cn() element is editable ----
  const secondary = snap.elements.find((e) => e.classNameKind === 'call');
  check('a cn() className is detected as editable', !!secondary && secondary.classNameEditable === true);
  if (secondary) {
    await frame.click(`[data-framelab-id="${secondary.framelabId.replace(/"/g, '\\"')}"]`);
    await new Promise((r) => setTimeout(r, 600));
    const badge = await page.$eval('.inspector-head', (n) => n.textContent);
    check('the inspector labels the cn() helper', badge.includes('cn()'), badge.trim());
    const bg = await page.$('input[data-prop="background"]');
    await bg.click({ clickCount: 3 });
    await page.keyboard.type('brand');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 800));
    const afterCn = fs.readFileSync(pageFile, 'utf8');
    check('editing a cn() element rewrites only the literal', afterCn.includes("bg-brand"),
      (afterCn.match(/cn\([^)]*\)/) || [''])[0]);
    check('the conditional argument of cn() survives',
      afterCn.includes("open && 'bg-zinc-100'"),
      (afterCn.match(/cn\([^)]*\)/) || [''])[0]);
  }

  // ---- 7. Undo ----
  await page.evaluate(() => document.getElementById('undo-btn').click());
  await new Promise((r) => setTimeout(r, 900));
  const afterUndo = fs.readFileSync(pageFile, 'utf8');
  check('undo reverts the last edit', !afterUndo.includes('bg-brand text-white') || !/cn\('[^']*bg-brand/.test(afterUndo),
    (afterUndo.match(/cn\([^)]*\)/) || [''])[0]);

  // ---- 7b. Drag reorder, and undoing it ----
  const listItems = snap.elements.filter((e) => e.tagName === 'li');
  if (listItems.length === 2) {
    const orderBefore = fs.readFileSync(pageFile, 'utf8').indexOf('>One<')
      < fs.readFileSync(pageFile, 'utf8').indexOf('>Two<');
    const a = await frame.$(`[data-framelab-id="${listItems[0].framelabId.replace(/"/g, '\\"')}"]`);
    const b = await frame.$(`[data-framelab-id="${listItems[1].framelabId.replace(/"/g, '\\"')}"]`);
    const boxA = await a.boundingBox();
    const boxB = await b.boundingBox();
    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height - 3, { steps: 12 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 1400));

    const moved = fs.readFileSync(pageFile, 'utf8');
    const orderAfter = moved.indexOf('>One<') < moved.indexOf('>Two<');
    check('dragging one sibling past another reorders the source',
      orderAfter !== orderBefore, `One before Two: ${orderBefore} -> ${orderAfter}`);

    await page.evaluate(() => document.getElementById('undo-btn').click());
    await new Promise((r) => setTimeout(r, 1600));
    const undone = fs.readFileSync(pageFile, 'utf8');
    check('undo puts a reordered sibling back',
      (undone.indexOf('>One<') < undone.indexOf('>Two<')) === orderBefore,
      `One before Two: ${undone.indexOf('>One<') < undone.indexOf('>Two<')}`);
  }

  // ---- 7c. Deleting an element, and getting it back ----
  const secondaryBtn = snap.elements.find((e) => e.classNameKind === 'call');
  if (secondaryBtn) {
    const beforeDelete = fs.readFileSync(pageFile, 'utf8');
    await frame.click(`[data-framelab-id="${secondaryBtn.framelabId.replace(/"/g, '\\"')}"]`);
    await new Promise((r) => setTimeout(r, 700));
    const selBefore = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
    check('the button to delete is selected', selBefore === '<button>', selBefore);

    const delBtn = await page.$('.inspector-head [data-action="delete"]');
    check('the inspector offers a delete action', !!delBtn);
    await delBtn.click();
    await new Promise((r) => setTimeout(r, 1200));

    const afterDelete = fs.readFileSync(pageFile, 'utf8');
    check('deleting a button removes it from the source',
      !afterDelete.includes('Secondary'), (afterDelete.match(/<button[\s\S]{0,60}/) || [''])[0]);
    check('the sibling button is untouched by the delete',
      afterDelete.includes('Primary') && afterDelete.includes('${focusRing}'), '');
    check('the delete leaves no blank line behind',
      !/\n[ \t]+\n/.test(afterDelete), 'stray whitespace line');
    check('the file still parses after a delete', (() => {
      try { require(path.join(REPO, 'packages/server/src/astEngine')).extractElements(pageFile); return true; }
      catch { return false; }
    })());
    const afterSel = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
    check('selection moves to the parent after a delete', afterSel === '<div>', afterSel);

    await page.evaluate(() => document.getElementById('undo-btn').click());
    await new Promise((r) => setTimeout(r, 1400));
    check('undo restores the deleted button byte for byte',
      fs.readFileSync(pageFile, 'utf8') === beforeDelete,
      fs.readFileSync(pageFile, 'utf8') === beforeDelete ? '' : 'file differs');

    // And the keyboard route, which is how people actually delete things.
    await frame.click(`[data-framelab-id="${secondaryBtn.framelabId.replace(/"/g, '\\"')}"]`);
    await new Promise((r) => setTimeout(r, 700));
    await page.keyboard.press('Delete');
    await new Promise((r) => setTimeout(r, 1200));
    check('the Delete key removes the selected element',
      !fs.readFileSync(pageFile, 'utf8').includes('Secondary'), '');
    await page.evaluate(() => document.getElementById('undo-btn').click());
    await new Promise((r) => setTimeout(r, 1400));
    check('undo after a keyboard delete restores it too',
      fs.readFileSync(pageFile, 'utf8') === beforeDelete, '');
  }

  // ---- 7d. Duplicate, and undoing it ----
  const dupTarget = snap.elements.find((e) => e.tagName === 'li');
  if (dupTarget) {
    const beforeDup = fs.readFileSync(pageFile, 'utf8');
    await frame.click(`[data-framelab-id="${dupTarget.framelabId.replace(/"/g, '\\"')}"]`);
    await new Promise((r) => setTimeout(r, 700));

    const dupBtn = await page.$('.inspector-head [data-action="duplicate"]');
    check('the inspector offers a duplicate action', !!dupBtn);
    await dupBtn.click();
    await new Promise((r) => setTimeout(r, 1300));

    const afterDup = fs.readFileSync(pageFile, 'utf8');
    check('duplicating adds a second copy of the element',
      (afterDup.match(/<li/g) || []).length === 3,
      `${(afterDup.match(/<li/g) || []).length} list items`);
    check('the copy keeps the original indentation', (() => {
      const lines = afterDup.split('\n').filter((l) => l.includes('>One<'));
      return lines.length === 2 && lines[0] === lines[1];
    })(), '');
    const selAfter = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
    check('selection moves to the new copy', selAfter === '<li>', selAfter);

    await page.evaluate(() => document.getElementById('undo-btn').click());
    await new Promise((r) => setTimeout(r, 1500));
    check('undo removes the copy byte for byte',
      fs.readFileSync(pageFile, 'utf8') === beforeDup,
      fs.readFileSync(pageFile, 'utf8') === beforeDup ? '' : 'file differs');
  }

  // ---- 8. Keyboard: parent selection and deselect ----
  // A reorder clears the selection by design, so pick something again first.
  const pEl = snap.elements.find((e) => e.tagName === 'p');
  await frame.click(`[data-framelab-id="${pEl.framelabId.replace(/"/g, '\\"')}"]`);
  await new Promise((r) => setTimeout(r, 700));
  const reselected = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
  check('an element can be selected again after a reorder', reselected === '<p>', reselected);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('ArrowUp');
  await new Promise((r) => setTimeout(r, 400));
  const afterUp = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
  check('ArrowUp selects the parent', afterUp === '<section>' || afterUp === '<div>', afterUp);

  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  const emptyShown = await page.$eval('#inspector-empty', (n) => n.style.display !== 'none');
  check('Escape clears the selection', emptyShown);

  // ---- 9. Whole-file integrity ----
  const finalSource = fs.readFileSync(pageFile, 'utf8');
  const beforeLines = beforeSource.split('\n');
  const afterLines = finalSource.split('\n');
  const changed = beforeLines.filter((l, i) => l !== afterLines[i]).length;
  check('only the edited lines changed', changed <= 3, `${changed} lines differ`);
  check('the file still parses', (() => {
    try {
      require(path.join(REPO, 'packages/server/src/astEngine')).extractElements(pageFile);
      return true;
    } catch { return false; }
  })());
  check('no console errors during the whole session', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  console.log('\n--- final source ---\n' + finalSource);

  await page.screenshot({ path: path.join(SHOT_DIR, '05-final.png') });

  // Light theme has to hold together too: every colour is a token, and a
  // missing one shows up immediately as unreadable text.
  await frame.click(`[data-framelab-id="${pEl.framelabId.replace(/"/g, '\\"')}"]`);
  await new Promise((r) => setTimeout(r, 600));
  await page.click('#theme-toggle');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOT_DIR, '06-light.png') });
  const contrast = await page.evaluate(() => {
    const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const body = getComputedStyle(document.body);
    const bg = lum(parse(body.backgroundColor));
    const worst = [...document.querySelectorAll('.section-body label, .inspector-head .tag, .panel-head')]
      .map((n) => {
        const fg = lum(parse(getComputedStyle(n).color));
        const hi = Math.max(fg, bg), lo = Math.min(fg, bg);
        return (hi + 0.05) / (lo + 0.05);
      });
    return Math.min(...worst);
  });
  check('light theme keeps inspector labels legible', contrast >= 4.5,
    `worst contrast ratio ${contrast.toFixed(2)}:1`);

  await page.click('#theme-toggle');
  await new Promise((r) => setTimeout(r, 400));
  const darkContrast = await page.evaluate(() => {
    const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bg = lum(parse(getComputedStyle(document.body).backgroundColor));
    return Math.min(...[...document.querySelectorAll('.section-body label, .inspector-head .tag, .panel-head')]
      .map((n) => {
        const fg = lum(parse(getComputedStyle(n).color));
        const hi = Math.max(fg, bg), lo = Math.min(fg, bg);
        return (hi + 0.05) / (lo + 0.05);
      }));
  });
  check('dark theme keeps inspector labels legible', darkContrast >= 4.5,
    `worst contrast ratio ${darkContrast.toFixed(2)}:1`);
  await browser.close();
  await new Promise((r) => appServer.close(r));
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('E2E ERROR:', err.stack || err.message);
  process.exit(1);
});
