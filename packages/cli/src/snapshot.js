'use strict';

// Visual snapshot helper. Wraps puppeteer-core to take PNG screenshots of
// either a specific JSX element (by framelabId) or a full route. We use
// puppeteer-core (no bundled Chromium ~5MB) and detect a system Chrome
// install. If Chrome isn't found, snapshot calls fail with a friendly hint
// but all other MCP tools keep working.

const fs = require('fs');
const path = require('path');

let browserInstance = null;
let launching = null;

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function detectChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Arc.app/Contents/MacOS/Arc',
      ]
    : process.platform === 'linux'
    ? [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
      ]
    : process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;
  if (launching) return launching;

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch (err) {
    throw new Error(
      'snapshot: puppeteer-core is not installed. Install it as an optional ' +
      'dependency (it\'s small — no browser bundled): npm install puppeteer-core'
    );
  }

  const executablePath = detectChromePath();
  if (!executablePath) {
    throw new Error(
      'snapshot: Chrome / Chromium / Edge not found on this system. ' +
      'Install Google Chrome, or set CHROME_PATH to your browser binary path. ' +
      'Searched standard locations for ' + process.platform + '.'
    );
  }

  launching = puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  }).then((b) => {
    browserInstance = b;
    launching = null;
    b.on('disconnected', () => {
      browserInstance = null;
    });
    return b;
  }).catch((err) => {
    launching = null;
    throw err;
  });
  return launching;
}

function escapeAttrValue(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Cache-bust so dev servers serve a freshly-compiled response — Next.js fast
// refresh can race with our snapshots when the edit happened in the same tick.
function withCacheBust(url) {
  const u = new URL(url);
  u.searchParams.set('_cf_t', String(Date.now()));
  return u.toString();
}

// Each snapshot runs in a fresh incognito browser context. This is critical:
// Chrome's HTTP cache survives setCacheEnabled(false) at the page level for
// sub-resources (the Next.js CSS bundle, in particular). Without isolation
// the second snapshot in a session sees stale Tailwind CSS and renders the
// pre-edit appearance even though the HTML has the new className.
async function withFreshContext(fn) {
  const browser = await getBrowser();
  const factory =
    typeof browser.createBrowserContext === 'function'
      ? browser.createBrowserContext.bind(browser)
      : browser.createIncognitoBrowserContext.bind(browser);
  const ctx = await factory();
  const page = await ctx.newPage();
  try {
    await page.setCacheEnabled(false);
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

async function snapshotElement({ appUrl, framelabId, viewport }) {
  return withFreshContext(async (page) => {
    await page.setViewport(viewport || DEFAULT_VIEWPORT);
    await page.goto(withCacheBust(appUrl), { waitUntil: 'networkidle0', timeout: 20000 });
    const selector = `[data-framelab-id="${escapeAttrValue(framelabId)}"]`;
    const handle = await page.waitForSelector(selector, { timeout: 5000 });
    if (!handle) throw new Error(`Element not found in DOM: ${framelabId}`);
    await handle.scrollIntoView();
    await new Promise((r) => setTimeout(r, 250));
    return await handle.screenshot({ type: 'png' });
  });
}

async function snapshotPage({ appUrl, viewport, fullPage }) {
  return withFreshContext(async (page) => {
    await page.setViewport(viewport || DEFAULT_VIEWPORT);
    await page.goto(withCacheBust(appUrl), { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 250));
    return await page.screenshot({ type: 'png', fullPage: !!fullPage });
  });
}

async function shutdown() {
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
  }
}

module.exports = {
  snapshotElement,
  snapshotPage,
  shutdown,
  detectChromePath,
};
