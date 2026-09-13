'use strict';

// Why isn't anything clickable?
//
// Two independent things have to happen before the canvas can talk to your app:
// the Babel plugin has to tag JSX with `data-framelab-id`, and it has to inject
// the click runtime into your entry file. Either can fail on its own, and when
// they do the result looks identical from the outside — the app serves, the
// canvas connects, elements render, and nothing responds to a click.
//
// That is a miserable thing to debug, so we check both against the app the user
// is actually pointing at and say which half is missing. Detection is advisory:
// an unusual setup that trips these heuristics gets a warning it can ignore,
// never a refusal to start.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Set by the runtime on install, and the runtime is not minified in dev.
const RUNTIME_SENTINEL = '__framelab_click_installed';
const TAG_ATTR = 'data-framelab-id';

const BODY_LIMIT = 4 * 1024 * 1024;
const SCRIPT_LIMIT = 8;

function fetchText(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let client;
    try {
      client = url.startsWith('https:') ? https : http;
    } catch { return resolve(null); }
    let req;
    try {
      req = client.get(url, { timeout: timeoutMs }, (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          return resolve(null);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length > BODY_LIMIT) { req.destroy(); return; }
          body += chunk;
        });
        res.on('end', () => resolve(body));
        res.on('error', () => resolve(null));
      });
    } catch { return resolve(null); }
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function scriptUrls(html, appUrl) {
  const out = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(new URL(m[1], appUrl).href); } catch { /* skip */ }
  }
  // The runtime rides in the entry chunk, so look there first and only widen if
  // the app doesn't use a recognisable name.
  const entryish = out.filter((u) => /_app|main|index|client|entry/i.test(u));
  const rest = out.filter((u) => !entryish.includes(u));
  return [...entryish, ...rest].slice(0, SCRIPT_LIMIT);
}

/** Does the served app have tags, and did the click runtime make it into a chunk? */
async function probeApp(appUrl) {
  const html = await fetchText(appUrl);
  if (html == null) return { reachable: false, tagged: false, runtime: false };

  const tagged = html.includes(TAG_ATTR);
  if (html.includes(RUNTIME_SENTINEL)) {
    return { reachable: true, tagged, runtime: true };
  }

  for (const url of scriptUrls(html, appUrl)) {
    const body = await fetchText(url);
    if (body && body.includes(RUNTIME_SENTINEL)) {
      return { reachable: true, tagged, runtime: true };
    }
  }
  return { reachable: true, tagged, runtime: false };
}

function readIfExists(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/** What the project looks like on disk, for turning a symptom into a fix. */
function inspectProject(rootDir) {
  const babelFiles = ['babel.config.js', 'babel.config.cjs', '.babelrc', '.babelrc.js', '.babelrc.json'];
  let babelFile = null;
  let babelHasPlugin = false;
  for (const name of babelFiles) {
    const body = readIfExists(path.join(rootDir, name));
    if (body == null) continue;
    babelFile = name;
    if (body.includes('@framelab/babel-plugin')) babelHasPlugin = true;
    break;
  }

  // The runtime is gated on this being `true` at compile time, so it has to be
  // readable by the dev server's process — an env file, or the shell it runs in.
  let envFile = null;
  for (const name of ['.env.development', '.env.local', '.env.development.local', '.env']) {
    const body = readIfExists(path.join(rootDir, name));
    if (body == null) continue;
    if (/^\s*NEXT_PUBLIC_FRAMELAB\s*=\s*true\s*$/m.test(body)) {
      envFile = name;
      break;
    }
  }

  const hasEntry = ['pages/_app.js', 'pages/_app.jsx', 'pages/_app.tsx',
    'src/pages/_app.js', 'src/pages/_app.jsx', 'src/pages/_app.tsx']
    .some((p) => fs.existsSync(path.join(rootDir, p)));

  const appRouter = ['app/layout.js', 'app/layout.jsx', 'app/layout.tsx',
    'src/app/layout.js', 'src/app/layout.jsx', 'src/app/layout.tsx']
    .some((p) => fs.existsSync(path.join(rootDir, p)));

  return { babelFile, babelHasPlugin, envFile, hasEntry, appRouter };
}

/**
 * Turn a probe plus the project's state into one diagnosis, or null when
 * everything the canvas needs is in place.
 */
function diagnose(probe, project) {
  if (!probe.reachable) return null;
  if (probe.tagged && probe.runtime) return null;

  const fixes = [];

  if (!probe.tagged) {
    // Nothing is tagged: the plugin never ran over the app's JSX.
    if (!project.babelFile) {
      fixes.push(['No Babel config found in this project.', 'npx framelab init']);
    } else if (!project.babelHasPlugin) {
      fixes.push([
        `${project.babelFile} doesn't list @framelab/babel-plugin.`,
        "add \"@framelab/babel-plugin\" to its plugins array",
      ]);
    } else {
      fixes.push([
        `${project.babelFile} looks right, so the dev server may predate it.`,
        'restart your dev server',
      ]);
    }
    return {
      summary: 'Your app is served, but no elements are tagged for editing.',
      detail: 'Nothing in the page carries data-framelab-id, so the canvas has nothing to select.',
      fixes,
    };
  }

  // Tagged but inert: the plugin ran, the runtime didn't get injected.
  if (!project.envFile) {
    fixes.push([
      'NEXT_PUBLIC_FRAMELAB=true is not set in any .env file here.',
      "echo 'NEXT_PUBLIC_FRAMELAB=true' >> .env.development",
    ]);
  }
  if (!project.hasEntry) {
    fixes.push(project.appRouter
      ? ['This looks like an App Router project, and the runtime is injected into pages/_app.',
        'App Router support is still partial — see the README']
      : ['No pages/_app file found to inject the runtime into.',
        'create pages/_app.tsx, or pass entryPatterns to the plugin']);
  }
  if (!fixes.length) {
    fixes.push(['The config looks right, so the running server may predate it.',
      'restart your dev server — env vars are read at compile time']);
  }

  return {
    summary: 'Elements are tagged, but the click runtime isn\'t in your app bundle.',
    detail: 'The canvas will render your app and nothing will respond to a click.',
    fixes,
  };
}

/** Probe the running app and report. Never throws; returns the diagnosis or null. */
async function checkApp(appUrl, rootDir) {
  try {
    const probe = await probeApp(appUrl);
    return diagnose(probe, inspectProject(rootDir));
  } catch {
    return null;
  }
}

function report(diagnosis, t) {
  if (!diagnosis) return;
  console.log();
  t.warn(diagnosis.summary);
  t.info(diagnosis.detail);
  console.log();
  for (const [why, how] of diagnosis.fixes) {
    t.info(why);
    console.log('    ' + t.hl(how));
  }
  console.log();
}

module.exports = {
  checkApp,
  probeApp,
  diagnose,
  inspectProject,
  report,
  RUNTIME_SENTINEL,
  TAG_ATTR,
};
