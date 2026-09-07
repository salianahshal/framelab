'use strict';

// Full integration: a real Next.js dev server, the real babel plugin tagging
// JSX, the real canvas, and a real HMR round trip. Runs in a copy of the
// example app with its own dist dir so it cannot collide with the dev server
// the user already has open.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const EXAMPLE = path.join(REPO, 'examples/test-next-app');
const { createSyncServer } = require(path.join(REPO, 'packages/server/src/syncServer'));
const puppeteer = require(path.join(REPO, 'node_modules/puppeteer-core'));

// puppeteer-core ships no browser; reuse the CLI's own Chrome detection.
const CHROME = process.env.CHROME_PATH ||
  require(path.join(REPO, 'packages/cli/src/snapshot')).detectChromePath();
const NEXT_PORT = 3234;
const API_PORT = 3241;
const CANVAS_PORT = 3243;
const SHOT_DIR = process.env.FRAMELAB_SHOTS || path.join(os.tmpdir(), 'framelab-shots-live');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => { res.resume(); resolve(true); })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error('dev server did not start: ' + url));
          else setTimeout(tick, 400);
        });
    };
    tick();
  });
}


// Run with: npm run test:live --workspace @framelab/canvas
// Boots a real Next.js dev server from examples/test-next-app in a temp copy,
// so it never collides with a dev server you already have running.
async function main() {
  if (!CHROME) {
    console.log('  skipped: no Chrome/Chromium found (set CHROME_PATH to run)');
    return;
  }
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-next-'));

  for (const entry of ['pages', 'styles', 'public', 'tailwind.config.js', 'postcss.config.js',
                       'babel.config.js', 'tsconfig.json', 'package.json', 'next-env.d.ts']) {
    const src = path.join(EXAMPLE, entry);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(root, entry), { recursive: true });
  }
  fs.writeFileSync(path.join(root, '.env.development'), 'NEXT_PUBLIC_FRAMELAB=true\n');
  fs.writeFileSync(path.join(root, 'next.config.js'),
    "module.exports = { reactStrictMode: true, distDir: '.next-fl' };\n");
  fs.symlinkSync(path.join(EXAMPLE, 'node_modules'), path.join(root, 'node_modules'));

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'e2e@framelab.local'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root });

  console.log('project:', root);
  const dev = spawn(path.join(EXAMPLE, 'node_modules/.bin/next'), ['dev', '-p', String(NEXT_PORT)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', NEXT_PUBLIC_FRAMELAB: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let devLog = '';
  dev.stdout.on('data', (d) => { devLog += d; });
  dev.stderr.on('data', (d) => { devLog += d; });

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  let browser, server;
  try {
    await waitForServer(`http://localhost:${NEXT_PORT}`, 90000);
    console.log('next dev is up');
    await sleep(2500);

    server = createSyncServer({
      rootDir: root, port: API_PORT, canvasPort: CANVAS_PORT,
      canvasDir: path.join(REPO, 'packages/canvas'),
    });
    await server.listen();

    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1500,940'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 940 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const canvasUrl = `http://localhost:${CANVAS_PORT}/?server=${encodeURIComponent('http://localhost:' + API_PORT)}&app=${encodeURIComponent('http://localhost:' + NEXT_PORT)}`;
    await page.goto(canvasUrl, { waitUntil: 'networkidle0', timeout: 40000 });
    await sleep(4000);

    const APP_ORIGIN = 'http://localhost:' + NEXT_PORT;
    const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(APP_ORIGIN));
    check('the app renders inside the canvas', !!frame);
    if (!frame) throw new Error('no app frame');

    const tagged = await frame.evaluate(() => document.querySelectorAll('[data-framelab-id]').length);
    check('the babel plugin tagged the rendered DOM', tagged > 20, `${tagged} tagged nodes`);

    // Click the hero headline in the real app.
    const heroId = await frame.evaluate(() => {
      const h1 = document.querySelector('h1[data-framelab-id]');
      return h1 ? h1.getAttribute('data-framelab-id') : null;
    });
    check('the headline carries a framelab id', !!heroId, heroId || '');

    // The headline wraps a <span>; clicking its centre lands on that span, and
    // selecting the innermost tagged element is the correct behaviour.
    await frame.click('h1[data-framelab-id]');
    await sleep(1500);

    const innerTag = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
    check('clicking selects the innermost element under the cursor', innerTag === '<span>', innerTag);
    const file = await page.$eval('#current-file', (n) => n.textContent);
    check('the canvas resolved the element to its source file', file.includes('index.tsx'), file);
    const crumbs = await page.$$eval('.breadcrumb button', (n) => n.map((x) => x.textContent));
    check('the breadcrumb exposes the nesting', crumbs.includes('h1') && crumbs[crumbs.length - 1] === 'span',
      crumbs.join('/'));

    // Walk up to the headline itself.
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('ArrowUp');
    await sleep(900);
    const tag = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
    check('ArrowUp selects the parent element', tag === '<h1>', tag);

    await page.screenshot({ path: path.join(SHOT_DIR, '01-live-selected.png') });

    const pageFile = path.join(root, 'pages/index.tsx');
    const before = fs.readFileSync(pageFile, 'utf8');
    const beforeH1 = (before.match(/<h1 className="([^"]*)"/) || [])[1];
    console.log('  h1 before:', beforeH1);

    // Change the text colour through the colour field.
    const colorInput = await page.$('input[data-prop="textColor"]');
    await colorInput.click({ clickCount: 3 });
    await page.keyboard.type('ember');
    await page.keyboard.press('Enter');
    await sleep(2500);

    const after = fs.readFileSync(pageFile, 'utf8');
    const afterH1 = (after.match(/<h1 className="([^"]*)"/) || [])[1];
    console.log('  h1 after: ', afterH1);
    check('the colour edit reached the source', /text-ember/.test(afterH1 || ''), afterH1);
    check('every other class on the headline survived',
      ['mt-6', 'text-[2.5rem]', 'font-medium', 'leading-[1.02]', 'tracking-[-0.03em]', 'sm:text-6xl', 'md:text-7xl']
        .every((c) => (afterH1 || '').includes(c)),
      afterH1);
    check('class order was preserved',
      (afterH1 || '').startsWith('mt-6 text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em]'),
      afterH1);

    // Wait for HMR and confirm the browser actually repainted.
    await sleep(4000);
    const liveColor = await frame.evaluate(() => {
      const h1 = document.querySelector('h1[data-framelab-id]');
      return h1 ? getComputedStyle(h1).color : null;
    });
    check('the running app repainted with the new colour',
      liveColor === 'rgb(224, 73, 13)' || liveColor === 'rgb(255, 122, 61)',
      String(liveColor));

    await page.screenshot({ path: path.join(SHOT_DIR, '02-live-edited.png') });

    // The diff panel should show exactly this change.
    await page.click('#tab-diff');
    await sleep(1200);
    const diffText = await page.$eval('#diff-list', (n) => n.textContent);
    check('the diff panel shows the single changed file', diffText.includes('pages/index.tsx'), '');
    const addedLines = await page.$$eval('#diff-list .diff-line.add', (n) => n.length);
    check('the diff is one added line', addedLines === 1, `${addedLines} added lines`);
    await page.screenshot({ path: path.join(SHOT_DIR, '03-live-diff.png') });

    const gitDiff = execFileSync('git', ['diff', '--stat'], { cwd: root }).toString();
    check('git sees a one-line change', /1 file changed, 1 insertion\(\+\), 1 deletion\(-\)/.test(gitDiff), gitDiff.trim());

    // Undo restores the original bytes.
    await page.click('#tab-inspector');
    await page.evaluate(() => document.getElementById('undo-btn').click());
    await sleep(2000);
    check('undo restores the file byte-for-byte', fs.readFileSync(pageFile, 'utf8') === before,
      (fs.readFileSync(pageFile, 'utf8').match(/<h1 className="([^"]*)"/) || [])[1]);

    // Deleting a real element in a real app, then getting it back.
    const navBefore = fs.readFileSync(pageFile, 'utf8');
    const ctaId = await frame.evaluate(() => {
      const btn = [...document.querySelectorAll('a[data-framelab-id]')]
        .find((n) => n.textContent.trim() === 'Get started');
      return btn ? btn.getAttribute('data-framelab-id') : null;
    });
    if (ctaId) {
      await frame.click(`[data-framelab-id="${ctaId.replace(/"/g, '\\"')}"]`);
      await sleep(1200);
      const before = await page.$eval('.inspector-head .tag', (n) => n.textContent.trim());
      check('a live element is selected before deleting', before === '<a>', before);

      await page.keyboard.press('Delete');
      await sleep(2500);
      const afterDel = fs.readFileSync(pageFile, 'utf8');
      check('the Delete key removes the element from the live source',
        afterDel.length < navBefore.length, `${navBefore.length} -> ${afterDel.length} bytes`);
      check('the file still parses after a live delete', (() => {
        try { require(path.join(REPO, 'packages/server/src/astEngine')).extractElements(pageFile); return true; }
        catch { return false; }
      })());

      await sleep(3000);
      const stillRenders = await frame.evaluate(() => !!document.querySelector('[data-framelab-id]'));
      check('the app still renders after the delete', stillRenders);

      await page.evaluate(() => document.getElementById('undo-btn').click());
      await sleep(2500);
      check('undo restores the deleted element byte for byte',
        fs.readFileSync(pageFile, 'utf8') === navBefore,
        fs.readFileSync(pageFile, 'utf8') === navBefore ? '' : 'file differs');
      await page.screenshot({ path: path.join(SHOT_DIR, '04-live-delete.png') });
    }

    check('no page errors during the live session', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    dev.kill('SIGTERM');
    await sleep(800);
    dev.kill('SIGKILL');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
  if (failed.length) {
    console.log('\ndev server log tail:\n' + devLog.slice(-2500));
    process.exit(1);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('LIVE E2E ERROR:', err.stack || err.message);
  process.exit(1);
});
