'use strict';

// withFramelab: the next.config wrapper that carries the click runtime to the
// browser on Next.js 16.3+. This is the only path that works on the App
// Router, which has no pages/_app for the plugin to inject into.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withFramelab, CLIENT_MODULE } = require('../src/next');
const { RUNTIME_SOURCE, CLIENT_FILE } = require('../src/runtime');

let passed = 0;
function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected,
    `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  passed++;
  console.log(`  ok  ${label}`);
}
function divider(label) { console.log(`\n=== ${label} ===`); }

const on = { enabled: true };

divider('withFramelab');
check('adds the client module', withFramelab({}, on).instrumentationClientInject, [CLIENT_MODULE]);
check('keeps the rest of the config', withFramelab({ reactStrictMode: true }, on).reactStrictMode, true);

// Other wrappers (withSentry and friends) use the same field, so appending
// rather than replacing is what makes composition in any order work.
check('appends to an existing list',
  withFramelab({ instrumentationClientInject: ['other/client'] }, on).instrumentationClientInject,
  ['other/client', CLIENT_MODULE]);
check('tolerates a bare string',
  withFramelab({ instrumentationClientInject: 'other/client' }, on).instrumentationClientInject,
  ['other/client', CLIENT_MODULE]);
check('is idempotent',
  withFramelab(withFramelab({}, on), on).instrumentationClientInject, [CLIENT_MODULE]);
check('does not mutate the input', (() => {
  const input = { reactStrictMode: true };
  withFramelab(input, on);
  return input.instrumentationClientInject;
})(), undefined);

divider('it stays out of production');
check('disabled leaves the config untouched',
  withFramelab({ reactStrictMode: true }, { enabled: false }),
  { reactStrictMode: true });

const prevNode = process.env.NODE_ENV;
const prevFlag = process.env.NEXT_PUBLIC_FRAMELAB;
try {
  process.env.NODE_ENV = 'production';
  process.env.NEXT_PUBLIC_FRAMELAB = 'true';
  check('off in production even when the flag is set',
    withFramelab({}).instrumentationClientInject, undefined);
  process.env.NODE_ENV = 'development';
  delete process.env.NEXT_PUBLIC_FRAMELAB;
  check('off in development without the flag',
    withFramelab({}).instrumentationClientInject, undefined);
  process.env.NEXT_PUBLIC_FRAMELAB = 'true';
  check('on in development with the flag',
    withFramelab({}).instrumentationClientInject, [CLIENT_MODULE]);
} finally {
  if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
  if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_FRAMELAB; else process.env.NEXT_PUBLIC_FRAMELAB = prevFlag;
}

divider('one runtime, two delivery paths');
// client.js is the source of truth; runtime.js reads it back for the Babel
// path. If they ever diverge, the App Router and Pages Router would behave
// differently, which would be a miserable bug to track down.
const clientBody = fs.readFileSync(CLIENT_FILE, 'utf8');
check('the bundler path is a real module', path.basename(CLIENT_FILE), 'client.js');
check('the babel path is a substring of it', clientBody.includes(RUNTIME_SOURCE), true);
check('the runtime guards against running twice',
  RUNTIME_SOURCE.includes('__framelab_click_installed'), true);
check('and against running without a DOM',
  RUNTIME_SOURCE.includes("typeof window === 'undefined'"), true);
// It is imported for side effects only; an export would make it a module in
// the Babel path, where it is inlined into an existing program body.
check('it declares no imports or exports',
  /(^|\n)\s*(import|export)\s/.test(clientBody.slice(clientBody.indexOf('(function(){'))), false);

divider('the package exposes both subpaths');
const pkg = require('../package.json');
check('./client', pkg.exports['./client'], './src/client.js');
check('./next', pkg.exports['./next'], './src/next.js');
check('the main entry is unchanged', pkg.exports['.'], './src/index.js');
for (const sub of ['.', './client', './next']) {
  const rel = pkg.exports[sub].replace('./', '');
  check(`${sub} points at a file that exists`, fs.existsSync(path.join(__dirname, '..', rel)), true);
}

console.log(`\n${passed}/${passed} passed`);
