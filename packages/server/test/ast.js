'use strict';

// astEngine: class-string surfaces, safe text writes, structural identity.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ast = require('../src/astEngine');
const tp = require('../src/tailwindParser');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

let tmpDir;
function withFile(source, fn) {
  const file = path.join(tmpDir, `T${Math.random().toString(36).slice(2, 8)}.tsx`);
  fs.writeFileSync(file, source, 'utf8');
  try {
    return fn(file);
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}
function elementsOf(file) {
  return ast.extractElements(file).elements;
}
function find(file, tag) {
  return elementsOf(file).find((e) => e.tagName === tag);
}

tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-ast-'));

// ---------------------------------------------------------------------------

console.log('\n=== className surfaces ===');

test('plain string classNames are editable', () => {
  withFile('export default () => <div className="p-4 flex">x</div>;\n', (file) => {
    const el = find(file, 'div');
    assert.strictEqual(el.classNameKind, 'string');
    assert.strictEqual(el.classNameEditable, true);
    assert.strictEqual(el.className, 'p-4 flex');
  });
});

test('cn() with a leading string literal is editable', () => {
  withFile(
    "export default ({active}) => <button className={cn('px-4 py-2', active && 'bg-red-500')}>x</button>;\n",
    (file) => {
      const el = find(file, 'button');
      assert.strictEqual(el.classNameKind, 'call');
      assert.strictEqual(el.classNameEditable, true);
      assert.strictEqual(el.className, 'px-4 py-2');
      assert.strictEqual(el.classNameHelper, 'cn');
    }
  );
});

test('editing cn() rewrites only the literal and keeps the other arguments', () => {
  const src = "export default ({active}) => <button className={cn('px-4 py-2', active && 'bg-red-500')}>x</button>;\n";
  withFile(src, (file) => {
    const el = find(file, 'button');
    const next = tp.mergeProps(el.className, { padding: { top: '3', right: '6', bottom: '3', left: '6' } });
    const res = ast.updateClassName(file, el.framelabId, next);
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes("cn('px-6 py-3'") || after.includes('cn("px-6 py-3"'), after);
    assert.ok(after.includes("active && 'bg-red-500'"), `conditional argument lost:\n${after}`);
  });
});

test('clsx / twMerge / cva are recognised too', () => {
  for (const helper of ['clsx', 'twMerge', 'cva', 'classNames']) {
    withFile(`export default () => <div className={${helper}('p-2', x)}>y</div>;\n`, (file) => {
      const el = find(file, 'div');
      assert.strictEqual(el.classNameKind, 'call', `${helper} not recognised`);
      assert.strictEqual(el.className, 'p-2');
    });
  }
});

test('cn() with no string literal gains a leading base argument', () => {
  withFile('export default () => <div className={cn(styles.root)}>y</div>;\n', (file) => {
    const el = find(file, 'div');
    assert.strictEqual(el.classNameKind, 'call-empty');
    const res = ast.updateClassName(file, el.framelabId, 'p-4');
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('cn("p-4", styles.root)'), after);
  });
});

test('a ternary className stays read-only', () => {
  withFile("export default ({a}) => <div className={a ? 'p-2' : 'p-4'}>y</div>;\n", (file) => {
    const el = find(file, 'div');
    assert.strictEqual(el.classNameKind, 'expression');
    assert.strictEqual(el.classNameEditable, false);
    const res = ast.updateClassName(file, el.framelabId, 'p-8');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'className-not-static');
  });
});

test('an element with no className gets one added', () => {
  withFile('export default () => <div>y</div>;\n', (file) => {
    const el = find(file, 'div');
    assert.strictEqual(el.classNameKind, 'none');
    const res = ast.updateClassName(file, el.framelabId, 'p-4');
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok(fs.readFileSync(file, 'utf8').includes('<div className="p-4">'), 'attribute not added');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== template literals ===');

test('interpolations keep their position when they lead the string', () => {
  const src = 'export default () => <a className={`${base} p-4 text-sm`}>x</a>;\n';
  withFile(src, (file) => {
    const el = find(file, 'a');
    assert.strictEqual(el.classNameKind, 'template');
    assert.ok(el.className.includes('__FRAMELAB_EXPR_0__'), el.className);
    const next = tp.mergeProps(el.className, { fontSize: 'lg' });
    const res = ast.updateClassName(file, el.framelabId, next);
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('`${base} p-4 text-lg`'), `position not preserved:\n${after}`);
  });
});

test('a trailing interpolation stays trailing', () => {
  const src = 'export default () => <a className={`p-4 ${ring}`}>x</a>;\n';
  withFile(src, (file) => {
    const el = find(file, 'a');
    const next = tp.mergeProps(el.className, { padding: { top: '8', right: '8', bottom: '8', left: '8' } });
    const res = ast.updateClassName(file, el.framelabId, next);
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok(fs.readFileSync(file, 'utf8').includes('`p-8 ${ring}`'), fs.readFileSync(file, 'utf8'));
  });
});

test('multiple interpolations all survive', () => {
  const src = 'export default () => <a className={`${a} p-4 ${b} flex`}>x</a>;\n';
  withFile(src, (file) => {
    const el = find(file, 'a');
    const next = tp.mergeProps(el.className, { display: 'grid' });
    ast.updateClassName(file, el.framelabId, next);
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('${a}'), after);
    assert.ok(after.includes('${b}'), after);
    assert.ok(after.includes('grid'), after);
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== text content safety ===');

test('text containing JSX syntax is written as an expression', () => {
  withFile('export default () => <p>hello</p>;\n', (file) => {
    const el = find(file, 'p');
    const res = ast.updateTextContent(file, el.framelabId, 'a { b } < c > d');
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.includes('{"a { b } < c > d"}'), after);
    // Still parses, and reads back as an expression child.
    const reread = find(file, 'p');
    assert.strictEqual(reread.textKind, 'expression');
  });
});

test('plain text stays plain text', () => {
  withFile('export default () => <p>hello</p>;\n', (file) => {
    const el = find(file, 'p');
    ast.updateTextContent(file, el.framelabId, 'goodbye');
    assert.ok(fs.readFileSync(file, 'utf8').includes('<p>goodbye</p>'));
  });
});

test('surrounding whitespace and indentation are preserved', () => {
  const src = 'export default () => (\n  <p>\n    hello\n  </p>\n);\n';
  withFile(src, (file) => {
    const el = find(file, 'p');
    ast.updateTextContent(file, el.framelabId, 'goodbye');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), src.replace('hello', 'goodbye'));
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== write safety ===');

test('a write that would break parsing is refused', () => {
  const src = 'export default () => <div className="p-4">x</div>;\n';
  withFile(src, (file) => {
    const el = find(file, 'div');
    // A quote in the class value would terminate the attribute early if it
    // were not escaped; JSON.stringify handles it, so this must succeed and
    // leave a parseable file.
    const res = ast.updateClassName(file, el.framelabId, 'p-4 before:content-["»"]');
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(fs.readFileSync(file, 'utf8').includes('p-4'), true);
    assert.doesNotThrow(() => ast.extractElements(file));
  });
});

test('an untouched file is never rewritten by extraction', () => {
  const src = 'export default () => <div className="p-4">x</div>;\n';
  withFile(src, (file) => {
    ast.extractElements(file);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), src);
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== structural identity ===');

const NESTED = `export default function App() {
  return (
    <section className="a">
      <div className="b">
        <span className="c">one</span>
        <span className="d">two</span>
      </div>
    </section>
  );
}
`;

test('stable keys describe the tree path', () => {
  withFile(NESTED, (file) => {
    const els = elementsOf(file);
    const byTagClass = Object.fromEntries(els.map((e) => [e.className, e.stableKey]));
    assert.strictEqual(byTagClass.a, '0');
    assert.strictEqual(byTagClass.b, '0.0');
    assert.strictEqual(byTagClass.c, '0.0.0');
    assert.strictEqual(byTagClass.d, '0.0.1');
  });
});

test('parentId links each element to its ancestor', () => {
  withFile(NESTED, (file) => {
    const els = elementsOf(file);
    const byClass = Object.fromEntries(els.map((e) => [e.className, e]));
    assert.strictEqual(byClass.a.parentId, null);
    assert.strictEqual(byClass.b.parentId, byClass.a.framelabId);
    assert.strictEqual(byClass.c.parentId, byClass.b.framelabId);
    assert.strictEqual(byClass.d.parentId, byClass.b.framelabId);
  });
});

test('stable keys survive a className edit that shifts every offset', () => {
  withFile(NESTED, (file) => {
    const before = elementsOf(file).find((e) => e.className === 'c');
    ast.updateClassName(file, elementsOf(file).find((e) => e.className === 'a').framelabId,
      'a-much-longer-class-name-than-before px-10 py-10');
    const after = elementsOf(file).find((e) => e.stableKey === before.stableKey);
    assert.ok(after, 'element not found by stable key after edit');
    assert.strictEqual(after.className, 'c');
    assert.notStrictEqual(after.framelabId, before.framelabId, 'byte offsets should have moved');
  });
});

test('an element can still be resolved by stale id via its stable key', () => {
  withFile(NESTED, (file) => {
    const before = elementsOf(file).find((e) => e.className === 'd');
    ast.updateClassName(file, elementsOf(file).find((e) => e.className === 'a').framelabId,
      'a padding-changed px-12 py-12 more classes here');
    const res = ast.updateClassName(file, before.framelabId, 'd-updated', {
      stableKey: before.stableKey,
    });
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok(fs.readFileSync(file, 'utf8').includes('d-updated'));
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== delete and restore ===');

const LIST = `export default function App() {
  return (
    <div className="wrap">
      <button className="a">One</button>
      <button className="b">Two</button>
      <button className="c">Three</button>
    </div>
  );
}
`;

test('deleting an element removes it and its line', () => {
  withFile(LIST, (file) => {
    const b = elementsOf(file).find((e) => e.className === 'b');
    const res = ast.deleteElement(file, b.framelabId);
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(!after.includes('className="b"'), after);
    assert.ok(after.includes('className="a"') && after.includes('className="c"'), after);
    // No blank or space-filled line left behind.
    assert.ok(!/\n[ \t]+\n/.test(after), `stray whitespace line:\n${JSON.stringify(after)}`);
    assert.strictEqual(after.split('\n').length, LIST.split('\n').length - 1, after);
  });
});

test('delete reports where the element was so it can be restored', () => {
  withFile(LIST, (file) => {
    const b = elementsOf(file).find((e) => e.className === 'b');
    const res = ast.deleteElement(file, b.framelabId);
    assert.strictEqual(res.index, 1);
    assert.strictEqual(res.tagName, 'button');
    assert.strictEqual(res.removed, '<button className="b">Two</button>');
    assert.ok(res.parentKey, 'parentKey missing');
  });
});

test('restoring a deleted element reproduces the file byte for byte', () => {
  withFile(LIST, (file) => {
    for (const cls of ['a', 'b', 'c']) {
      const before = fs.readFileSync(file, 'utf8');
      const el = elementsOf(file).find((e) => e.className === cls);
      const res = ast.deleteElement(file, el.framelabId);
      assert.ok(res.ok, JSON.stringify(res));
      const back = ast.insertElement(file, res.parentKey, res.index, res.removed);
      assert.ok(back.ok, JSON.stringify(back));
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before,
        `restore of "${cls}" did not match:\n${fs.readFileSync(file, 'utf8')}`);
    }
  });
});

test('deleting a nested element takes its children with it', () => {
  const nested = `export default () => (
  <section>
    <div className="card">
      <h2>Title</h2>
      <p>Body</p>
    </div>
    <footer>end</footer>
  </section>
);
`;
  withFile(nested, (file) => {
    const card = elementsOf(file).find((e) => e.className === 'card');
    const res = ast.deleteElement(file, card.framelabId);
    assert.ok(res.ok, JSON.stringify(res));
    const after = fs.readFileSync(file, 'utf8');
    for (const gone of ['card', '<h2>', '<p>']) {
      assert.ok(!after.includes(gone), `${gone} survived:\n${after}`);
    }
    assert.ok(after.includes('<footer>end</footer>'), after);
    assert.doesNotThrow(() => ast.extractElements(file));
  });
});

test('the outermost returned element refuses to be deleted', () => {
  withFile(LIST, (file) => {
    const wrap = elementsOf(file).find((e) => e.className === 'wrap');
    const res = ast.deleteElement(file, wrap.framelabId);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'cannot-delete-root');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), LIST, 'file was modified anyway');
  });
});

test('an element inside a fragment can be deleted', () => {
  const frag = `export default () => (
  <>
    <a href="/">home</a>
    <a href="/x">x</a>
  </>
);
`;
  withFile(frag, (file) => {
    const first = elementsOf(file)[0];
    const res = ast.deleteElement(file, first.framelabId);
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok(!fs.readFileSync(file, 'utf8').includes('home'));
  });
});

test('deleting a sibling on the same line leaves the rest intact', () => {
  withFile('export default () => <div><a>x</a><b>y</b></div>;\n', (file) => {
    const a = elementsOf(file).find((e) => e.tagName === 'a');
    const res = ast.deleteElement(file, a.framelabId);
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'export default () => <div><b>y</b></div>;\n');
  });
});

test('delete resolves a stale id through its stable key', () => {
  withFile(LIST, (file) => {
    const b = elementsOf(file).find((e) => e.className === 'b');
    ast.updateClassName(file, elementsOf(file).find((e) => e.className === 'a').framelabId,
      'a-with-a-much-longer-class-string px-10');
    const res = ast.deleteElement(file, b.framelabId, { stableKey: b.stableKey });
    assert.ok(res.ok, JSON.stringify(res));
    assert.ok(!fs.readFileSync(file, 'utf8').includes('className="b"'));
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== reordering ===');

const COMMENTED = `export default () => (
  <div>
    {/* Hero */}
    <section className="a">A</section>

    {/* Canvas preview */}
    <section className="b">B</section>
  </div>
);
`;

test('a leading comment moves with the element it labels', () => {
  withFile(COMMENTED, (file) => {
    const a = elementsOf(file).find((e) => e.className === 'a');
    const b = elementsOf(file).find((e) => e.className === 'b');
    assert.ok(ast.moveElement(file, a.framelabId, b.framelabId, 'after').ok);
    const after = fs.readFileSync(file, 'utf8');
    const heroAt = after.indexOf('{/* Hero */}');
    const previewAt = after.indexOf('{/* Canvas preview */}');
    const aAt = after.indexOf('className="a"');
    const bAt = after.indexOf('className="b"');
    assert.ok(previewAt < bAt && bAt < heroAt && heroAt < aAt,
      `comments did not travel with their sections:\n${after}`);
  });
});

test('a reorder and its reverse restore the file exactly', () => {
  withFile(COMMENTED, (file) => {
    const a = elementsOf(file).find((e) => e.className === 'a');
    const b = elementsOf(file).find((e) => e.className === 'b');
    ast.moveElement(file, a.framelabId, b.framelabId, 'after');
    const a2 = elementsOf(file).find((e) => e.className === 'a');
    const b2 = elementsOf(file).find((e) => e.className === 'b');
    ast.moveElement(file, a2.framelabId, b2.framelabId, 'before');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), COMMENTED);
  });
});

test('elements without comments still reorder cleanly', () => {
  const plain = `export default () => (
  <ul>
    <li>one</li>
    <li>two</li>
    <li>three</li>
  </ul>
);
`;
  withFile(plain, (file) => {
    const els = elementsOf(file).filter((e) => e.tagName === 'li');
    assert.ok(ast.moveElement(file, els[0].framelabId, els[2].framelabId, 'after').ok);
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.indexOf('two') < after.indexOf('three'), after);
    assert.ok(after.indexOf('three') < after.indexOf('one'), after);
    assert.strictEqual(after.length, plain.length, 'pure reorder changed the byte count');
  });
});

// ---------------------------------------------------------------------------

console.log('\n=== duplicate ===');

const DUP = `export default function App() {
  return (
    <ul className="grid">
      <li className="card p-4">One</li>
      <li className="card p-4">Two</li>
    </ul>
  );
}
`;

test('a duplicate lands directly after the original', () => {
  withFile(DUP, (file) => {
    const first = elementsOf(file).find((e) => e.textContent === 'One');
    const res = ast.duplicateElement(file, first.framelabId);
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(res.index, 1);
    const after = fs.readFileSync(file, 'utf8');
    const items = [...after.matchAll(/<li[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert.deepStrictEqual(items, ['One', 'One', 'Two'], after);
  });
});

test('the copy matches the original byte for byte, indentation included', () => {
  withFile(DUP, (file) => {
    const first = elementsOf(file).find((e) => e.textContent === 'One');
    ast.duplicateElement(file, first.framelabId);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const copies = lines.filter((l) => l.includes('>One<'));
    assert.strictEqual(copies.length, 2, lines.join('\n'));
    assert.strictEqual(copies[0], copies[1], 'indentation differs between original and copy');
  });
});

test('duplicating brings nested children along', () => {
  const nested = `export default () => (
  <div>
    <section className="a">
      <h2>Title</h2>
      <p>Body</p>
    </section>
    <footer>end</footer>
  </div>
);
`;
  withFile(nested, (file) => {
    const section = elementsOf(file).find((e) => e.className === 'a');
    assert.ok(ast.duplicateElement(file, section.framelabId).ok);
    const after = fs.readFileSync(file, 'utf8');
    assert.strictEqual((after.match(/<h2>Title<\/h2>/g) || []).length, 2, after);
    assert.strictEqual((after.match(/<section/g) || []).length, 2, after);
    assert.doesNotThrow(() => ast.extractElements(file));
  });
});

test('deleting the copy restores the original file exactly', () => {
  withFile(DUP, (file) => {
    const first = elementsOf(file).find((e) => e.textContent === 'One');
    const res = ast.duplicateElement(file, first.framelabId);
    const copy = elementsOf(file).find((e) => e.stableKey === `${res.parentKey}.${res.index}`);
    assert.ok(copy, 'copy not found by stable key');
    assert.ok(ast.deleteElement(file, copy.framelabId).ok);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), DUP);
  });
});

test('the outermost element refuses to be duplicated', () => {
  withFile(DUP, (file) => {
    const root = elementsOf(file).find((e) => e.stableKey === '0');
    const res = ast.duplicateElement(file, root.framelabId);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'cannot-duplicate-root');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), DUP);
  });
});

test('a duplicated element with a cn() className stays editable', () => {
  const src = `export default ({on}) => (
  <div>
    <button className={cn('px-3', on && 'bg-red')}>Go</button>
  </div>
);
`;
  withFile(src, (file) => {
    const btn = elementsOf(file).find((e) => e.tagName === 'button');
    assert.ok(ast.duplicateElement(file, btn.framelabId).ok);
    const buttons = elementsOf(file).filter((e) => e.tagName === 'button');
    assert.strictEqual(buttons.length, 2);
    assert.ok(buttons.every((b) => b.classNameKind === 'call' && b.classNameEditable));
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${passed}/${passed + failed} astEngine tests passed`);
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.err.message}`);
  process.exit(1);
}
