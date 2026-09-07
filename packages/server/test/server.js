'use strict';

// syncServer: request safety and the update/revert paths.
//
// The server writes to disk on request and listens on a port any page in the
// user's browser can reach, so containment and origin checks are load-bearing,
// not hygiene.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSyncServer, resolveInside } = require('../src/syncServer');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

function request(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: {
          ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const FIXTURE = `export default function Card() {
  return (
    <div className="p-4 bg-zinc-900 rounded-md">
      <h2 className="text-lg text-center font-semibold">Title</h2>
      <p className="text-zinc-400 border-t border-dashed">Body</p>
    </div>
  );
}
`;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-srv-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-out-'));
  const file = path.join(root, 'Card.tsx');
  const outsideFile = path.join(outside, 'secret.tsx');
  fs.writeFileSync(file, FIXTURE, 'utf8');
  fs.writeFileSync(outsideFile, 'export default () => <div className="x">s</div>;\n', 'utf8');

  const server = createSyncServer({ rootDir: root, port: 0, serveCanvas: false });
  await new Promise((r) => server.server.listen(0, '127.0.0.1', r));
  const port = server.server.address().port;

  console.log('\n=== path containment ===');

  await test('resolveInside accepts paths under the root', () => {
    assert.strictEqual(resolveInside(root, file), file);
    assert.strictEqual(resolveInside(root, 'Card.tsx'), file);
  });

  await test('resolveInside accepts a symlink-resolved form of the same path', () => {
    // macOS reports /private/var/... where the CLI was started from /var/...;
    // bundler-supplied paths arrive in the resolved form.
    const real = fs.realpathSync(root);
    if (real === root) return; // nothing to prove on this filesystem
    assert.ok(resolveInside(root, path.join(real, 'Card.tsx')), 'resolved form rejected');
    assert.ok(resolveInside(real, path.join(root, 'Card.tsx')), 'unresolved form rejected');
  });

  await test('resolveInside rejects escapes and absolute outsiders', () => {
    assert.strictEqual(resolveInside(root, outsideFile), null);
    assert.strictEqual(resolveInside(root, '../../etc/passwd'), null);
    assert.strictEqual(resolveInside(root, '/etc/passwd'), null);
  });

  await test('/update refuses to write outside the project root', async () => {
    const before = fs.readFileSync(outsideFile, 'utf8');
    const res = await request(port, 'POST', '/update', {
      filePath: outsideFile,
      elementId: 'div|' + outsideFile + '|1|22',
      className: 'pwned',
    });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
    assert.strictEqual(fs.readFileSync(outsideFile, 'utf8'), before, 'file was modified');
  });

  await test('/snapshot refuses to read outside the project root', async () => {
    const res = await request(
      port, 'GET', `/snapshot?filePath=${encodeURIComponent(outsideFile)}`
    );
    assert.strictEqual(res.status, 403);
  });

  await test('/watch refuses paths outside the project root', async () => {
    const res = await request(port, 'POST', '/watch', { filePath: outsideFile });
    assert.strictEqual(res.status, 403);
  });

  console.log('\n=== origin guard ===');

  await test('a cross-origin write is rejected', async () => {
    const before = fs.readFileSync(file, 'utf8');
    const res = await request(port, 'POST', '/update',
      { filePath: file, elementId: 'x', className: 'pwned' },
      { origin: 'https://evil.example.com' });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  });

  await test('a localhost origin is allowed', async () => {
    const res = await request(port, 'GET', '/health', undefined,
      { origin: 'http://localhost:3133' });
    assert.strictEqual(res.status, 200);
  });

  await test('a rebinding Host header is rejected', async () => {
    const res = await request(port, 'GET', '/health', undefined,
      { host: 'attacker.example.com' });
    assert.strictEqual(res.status, 403);
  });

  console.log('\n=== updates ===');

  await test('a props update preserves unrelated classes', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const h2 = snap.body.elements.find((e) => e.tagName === 'h2');
    assert.ok(h2, 'h2 not found');
    const res = await request(port, 'POST', '/update', {
      filePath: file,
      elementId: h2.framelabId,
      props: { textColor: 'red-500' },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('text-center'), `text-center destroyed:\n${after}`);
    assert.ok(after.includes('text-lg'), `text-lg destroyed:\n${after}`);
    assert.ok(after.includes('text-red-500'), after);
  });

  await test('a variant edit writes a responsive class', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const p = snap.body.elements.find((e) => e.tagName === 'p');
    const res = await request(port, 'POST', '/update', {
      filePath: file,
      elementId: p.framelabId,
      edits: [{ prop: 'padding', value: { top: '8', right: '8', bottom: '8', left: '8' }, variants: ['md'] }],
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('md:p-8'), `responsive class missing:\n${after}`);
    assert.ok(after.includes('border-dashed'), `border-dashed destroyed:\n${after}`);
  });

  await test('the snapshot exposes variants for the inspector', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const p = snap.body.elements.find((e) => e.tagName === 'p');
    assert.ok(p.props.variants.includes('md'), JSON.stringify(p.props.variants));
    assert.strictEqual(p.props.variantProps['md'].padding.top, '8');
    assert.ok(Array.isArray(p.props.tokens), 'tokens missing');
    assert.ok(p.stableKey, 'stableKey missing');
  });

  await test('an update resolves an element by stable key after offsets move', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const p = snap.body.elements.find((e) => e.tagName === 'p');
    const staleId = p.framelabId.replace(/\|\d+$/, '|999999');
    const res = await request(port, 'POST', '/update', {
      filePath: file,
      elementId: staleId,
      stableKey: p.stableKey,
      props: { opacity: '50' },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(fs.readFileSync(file, 'utf8').includes('opacity-50'));
  });

  console.log('\n=== selection (agent context) ===');

  await test('with nothing selected the answer says so', async () => {
    const res = await request(port, 'GET', '/selection');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.selected, false);
    assert.ok(res.body.hint, 'no hint for an agent to act on');
  });

  await test('a published selection comes back with full source context', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const h2 = snap.body.elements.find((e) => e.tagName === 'h2');
    const put = await request(port, 'POST', '/selection', {
      selected: true,
      framelabId: h2.framelabId,
      stableKey: h2.stableKey,
      filePath: file,
      breakpoint: 'md',
      state: 'hover',
      viewportWidth: 768,
      computed: { color: 'rgb(0, 0, 0)' },
    });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));

    const res = await request(port, 'GET', '/selection');
    assert.strictEqual(res.body.selected, true, JSON.stringify(res.body));
    assert.strictEqual(res.body.element.tagName, 'h2');
    assert.strictEqual(res.body.file, 'Card.tsx');
    assert.ok(res.body.element.line > 0);
    assert.ok(res.body.element.className.includes('text-center'), res.body.element.className);
    // The variant the user has open is intent an agent should honour.
    assert.strictEqual(res.body.editingVariant.prefix, 'md:hover');
    assert.ok(Array.isArray(res.body.ancestors) && res.body.ancestors.length >= 1,
      JSON.stringify(res.body.ancestors));
    assert.strictEqual(res.body.ancestors[0].tagName, 'div');
    assert.strictEqual(res.body.computedStyle.color, 'rgb(0, 0, 0)');
  });

  await test('selection re-reads the file so it is never stale', async () => {
    const before = await request(port, 'GET', '/selection');
    const res = await request(port, 'POST', '/update', {
      filePath: file,
      elementId: before.body.element.framelabId,
      stableKey: before.body.element.stableKey,
      props: { fontWeight: 'bold' },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const after = await request(port, 'GET', '/selection');
    assert.ok(after.body.element.className.includes('font-bold'),
      `selection served a stale className: ${after.body.element.className}`);
  });

  await test('a selection outside the project root is refused', async () => {
    const res = await request(port, 'POST', '/selection', {
      selected: true, framelabId: 'x|y|1|1', filePath: outsideFile,
    });
    assert.strictEqual(res.status, 403);
  });

  await test('clearing the selection is reported honestly', async () => {
    await request(port, 'POST', '/selection', { selected: false });
    const res = await request(port, 'GET', '/selection');
    assert.strictEqual(res.body.selected, false);
  });

  console.log('\n=== design-system validation ===');

  await test('preview returns the resulting classes without writing', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const h2 = snap.body.elements.find((e) => e.tagName === 'h2');
    const before = fs.readFileSync(file, 'utf8');
    const res = await request(port, 'POST', '/update', {
      filePath: file, elementId: h2.framelabId, preview: true,
      props: { textColor: 'red-500' },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.preview, true);
    assert.ok(res.body.className.includes('text-red-500'), res.body.className);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'preview wrote to the file');
  });

  await test('strict mode refuses a value outside the project scales', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const h2 = snap.body.elements.find((e) => e.tagName === 'h2');
    const before = fs.readFileSync(file, 'utf8');
    const res = await request(port, 'POST', '/update', {
      filePath: file, elementId: h2.framelabId, strict: true,
      props: { fontSize: 'enormous' },
    });
    assert.strictEqual(res.status, 422, JSON.stringify(res.body));
    assert.ok(res.body.warnings.length, 'no warnings returned');
    assert.ok(res.body.warnings[0].message.includes('enormous'), res.body.warnings[0].message);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  });

  await test('without strict mode the same edit lands but is flagged', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const h2 = snap.body.elements.find((e) => e.tagName === 'h2');
    const res = await request(port, 'POST', '/update', {
      filePath: file, elementId: h2.framelabId,
      props: { fontSize: 'enormous' },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok((res.body.warnings || []).length, 'edit applied with no warning');
    // Put it back.
    await request(port, 'POST', '/update', {
      filePath: file, elementId: h2.framelabId, props: { fontSize: 'lg' },
    });
  });

  console.log('\n=== delete ===');

  await test('/delete removes an element and reports how to restore it', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const p = snap.body.elements.find((e) => e.tagName === 'p');
    const before = fs.readFileSync(file, 'utf8');
    const res = await request(port, 'POST', '/delete', {
      filePath: file, elementId: p.framelabId, stableKey: p.stableKey,
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(!after.includes('Body'), `element survived:\n${after}`);
    assert.ok(after.includes('Title'), `sibling was removed too:\n${after}`);
    assert.ok(res.body.removed.startsWith('<p'), res.body.removed);
    assert.strictEqual(typeof res.body.index, 'number');

    // And put it back.
    const back = await request(port, 'POST', '/insert', {
      filePath: file, parentKey: res.body.parentKey, index: res.body.index, source: res.body.removed,
    });
    assert.strictEqual(back.status, 200, JSON.stringify(back.body));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'restore did not match');
  });

  await test('/delete refuses the outermost element', async () => {
    const snap = await request(port, 'GET', `/snapshot?filePath=${encodeURIComponent(file)}`);
    const root = snap.body.elements.find((e) => e.stableKey === '0');
    const before = fs.readFileSync(file, 'utf8');
    const res = await request(port, 'POST', '/delete', {
      filePath: file, elementId: root.framelabId, stableKey: root.stableKey,
    });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.error, 'cannot-delete-root');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  });

  await test('/delete refuses paths outside the project root', async () => {
    const before = fs.readFileSync(outsideFile, 'utf8');
    const res = await request(port, 'POST', '/delete', {
      filePath: outsideFile, elementId: 'div|' + outsideFile + '|1|22',
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(fs.readFileSync(outsideFile, 'utf8'), before);
  });

  console.log('\n=== revert ===');

  await test('revert-file accepts a repo-relative path', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 't@framelab.local'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });

    const committed = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, committed.replace('p-4', 'p-12'), 'utf8');

    // The canvas sends the path exactly as git reports it: relative to root.
    const res = await request(port, 'POST', '/diff/revert-file', { filePath: 'Card.tsx' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), committed, 'file not reverted');
  });

  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });

  console.log(`\n${passed}/${passed + failed} server tests passed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.name}: ${f.err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFAIL:', err.stack || err.message);
  process.exit(1);
});
