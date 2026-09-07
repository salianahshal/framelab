'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { execFileSync } = require('child_process');

const astEngine = require('../src/astEngine');
const tailwindParser = require('../src/tailwindParser');
const gitEngine = require('../src/gitEngine');
const themeEngine = require('../src/themeEngine');
const { createSyncServer } = require('../src/syncServer');

const SAMPLE = path.join(__dirname, 'sample', 'Button.tsx');

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function divider(label) {
  console.log(`\n=== ${label} ===`);
}

async function main() {
  const original = fs.readFileSync(SAMPLE, 'utf8');
  const originalHash = sha(original);

  divider('extract elements from sample/Button.tsx');
  const { elements } = astEngine.extractElements(SAMPLE);
  for (const el of elements) {
    console.log(`  ${el.line}:${el.startChar}  <${el.tagName}>  className(${el.classNameKind})=${JSON.stringify(el.className)}`);
  }

  const button = elements.find((e) => e.tagName === 'button');
  if (!button) throw new Error('expected to find <button> in sample');
  if (button.className !== 'px-6 py-3 bg-blue-600 text-white rounded-lg') {
    throw new Error(`unexpected className: ${button.className}`);
  }

  divider('parse current button className into props');
  const parsed = tailwindParser.parseClassName(button.className);
  console.log(JSON.stringify(parsed, null, 2));
  if (parsed.props.background !== 'blue-600') {
    throw new Error(`expected background blue-600, got ${parsed.props.background}`);
  }

  divider('astEngine.updateClassName: replace bg-blue-600 with bg-red-500');
  const newClassName = button.className.replace('bg-blue-600', 'bg-red-500');
  const result = astEngine.updateClassName(SAMPLE, button.framelabId, newClassName);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error(`update failed: ${result.reason}`);

  divider('verify file content after update');
  const after = fs.readFileSync(SAMPLE, 'utf8');
  console.log(after);

  divider('integrity checks');
  const reextracted = astEngine.extractElements(SAMPLE).elements;
  const buttonAfter = reextracted.find((e) => e.tagName === 'button');
  if (!buttonAfter) throw new Error('button vanished after update');
  if (buttonAfter.className !== newClassName) {
    throw new Error(`className mismatch: ${buttonAfter.className}`);
  }
  console.log(`  button.className = ${buttonAfter.className}  OK`);

  if (after.includes('bg-blue-600')) throw new Error('old class still present');
  if (!after.includes('bg-red-500')) throw new Error('new class not present');
  console.log('  bg-blue-600 absent / bg-red-500 present  OK');

  const otherDiff = after
    .replace('bg-red-500', 'bg-blue-600');
  if (otherDiff !== original) {
    const diffLine = firstDiffLine(original, otherDiff);
    throw new Error(`unexpected change outside className. First diff at line ${diffLine}`);
  }
  console.log('  no other code changed  OK');

  divider('revert back to bg-blue-600');
  const revertResult = astEngine.updateClassName(
    SAMPLE,
    buttonAfter.framelabId,
    'px-6 py-3 bg-blue-600 text-white rounded-lg'
  );
  console.log(JSON.stringify(revertResult, null, 2));
  const reverted = fs.readFileSync(SAMPLE, 'utf8');
  if (sha(reverted) !== originalHash) {
    throw new Error('revert did not restore original file byte-for-byte');
  }
  console.log('  reverted file hash matches original  OK');

  divider('tailwindParser.mergeProps round-trip');
  const merged = tailwindParser.mergeProps(
    'px-6 py-3 bg-blue-600 text-white rounded-lg',
    { background: 'red-500' }
  );
  console.log(`  merged: ${merged}`);
  if (!merged.includes('bg-red-500')) throw new Error('mergeProps did not apply background');
  if (merged.includes('bg-blue-600')) throw new Error('mergeProps did not replace previous bg');
  if (!merged.includes('text-white')) throw new Error('mergeProps lost text color');
  if (!merged.includes('rounded-lg')) throw new Error('mergeProps lost rounded');

  divider('HTTP /update integration test (start server, POST, broadcast)');
  const server = createSyncServer({ rootDir: path.dirname(SAMPLE), port: 0 });
  await new Promise((resolve) => server.server.listen(0, resolve));
  const port = server.server.address().port;
  console.log(`  server on :${port}`);

  const updateResult = await postJson(port, '/update', {
    filePath: SAMPLE,
    elementId: buttonAfter.framelabId,
    props: { background: 'emerald-500' },
  });
  console.log(`  POST /update -> ${updateResult.status}`);
  if (updateResult.status !== 200) {
    throw new Error(`update failed: ${JSON.stringify(updateResult.body)}`);
  }
  const httpAfter = fs.readFileSync(SAMPLE, 'utf8');
  if (!httpAfter.includes('bg-emerald-500')) {
    throw new Error('HTTP update did not apply new className');
  }
  if (httpAfter.includes('bg-blue-600')) {
    throw new Error('HTTP update did not replace previous className');
  }
  console.log('  HTTP /update applied bg-emerald-500  OK');

  fs.writeFileSync(SAMPLE, original, 'utf8');
  if (sha(fs.readFileSync(SAMPLE, 'utf8')) !== originalHash) {
    throw new Error('final restore failed');
  }
  console.log('  file restored to original  OK');

  await server.close();
  console.log('  server closed  OK');

  divider('text content extraction');
  const elsAll = astEngine.extractElements(SAMPLE).elements;
  for (const el of elsAll) {
    console.log(`  <${el.tagName}> L${el.line}  textKind=${el.textKind}  textContent=${JSON.stringify(el.textContent)}`);
  }
  const h2 = elsAll.find((e) => e.tagName === 'h2');
  if (!h2) throw new Error('expected <h2> in sample');
  if (h2.textKind !== 'text') throw new Error(`h2 should be text, got ${h2.textKind}`);
  if (h2.textContent !== 'Sign up today') throw new Error(`h2 text mismatch: ${h2.textContent}`);

  const buttonStillThere = elsAll.find((e) => e.tagName === 'button');
  if (buttonStillThere.textKind !== 'expression') {
    throw new Error(`button should be expression (uses {label}), got ${buttonStillThere.textKind}`);
  }
  console.log('  h2 editable text + button expression detected correctly  OK');

  divider('updateTextContent: rewrite h2 text');
  const originalForText = fs.readFileSync(SAMPLE, 'utf8');
  const originalForTextHash = sha(originalForText);

  const textResult = astEngine.updateTextContent(SAMPLE, h2.framelabId, 'Welcome aboard');
  console.log(JSON.stringify(textResult, null, 2));
  if (!textResult.ok) throw new Error(`updateTextContent failed: ${textResult.reason}`);
  const afterText = fs.readFileSync(SAMPLE, 'utf8');
  if (!afterText.includes('Welcome aboard')) throw new Error('new text missing');
  if (afterText.includes('Sign up today')) throw new Error('old text still present');
  console.log('  text rewritten in place  OK');

  const reverseSwap = afterText.replace('Welcome aboard', 'Sign up today');
  if (reverseSwap !== originalForText) {
    const diffLine = firstDiffLine(originalForText, reverseSwap);
    throw new Error(`unexpected change outside text. First diff at line ${diffLine}`);
  }
  console.log('  no other code changed  OK');

  divider('text edit refuses on element with JSX expression children');
  const buttonResult = astEngine.updateTextContent(SAMPLE, buttonStillThere.framelabId, 'Should fail');
  console.log(JSON.stringify(buttonResult));
  if (buttonResult.ok) throw new Error('expected refusal for expression-bearing element');
  if (buttonResult.reason !== 'has-expression-children') {
    throw new Error(`unexpected reason: ${buttonResult.reason}`);
  }
  console.log('  refused with has-expression-children  OK');

  divider('revert h2 text');
  const updatedH2 = astEngine.extractElements(SAMPLE).elements.find((e) => e.tagName === 'h2');
  astEngine.updateTextContent(SAMPLE, updatedH2.framelabId, 'Sign up today');
  if (sha(fs.readFileSync(SAMPLE, 'utf8')) !== originalForTextHash) {
    throw new Error('text revert did not match original');
  }
  console.log('  h2 text reverted exactly to original bytes  OK');

  divider('HTTP /update with textContent');
  const server2 = createSyncServer({ rootDir: path.dirname(SAMPLE), port: 0 });
  await new Promise((r) => server2.server.listen(0, r));
  const port2 = server2.server.address().port;
  const httpResult = await postJson(port2, '/update', {
    filePath: SAMPLE,
    elementId: updatedH2.framelabId,
    textContent: 'Hello universe',
  });
  console.log(`  POST /update textContent -> ${httpResult.status}, applied ${JSON.stringify(httpResult.body.applied)}`);
  if (httpResult.status !== 200) throw new Error(`update failed: ${JSON.stringify(httpResult.body)}`);
  if (!fs.readFileSync(SAMPLE, 'utf8').includes('Hello universe')) {
    throw new Error('HTTP textContent update did not apply');
  }
  fs.writeFileSync(SAMPLE, originalForText, 'utf8');
  await server2.close();
  console.log('  HTTP textContent update applied + reverted  OK');

  divider('moveElement: sibling reorder');
  const moveOriginal = fs.readFileSync(SAMPLE, 'utf8');
  const moveOriginalHash = sha(moveOriginal);

  const elsBefore = astEngine.extractElements(SAMPLE).elements;
  const sourceP = elsBefore.find((e) => e.tagName === 'p');
  const targetH2 = elsBefore.find((e) => e.tagName === 'h2');
  if (!sourceP || !targetH2) throw new Error('expected <p> and <h2> in sample');
  console.log(`  source <p> L${sourceP.line}, target <h2> L${targetH2.line}`);

  const moveResult = astEngine.moveElement(SAMPLE, sourceP.framelabId, targetH2.framelabId, 'before');
  console.log(JSON.stringify(moveResult, null, 2));
  if (!moveResult.ok) throw new Error(`move failed: ${moveResult.reason}`);

  const afterMove = fs.readFileSync(SAMPLE, 'utf8');
  console.log(afterMove);

  const elsAfter = astEngine.extractElements(SAMPLE).elements;
  const pAfter = elsAfter.find((e) => e.tagName === 'p');
  const h2After = elsAfter.find((e) => e.tagName === 'h2');
  if (pAfter.line >= h2After.line) {
    throw new Error(`expected <p> to be ABOVE <h2>; got p L${pAfter.line}, h2 L${h2After.line}`);
  }
  console.log(`  <p> now at L${pAfter.line}, <h2> now at L${h2After.line}  OK`);

  if (afterMove.length !== moveOriginal.length) {
    throw new Error(`byte-length changed unexpectedly: ${moveOriginal.length} -> ${afterMove.length}`);
  }
  console.log('  file length preserved (pure reorder)  OK');

  divider('moveElement: refuses cross-parent move');
  const buttonForCross = elsAfter.find((e) => e.tagName === 'button');
  const outerDiv = elsAfter.find((e) => e.tagName === 'div');
  const cross = astEngine.moveElement(SAMPLE, buttonForCross.framelabId, outerDiv.framelabId, 'after');
  console.log(JSON.stringify(cross));
  if (cross.ok || cross.reason !== 'cross-parent-not-supported') {
    throw new Error(`expected cross-parent refusal, got ${JSON.stringify(cross)}`);
  }
  console.log('  refused with cross-parent-not-supported  OK');

  divider('moveElement: revert');
  const elsRevert = astEngine.extractElements(SAMPLE).elements;
  const pRevert = elsRevert.find((e) => e.tagName === 'p');
  const buttonRevert = elsRevert.find((e) => e.tagName === 'button');
  // p is now first; move it back to before button (i.e. between h2 and button) — restoring original order
  astEngine.moveElement(SAMPLE, pRevert.framelabId, buttonRevert.framelabId, 'before');
  if (sha(fs.readFileSync(SAMPLE, 'utf8')) !== moveOriginalHash) {
    throw new Error('move revert did not restore original');
  }
  console.log('  file restored byte-for-byte  OK');

  divider('HTTP /move integration');
  const server3 = createSyncServer({ rootDir: path.dirname(SAMPLE), port: 0 });
  await new Promise((r) => server3.server.listen(0, r));
  const port3 = server3.server.address().port;
  const httpMoveResult = await postJson(port3, '/move', {
    filePath: SAMPLE,
    sourceId: sourceP.framelabId,
    targetId: targetH2.framelabId,
    position: 'before',
  });
  console.log(`  POST /move -> ${httpMoveResult.status}, ok=${httpMoveResult.body.ok}`);
  if (httpMoveResult.status !== 200) throw new Error(`http /move failed: ${JSON.stringify(httpMoveResult.body)}`);
  fs.writeFileSync(SAMPLE, moveOriginal, 'utf8');
  await server3.close();
  console.log('  HTTP /move applied + reverted  OK');

  divider('astEngine: template literal className (edit static, preserve ${...})');
  testTemplateLiteralClassName();

  divider('gitEngine.revertHunk: temp repo, multi-hunk revert');
  await testRevertHunk();

  divider('themeEngine: flatten + extract colors (pure)');
  testFlattenColors();

  divider('themeEngine: load real tailwind.config from test-next-app');
  await testLoadRealTheme();

  divider('themeEngine: load .ts config via jiti');
  await testLoadTsConfig();

  divider('all server tests passed');
}

function testTemplateLiteralClassName() {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-tpl-'));
  const file = path.join(dir, 'Tpl.tsx');
  const original = [
    "const focusRing = 'ring-2 ring-offset-2';",
    'export default function C() {',
    '  return (',
    '    <div>',
    '      <a className={`flex items-center px-3 text-sm ${focusRing}`}>x</a>',
    "      <button className={cn('p-2', active && 'bg-red')}>y</button>",
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(file, original, 'utf8');

  const els = astEngine.extractElements(file).elements;
  const a = els.find((e) => e.tagName === 'a');
  const button = els.find((e) => e.tagName === 'button');

  assert(a.classNameKind === 'template', `expected template kind, got ${a.classNameKind}`);
  // Interpolations appear as pinned placeholders so an edit can never move or
  // drop them; the static classes surround them exactly as in the source.
  assert(
    a.className === 'flex items-center px-3 text-sm __FRAMELAB_EXPR_0__',
    `static classes wrong: "${a.className}"`
  );
  assert(
    Array.isArray(a.classNameDynamic) && a.classNameDynamic[0] === '${focusRing}',
    `dynamic parts wrong: ${JSON.stringify(a.classNameDynamic)}`
  );
  console.log('  extract: <a> is kind=template, static + ${focusRing} split  OK');

  // cn(...) is now an editable surface: the first string literal argument
  // holds the base classes, and the remaining arguments are left alone.
  assert(
    button.classNameKind === 'call',
    `cn() should be kind=call, got ${button.classNameKind}`
  );
  assert(button.className === 'p-2', `cn() base classes wrong: "${button.className}"`);
  console.log('  extract: cn() button is kind=call with editable base classes  OK');

  // Edit the static classes; the ${focusRing} interpolation must survive verbatim
  // and stay in its original trailing position.
  const res = astEngine.updateClassName(
    file, a.framelabId, 'flex items-center px-4 text-base __FRAMELAB_EXPR_0__'
  );
  assert(res.ok, `update failed: ${JSON.stringify(res)}`);
  const after = fs.readFileSync(file, 'utf8');
  const expectedLine = '<a className={`flex items-center px-4 text-base ${focusRing}`}>';
  assert(after.includes(expectedLine), `rewrite wrong:\n${after}`);
  assert(after.includes('${focusRing}'), 'interpolation lost');
  console.log('  update: static classes rewritten, ${focusRing} preserved  OK');

  // Re-extract and confirm it is still a clean template with new static value.
  const a2 = astEngine.extractElements(file).elements.find((e) => e.tagName === 'a');
  assert(
    a2.classNameKind === 'template' &&
      a2.className === 'flex items-center px-4 text-base __FRAMELAB_EXPR_0__',
    `re-extract wrong: ${a2.classNameKind} "${a2.className}"`
  );
  console.log('  round-trip: re-extracts as template with updated classes  OK');

  fs.rmSync(dir, { recursive: true, force: true });
}

async function testLoadTsConfig() {
  // Create a temp dir, drop a tailwind.config.ts in it, point loadUserConfig
  // at that file, and verify TS-only syntax (`as const`, type imports) loaded.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-ts-cfg-'));
  const tsFile = path.join(dir, 'tailwind.config.ts');
  fs.writeFileSync(tsFile, [
    `import type { Config } from 'tailwindcss';`,
    ``,
    `const colors = {`,
    `  brand: '#abcdef' as const,`,
    `  accent: { DEFAULT: '#ff8800', dark: '#aa5500' },`,
    `};`,
    ``,
    `const config: Config = {`,
    `  content: [],`,
    `  theme: { extend: { colors } },`,
    `};`,
    ``,
    `export default config;`,
  ].join('\n'));

  try {
    const cfg = await themeEngine.loadUserConfig(tsFile);
    console.log('  loaded config keys:', Object.keys(cfg));
    if (!cfg || !cfg.theme || !cfg.theme.extend || !cfg.theme.extend.colors) {
      throw new Error(`config shape unexpected: ${JSON.stringify(cfg)}`);
    }
    const c = cfg.theme.extend.colors;
    if (c.brand !== '#abcdef') throw new Error(`brand mismatch: ${c.brand}`);
    if (c.accent.DEFAULT !== '#ff8800') throw new Error(`accent.DEFAULT mismatch`);
    if (c.accent.dark !== '#aa5500') throw new Error(`accent.dark mismatch`);
    console.log('  TS-syntax (type imports + as const) loaded correctly  OK');

    // Now verify extractTokens flattens it as expected
    const tokens = themeEngine.extractTokens({ colors: c }, []);
    const names = tokens.colors.all.map((t) => t.name);
    for (const want of ['brand', 'accent', 'accent-dark']) {
      if (!names.includes(want)) throw new Error(`expected token ${want}, got ${names}`);
    }
    console.log('  flattens through extractTokens cleanly  OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testFlattenColors() {
  const flat = themeEngine.flattenColors({
    brand: { DEFAULT: '#6e56cf', light: '#8b72e8', dark: '#4a3a8a' },
    surface: { DEFAULT: '#0c0c0e', 1: '#111114', 2: '#18181d' },
    accent: '#3dd68c',
    nested: { DEFAULT: '#fff', deep: { shade: '#888' } },
    transparent: 'transparent',
  });
  const byName = Object.fromEntries(flat.map((e) => [e.name, e.value]));
  console.log('  flattened:', byName);

  const expectations = {
    'brand': '#6e56cf',
    'brand-light': '#8b72e8',
    'brand-dark': '#4a3a8a',
    'surface': '#0c0c0e',
    'surface-1': '#111114',
    'surface-2': '#18181d',
    'accent': '#3dd68c',
    'nested': '#fff',
    'nested-deep-shade': '#888',
    'transparent': 'transparent',
  };
  for (const [name, expected] of Object.entries(expectations)) {
    if (byName[name] !== expected) {
      throw new Error(`flatten mismatch: ${name} expected ${expected}, got ${byName[name]}`);
    }
  }
  console.log('  all 10 expected entries present, including DEFAULT + nested  OK');

  const tokens = themeEngine.extractTokens(
    { colors: { red: { 500: '#f00' }, brand: { DEFAULT: '#6e56cf' } } },
    ['red', 'blue']  // these are "default" Tailwind palette names
  );
  if (!tokens.colors.custom.find((c) => c.name === 'brand')) {
    throw new Error('brand should be classified as custom');
  }
  if (!tokens.colors.defaults.find((c) => c.name === 'red-500')) {
    throw new Error('red-500 should be classified as default');
  }
  console.log('  custom vs default partition  OK');
}

async function testLoadRealTheme() {
  const projectDir = path.resolve(__dirname, '..', '..', '..', 'examples', 'test-next-app');
  const hasConfig = themeEngine.CONFIG_CANDIDATES.some((c) =>
    fs.existsSync(path.join(projectDir, c))
  );
  if (!hasConfig) {
    console.log('  skipped (no tailwind config in test app)');
    return;
  }
  if (!fs.existsSync(path.join(projectDir, 'node_modules', 'tailwindcss'))) {
    console.log('  skipped (tailwindcss not installed in test app)');
    return;
  }

  const result = await themeEngine.loadTheme(projectDir);
  console.log(`  found=${result.found} configFile=${path.basename(result.configFile || '')}`);
  if (!result.found) throw new Error('expected to find tailwind.config.js');
  if (!result.tokens) throw new Error(`tokens missing: ${result.reason}`);

  const customNames = result.tokens.colors.custom.map((c) => c.name);
  console.log('  custom colors:', customNames);
  const expectedCustom = ['brand', 'brand-light', 'brand-dark', 'surface', 'surface-1', 'surface-2', 'accent'];
  for (const name of expectedCustom) {
    if (!customNames.includes(name)) {
      throw new Error(`expected custom color ${name}, got ${customNames}`);
    }
  }
  console.log(`  all ${expectedCustom.length} expected custom tokens present  OK`);

  const customRadius = result.tokens.borderRadius.custom;
  if (!customRadius.includes('card')) {
    throw new Error(`expected custom radius "card", got ${customRadius}`);
  }
  console.log('  custom borderRadius "card" detected  OK');

  const customSpacing = result.tokens.spacing.custom;
  if (!customSpacing.includes('gutter')) {
    throw new Error(`expected custom spacing "gutter", got ${customSpacing}`);
  }
  console.log('  custom spacing "gutter" detected  OK');

  const customShadow = result.tokens.boxShadow.custom;
  if (!customShadow.includes('card')) {
    throw new Error(`expected custom boxShadow "card", got ${customShadow}`);
  }
  console.log('  custom boxShadow "card" detected  OK');

  // The "all" set must include both defaults and custom in stable order
  const allRadius = result.tokens.borderRadius.all;
  if (!allRadius.includes('card') || !allRadius.includes('lg')) {
    throw new Error('borderRadius.all should include both custom and default keys');
  }
  if (result.tokens.borderRadius.defaults.includes('card')) {
    throw new Error('"card" should not be in defaults');
  }
  console.log('  all/custom/defaults partitions are consistent  OK');

  const brandHex = result.tokens.colors.custom.find((c) => c.name === 'brand');
  if (brandHex.value !== '#6e56cf') {
    throw new Error(`brand value mismatch: ${brandHex.value}`);
  }
  console.log('  brand color resolves to #6e56cf  OK');
}

async function testRevertHunk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framelab-git-'));
  const file = path.join(dir, 'sample.txt');
  function git(...args) {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  }
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@framelab.local');
    git('config', 'user.name', 'Framelab Test');
    // Initial file with 12 lines so we can have 2 well-separated hunks
    const original = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    fs.writeFileSync(file, original);
    git('add', '-A');
    git('commit', '-q', '-m', 'init');

    // Modify lines 2 and 11 — that yields two distinct hunks (6 lines apart)
    const modified = original
      .replace('line 2\n', 'LINE_2_CHANGED\n')
      .replace('line 11\n', 'LINE_11_CHANGED\n');
    fs.writeFileSync(file, modified);

    const status1 = await gitEngine.getStatus(dir);
    if (!status1.initialized || status1.files.length !== 1) {
      throw new Error('expected 1 changed file');
    }
    const diff1 = await gitEngine.getDiff(dir);
    const hunkCount1 = (diff1.diff.match(/^@@/gm) || []).length;
    console.log(`  setup: ${hunkCount1} hunks in diff`);
    if (hunkCount1 !== 2) {
      throw new Error(`expected 2 hunks, got ${hunkCount1}; diff was:\n${diff1.diff}`);
    }

    // Revert just hunk 0 (the line 2 change)
    const r = await gitEngine.revertHunk(dir, file, 0);
    console.log(`  revertHunk(0): ${JSON.stringify(r)}`);
    if (!r.ok) throw new Error(`revertHunk failed: ${r.reason} ${r.detail || ''}`);

    const afterFirstRevert = fs.readFileSync(file, 'utf8');
    if (afterFirstRevert.includes('LINE_2_CHANGED')) {
      throw new Error('hunk 0 still in file after revert');
    }
    if (!afterFirstRevert.includes('LINE_11_CHANGED')) {
      throw new Error('hunk 1 was wrongly affected by revertHunk(0)');
    }
    console.log('  hunk 0 reverted, hunk 1 preserved  OK');

    const diff2 = await gitEngine.getDiff(dir);
    const hunkCount2 = (diff2.diff.match(/^@@/gm) || []).length;
    if (hunkCount2 !== 1) {
      throw new Error(`expected 1 hunk after revert, got ${hunkCount2}`);
    }
    console.log('  diff now has 1 remaining hunk  OK');

    // Revert remaining hunk (now at index 0)
    const r2 = await gitEngine.revertHunk(dir, file, 0);
    if (!r2.ok) throw new Error(`second revertHunk failed: ${r2.reason}`);
    if (fs.readFileSync(file, 'utf8') !== original) {
      throw new Error('file did not match original after both reverts');
    }
    console.log('  full revert restores original byte-for-byte  OK');

    // Out-of-range index returns reason
    fs.writeFileSync(file, modified);
    const r3 = await gitEngine.revertHunk(dir, file, 99);
    if (r3.ok || r3.reason !== 'hunk-out-of-range') {
      throw new Error(`expected hunk-out-of-range, got ${JSON.stringify(r3)}`);
    }
    console.log('  out-of-range index refused  OK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function firstDiffLine(a, b) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
    if (aLines[i] !== bLines[i]) return i + 1;
  }
  return -1;
}

function postJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
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
    req.write(data);
    req.end();
  });
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
