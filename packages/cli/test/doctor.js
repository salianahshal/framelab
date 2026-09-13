'use strict';

// The "nothing is clickable" diagnosis: given what the served app looks like
// and what the project has on disk, does framelab name the right half?

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const doctor = require('../src/doctor');

let passed = 0;

function divider(label) {
  console.log(`\n=== ${label} ===`);
}

function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected,
    `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  passed++;
  console.log(`  ok  ${label}`);
}

const HEALTHY_PROJECT = {
  babelFile: 'babel.config.js', babelHasPlugin: true,
  envFile: '.env.development', hasEntry: true, appRouter: false,
};

function serve(html, assets) {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }
    if (assets && assets[req.url]) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end(assets[req.url]);
    }
    res.writeHead(404);
    res.end('');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

function withTempProject(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-doctor-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  divider('a healthy app says nothing');
  check('tagged + runtime is silent',
    doctor.diagnose({ reachable: true, tagged: true, runtime: true }, HEALTHY_PROJECT), null);
  // Reachability is reported before we ever get here; don't say it twice.
  check('an unreachable app is silent',
    doctor.diagnose({ reachable: false, tagged: false, runtime: false }, HEALTHY_PROJECT), null);

  divider('tagged but inert — the runtime never got injected');
  const noEnv = doctor.diagnose(
    { reachable: true, tagged: true, runtime: false },
    { ...HEALTHY_PROJECT, envFile: null });
  check('names the runtime, not the tagging',
    /click runtime isn't in your app bundle/.test(noEnv.summary), true);
  check('points at the env var', noEnv.fixes[0][0].includes('NEXT_PUBLIC_FRAMELAB'), true);
  check('gives a runnable fix', noEnv.fixes[0][1], "echo 'NEXT_PUBLIC_FRAMELAB=true' >> .env.development");

  const appRouter = doctor.diagnose(
    { reachable: true, tagged: true, runtime: false },
    { ...HEALTHY_PROJECT, hasEntry: false, appRouter: true });
  check('App Router gets its own explanation',
    appRouter.fixes.some((f) => /App Router/.test(f[0])), true);

  const stale = doctor.diagnose({ reachable: true, tagged: true, runtime: false }, HEALTHY_PROJECT);
  check('config is fine, so blame the running server',
    /restart your dev server/.test(stale.fixes[0][1]), true);

  divider('nothing tagged — the plugin never ran');
  const noBabel = doctor.diagnose(
    { reachable: true, tagged: false, runtime: false },
    { ...HEALTHY_PROJECT, babelFile: null, babelHasPlugin: false });
  check('names the tagging, not the runtime',
    /no elements are tagged/.test(noBabel.summary), true);
  check('sends you to init', noBabel.fixes[0][1], 'npx framelab init');

  const noPlugin = doctor.diagnose(
    { reachable: true, tagged: false, runtime: false },
    { ...HEALTHY_PROJECT, babelFile: '.babelrc', babelHasPlugin: false });
  check('names the config file it found', noPlugin.fixes[0][0].includes('.babelrc'), true);

  divider('reading the project off disk');
  withTempProject({
    'babel.config.js': "module.exports = { plugins: ['@framelab/babel-plugin'] };",
    '.env.development': 'NEXT_PUBLIC_FRAMELAB=true\n',
    'pages/_app.tsx': 'export default function App() {}',
  }, (dir) => {
    const p = doctor.inspectProject(dir);
    check('finds the babel config', p.babelFile, 'babel.config.js');
    check('sees the plugin listed', p.babelHasPlugin, true);
    check('finds the env file', p.envFile, '.env.development');
    check('finds the entry', p.hasEntry, true);
  });

  withTempProject({ '.env.development': 'NEXT_PUBLIC_FRAMELAB=false\n' }, (dir) => {
    // Only `true` switches the runtime on, so anything else must not count.
    check('=false is not enabled', doctor.inspectProject(dir).envFile, null);
  });

  withTempProject({ '.env.local': 'FOO=1\nNEXT_PUBLIC_FRAMELAB=true\n' }, (dir) => {
    check('reads .env.local too', doctor.inspectProject(dir).envFile, '.env.local');
  });

  withTempProject({ 'src/app/layout.tsx': 'export default function L() {}' }, (dir) => {
    const p = doctor.inspectProject(dir);
    check('spots App Router under src/', p.appRouter, true);
    check('and no pages entry', p.hasEntry, false);
  });

  divider('probing a served app');
  const tag = ` ${doctor.TAG_ATTR}="div|/x.tsx|1|0"`;

  let s = await serve(`<html><body><div${tag}>hi</div><script src="/_app.js"></script></body></html>`,
    { '/_app.js': `window.${doctor.RUNTIME_SENTINEL} = true;` });
  check('runtime found in a chunk', await doctor.probeApp(s.url),
    { reachable: true, tagged: true, runtime: true });
  s.server.close();

  s = await serve(`<html><body><div${tag}>hi</div><script src="/_app.js"></script></body></html>`,
    { '/_app.js': 'console.log("no runtime here");' });
  check('tagged but inert', await doctor.probeApp(s.url),
    { reachable: true, tagged: true, runtime: false });
  s.server.close();

  s = await serve('<html><body><div>hi</div></body></html>', {});
  check('nothing tagged at all', await doctor.probeApp(s.url),
    { reachable: true, tagged: false, runtime: false });
  s.server.close();

  // An app that inlines its bundle rather than linking one.
  s = await serve(
    `<html><body><div${tag}>hi</div><script>window.${doctor.RUNTIME_SENTINEL}=1</script></body></html>`, {});
  check('inline runtime counts', (await doctor.probeApp(s.url)).runtime, true);
  s.server.close();

  check('a dead port is not reachable',
    await doctor.probeApp('http://127.0.0.1:1/'),
    { reachable: false, tagged: false, runtime: false });

  divider('checkApp never throws');
  check('garbage url resolves to null', await doctor.checkApp('not a url', os.tmpdir()), null);

  console.log(`\n${passed}/${passed} doctor tests passed`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
