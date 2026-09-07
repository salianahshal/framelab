'use strict';

const path = require('path');
const assert = require('assert');
const babel = require('@babel/core');

const plugin = require('../src/index.js');
const { RUNTIME_SOURCE } = require('../src/runtime.js');

function transform(code, filename, pluginOptions) {
  const result = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
    ],
    plugins: [pluginOptions ? [plugin, pluginOptions] : plugin],
  });
  return result.code;
}

const cases = [];

cases.push({
  name: 'tags lowercase HTML elements',
  filename: path.join(__dirname, 'fixtures', 'Button.tsx'),
  input: `export default function Button() {
  return <button className="px-6 py-3">Click</button>;
}
`,
  expect: (out) => {
    assert.match(out, /data-framelab-id="button\|/, 'lowercase tag id missing');
    assert.match(out, /Button\.tsx\|2\|/, 'file path + line missing');
  },
});

cases.push({
  name: 'tags PascalCase components',
  filename: path.join(__dirname, 'fixtures', 'Card.tsx'),
  input: `import Card from './card';
export default function App() {
  return <Card title="Hello" />;
}
`,
  expect: (out) => {
    assert.match(out, /data-framelab-id="Card\|/, 'PascalCase tag id missing');
  },
});

cases.push({
  name: 'is idempotent',
  filename: path.join(__dirname, 'fixtures', 'Idem.tsx'),
  input: `export default function X() {
  return <div data-framelab-id="manual">hi</div>;
}
`,
  expect: (out) => {
    const matches = out.match(/data-framelab-id/g) || [];
    assert.strictEqual(matches.length, 1, 'should not double-add attribute');
    assert.match(out, /data-framelab-id="manual"/);
  },
});

cases.push({
  name: 'skips node_modules',
  filename: path.join('/somewhere', 'node_modules', 'pkg', 'index.tsx'),
  input: `export default () => <div>hi</div>;
`,
  expect: (out) => {
    assert.doesNotMatch(out, /data-framelab-id/);
  },
});

cases.push({
  name: 'skips .test.tsx files',
  filename: path.join(__dirname, 'fixtures', 'Foo.test.tsx'),
  input: `export default () => <div>hi</div>;
`,
  expect: (out) => {
    assert.doesNotMatch(out, /data-framelab-id/);
  },
});

cases.push({
  name: 'skips .spec.tsx files',
  filename: path.join(__dirname, 'fixtures', 'Foo.spec.tsx'),
  input: `export default () => <div>hi</div>;
`,
  expect: (out) => {
    assert.doesNotMatch(out, /data-framelab-id/);
  },
});

cases.push({
  name: 'tags nested elements with distinct ids',
  filename: path.join(__dirname, 'fixtures', 'Nested.tsx'),
  input: `export default function App() {
  return (
    <section className="bg-black">
      <button className="bg-blue-600">Get Started</button>
    </section>
  );
}
`,
  expect: (out) => {
    const ids = [...out.matchAll(/data-framelab-id="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(ids.length, 2, `expected 2 ids, got ${ids.length}`);
    assert.notStrictEqual(ids[0], ids[1], 'nested elements got same id');
    assert.match(ids[0], /^section\|/);
    assert.match(ids[1], /^button\|/);
  },
});

cases.push({
  name: 'preserves template literal className',
  filename: path.join(__dirname, 'fixtures', 'Tpl.tsx'),
  input: 'export default function App({ active }) { return <div className={`p-4 ${active ? "bg-red-500" : ""}`}>x</div>; }\n',
  expect: (out) => {
    assert.match(out, /data-framelab-id="div\|/);
    assert.match(out, /className=/);
  },
});

cases.push({
  name: 'skips React.Fragment shorthand and longhand',
  filename: path.join(__dirname, 'fixtures', 'Frag.tsx'),
  input: `import React from 'react';
export default function App() {
  return (
    <React.Fragment>
      <div>a</div>
    </React.Fragment>
  );
}
`,
  expect: (out) => {
    const ids = [...out.matchAll(/data-framelab-id="([^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(ids.length, 1, 'only the inner div should be tagged');
    assert.match(ids[0], /^div\|/);
  },
});

cases.push({
  name: 'runtime: not injected by default (no env, no option)',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  input: `export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
`,
  expect: (out) => {
    assert.doesNotMatch(out, /__framelab_click_installed/);
    assert.doesNotMatch(out, /FRAMELAB_CLICK/);
  },
});

cases.push({
  name: 'runtime: injected when injectClickRuntime option is true and file is _app',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
`,
  expect: (out) => {
    assert.match(out, /__framelab_click_installed/);
    assert.match(out, /FRAMELAB_CLICK/);
    assert.match(out, /addEventListener\(['"]click['"]/);
    assert.match(out, /,\s*true\s*\)/, 'capture phase listener');
  },
});

cases.push({
  name: 'runtime: not injected on non-entry files even when enabled',
  filename: path.join(__dirname, 'fixtures', 'pages', 'index.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function Home(){ return <div>hi</div>; }\n`,
  expect: (out) => {
    assert.doesNotMatch(out, /__framelab_click_installed/);
    assert.doesNotMatch(out, /FRAMELAB_CLICK/);
  },
});

cases.push({
  name: 'runtime: respects NEXT_PUBLIC_FRAMELAB=true env var',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  input: `export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }\n`,
  envOverride: { NEXT_PUBLIC_FRAMELAB: 'true' },
  expect: (out) => {
    assert.match(out, /__framelab_click_installed/);
    assert.match(out, /FRAMELAB_CLICK/);
  },
});

cases.push({
  name: 'runtime: gated off when NEXT_PUBLIC_FRAMELAB is not "true"',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  input: `export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }\n`,
  envOverride: { NEXT_PUBLIC_FRAMELAB: 'false' },
  expect: (out) => {
    assert.doesNotMatch(out, /__framelab_click_installed/);
  },
});

cases.push({
  name: 'runtime: idempotent across multiple plugin passes',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div data-framelab-id="x"/>; }\n`,
  expect: (out) => {
    const matches = out.match(/__framelab_click_installed/g) || [];
    assert.ok(matches.length <= 4, `installed flag appears too many times: ${matches.length}`);
    assert.ok(matches.length >= 2, `installed flag should appear (got ${matches.length})`);
  },
});

cases.push({
  name: 'runtime: simulated click in vm sandbox dispatches postMessage',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: (_out) => {
    const vm = require('vm');
    const messages = [];
    const listeners = {};

    const fakeEl = {
      getAttribute: (name) =>
        name === 'data-framelab-id'
          ? 'button|/abs/path/Button.tsx|9|123'
          : null,
      getBoundingClientRect: () => ({
        top: 10, left: 20, width: 100, height: 40,
        bottom: 50, right: 120,
      }),
    };
    const eventTarget = {
      closest: (sel) => (sel === '[data-framelab-id]' ? fakeEl : null),
    };

    const sandbox = {
      window: {
        __framelab_click_installed: undefined,
      },
      document: {
        addEventListener: (type, fn, opts) => {
          listeners[type] = { fn, opts };
        },
      },
    };
    sandbox.window.parent = {
      postMessage: (msg, origin) => messages.push({ msg, origin }),
    };

    vm.createContext(sandbox);
    vm.runInContext(RUNTIME_SOURCE, sandbox, { filename: 'framelab-runtime.js' });

    assert.ok(listeners.click, 'click listener was not registered');
    assert.strictEqual(listeners.click.opts, true, 'click listener must be capture-phase');
    assert.ok(sandbox.window.__framelab_click_installed, 'install flag not set');

    let prevented = false;
    let stopped = false;
    listeners.click.fn({
      target: eventTarget,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
    });

    assert.ok(prevented, 'preventDefault not called');
    assert.ok(stopped, 'stopPropagation not called');
    assert.strictEqual(messages.length, 1, 'expected exactly one postMessage');
    const { msg, origin } = messages[0];
    assert.strictEqual(msg.type, 'FRAMELAB_CLICK');
    assert.strictEqual(msg.framelabId, 'button|/abs/path/Button.tsx|9|123');
    assert.deepEqual(
      { top: msg.rect.top, left: msg.rect.left, width: msg.rect.width,
        height: msg.rect.height, bottom: msg.rect.bottom, right: msg.rect.right },
      { top: 10, left: 20, width: 100, height: 40, bottom: 50, right: 120 }
    );
    assert.strictEqual(origin, '*');
  },
});

cases.push({
  name: 'runtime: re-running install does not double-register',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: (_out) => {
    const vm = require('vm');
    let registrations = 0;
    const sandbox = {
      window: { __framelab_click_installed: undefined },
      document: {
        addEventListener: () => { registrations++; },
      },
    };
    sandbox.window.parent = { postMessage: () => {} };
    vm.createContext(sandbox);
    vm.runInContext(RUNTIME_SOURCE, sandbox);
    const firstPass = registrations;
    vm.runInContext(RUNTIME_SOURCE, sandbox);
    vm.runInContext(RUNTIME_SOURCE, sandbox);
    assert.strictEqual(
      registrations, firstPass,
      `expected listeners only on first run; got ${registrations} after 3 runs (first run installed ${firstPass})`
    );
    assert.ok(firstPass >= 1, 'first run should install at least one listener');
  },
});


// ---------------------------------------------------------------------------
// Runtime behaviour beyond the click: hover, click-out, canvas-driven select.
// These use a richer sandbox than the click test because they exercise the
// window-level listeners the minimal sandbox deliberately skips.
// ---------------------------------------------------------------------------

function runtimeSandbox() {
  const vm = require('vm');
  const messages = [];
  const docListeners = {};
  const winListeners = {};

  function makeEl(id) {
    const el = {
      _id: id,
      isConnected: true,
      style: {},
      getAttribute: (n) => (n === 'data-framelab-id' ? id : null),
      getBoundingClientRect: () => ({
        top: 1, left: 2, width: 3, height: 4, bottom: 5, right: 6,
      }),
      scrollIntoView: () => {},
    };
    el.closest = (sel) => (sel === '[data-framelab-id]' ? el : null);
    return el;
  }

  const tagged = makeEl('div|/a/B.tsx|3|10');
  const untagged = { closest: () => null };

  const sandbox = {
    window: {
      __framelab_click_installed: undefined,
      requestAnimationFrame: (fn) => fn(),
      addEventListener: (type, fn) => { winListeners[type] = fn; },
      parent: { postMessage: (msg) => messages.push(msg) },
    },
    document: {
      addEventListener: (type, fn) => { docListeners[type] = fn; },
      querySelector: (sel) => (sel.includes('div|/a/B.tsx|3|10') ? tagged : null),
      elementFromPoint: () => tagged,
    },
    getComputedStyle: () => ({}),
  };
  sandbox.window.parent.window = sandbox.window.parent;
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME_SOURCE, sandbox, { filename: 'framelab-runtime.js' });
  return { messages, docListeners, winListeners, tagged, untagged, sandbox };
}

cases.push({
  name: 'runtime: hovering a tagged element reports it to the canvas',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners, tagged } = runtimeSandbox();
    assert.ok(docListeners.mousemove, 'mousemove listener not registered');
    docListeners.mousemove({ target: tagged, clientX: 5, clientY: 5, preventDefault(){} });
    const hover = messages.find((m) => m.type === 'FRAMELAB_HOVER');
    assert.ok(hover, `no hover message: ${JSON.stringify(messages)}`);
    assert.strictEqual(hover.framelabId, 'div|/a/B.tsx|3|10');
    assert.strictEqual(hover.rect.width, 3);
  },
});

cases.push({
  name: 'runtime: moving off a tagged element clears the hover',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners, tagged, untagged } = runtimeSandbox();
    docListeners.mousemove({ target: tagged, clientX: 5, clientY: 5, preventDefault(){} });
    docListeners.mousemove({ target: untagged, clientX: 900, clientY: 900, preventDefault(){} });
    assert.ok(
      messages.some((m) => m.type === 'FRAMELAB_HOVER_OUT'),
      `no hover-out: ${JSON.stringify(messages.map((m) => m.type))}`
    );
  },
});

cases.push({
  name: 'runtime: clicking empty space deselects',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners, untagged } = runtimeSandbox();
    docListeners.click({ target: untagged, preventDefault(){}, stopPropagation(){} });
    assert.ok(
      messages.some((m) => m.type === 'FRAMELAB_DESELECT'),
      `no deselect: ${JSON.stringify(messages.map((m) => m.type))}`
    );
  },
});

cases.push({
  name: 'runtime: Escape deselects',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners } = runtimeSandbox();
    docListeners.keydown({ key: 'Escape' });
    assert.ok(messages.some((m) => m.type === 'FRAMELAB_DESELECT'), 'Escape did not deselect');
  },
});

cases.push({
  name: 'runtime: Delete is forwarded only when something is selected',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners, tagged } = runtimeSandbox();
    // Nothing selected yet: the key must not travel.
    docListeners.keydown({ key: 'Delete', target: null, preventDefault() {} });
    assert.ok(!messages.some((m) => m.type === 'FRAMELAB_KEY'),
      'Delete forwarded with no selection');

    docListeners.click({ target: tagged, preventDefault() {}, stopPropagation() {} });
    docListeners.keydown({ key: 'Delete', target: null, preventDefault() {} });
    const key = messages.find((m) => m.type === 'FRAMELAB_KEY');
    assert.ok(key, `Delete not forwarded: ${JSON.stringify(messages.map((m) => m.type))}`);
    assert.strictEqual(key.key, 'Delete');
  },
});

cases.push({
  name: 'runtime: Backspace inside a form field is left alone',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, docListeners, tagged } = runtimeSandbox();
    docListeners.click({ target: tagged, preventDefault() {}, stopPropagation() {} });
    const before = messages.length;
    docListeners.keydown({ key: 'Backspace', target: { tagName: 'INPUT' }, preventDefault() {} });
    assert.strictEqual(messages.length, before, 'Backspace stolen from a text field');
  },
});

cases.push({
  name: 'runtime: the canvas can select an element by id',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, winListeners } = runtimeSandbox();
    assert.ok(winListeners.message, 'message listener not registered');
    winListeners.message({ data: { type: 'FRAMELAB_SELECT', framelabId: 'div|/a/B.tsx|3|10' } });
    const click = messages.find((m) => m.type === 'FRAMELAB_CLICK');
    assert.ok(click, `no click echo: ${JSON.stringify(messages)}`);
    assert.strictEqual(click.fromCanvas, true);
    assert.strictEqual(click.framelabId, 'div|/a/B.tsx|3|10');
  },
});

cases.push({
  name: 'runtime: selecting a missing element reports not-found',
  filename: path.join(__dirname, 'fixtures', 'pages', '_app.tsx'),
  options: { injectClickRuntime: true },
  input: `export default function App() { return <div/>; }\n`,
  expect: () => {
    const { messages, winListeners } = runtimeSandbox();
    winListeners.message({ data: { type: 'FRAMELAB_SELECT', framelabId: 'nope|/x.tsx|1|1' } });
    assert.ok(messages.some((m) => m.type === 'FRAMELAB_NOT_FOUND'), 'no not-found message');
  },
});

let passed = 0;
let failed = 0;
for (const c of cases) {
  const savedEnv = {};
  if (c.envOverride) {
    for (const [k, v] of Object.entries(c.envOverride)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }
  try {
    const out = transform(c.input, c.filename, c.options);
    c.expect(out);
    passed++;
    console.log(`  ok  ${c.name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${c.name}`);
    console.log(`       ${err.message}`);
  } finally {
    if (c.envOverride) {
      for (const k of Object.keys(c.envOverride)) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
    }
  }
}

console.log(`\n${passed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
