'use strict';

// Tailwind parser invariants.
//
// The two that matter most:
//   1. Round-trip identity — parsing and re-emitting an untouched class string
//      returns it byte-for-byte, including classes we don't understand.
//   2. No collateral damage — editing property P changes only tokens of P.
//
// Both were broken before: `text-center` was read as a text COLOUR and deleted
// on the next colour edit, `border-t`/`border-dashed` likewise, and custom
// theme keys (`shadow-card`) were duplicated instead of replaced.

const assert = require('assert');
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

// Real class strings pulled from the example app and common Tailwind codebases.
const CORPUS = [
  'px-6 py-3 bg-blue-600 text-white rounded-lg',
  'text-center text-white',
  'border-t border-dashed border-zinc-200',
  'rounded-card shadow-card p-4',
  'mt-6 text-[2.5rem] font-medium leading-[1.02] tracking-[-0.03em] text-white sm:text-6xl md:text-7xl',
  'hover:bg-blue-600 md:px-8 focus:ring-2',
  'flex items-center gap-3 border-b px-3 py-2',
  'pointer-events-none absolute -right-10 top-1/2 hidden h-[400px] w-[400px] -translate-y-1/2 select-none opacity-[0.055] lg:block xl:h-[480px]',
  'group inline-flex min-h-[44px] items-center gap-3 border bg-offgray-1000 px-4 font-mono text-[13px] text-offgray-200',
  'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50',
  'grid grid-cols-1 gap-px bg-offgray-900 sm:grid-cols-3',
  'mx-auto max-w-6xl border-x',
  '-mt-4 -mx-2 mb-0.5',
  'bg-ember/40 text-white/70 shadow-brand/30',
  'flex-1 flex-row flex-wrap',
  'dark:bg-black md:dark:hover:bg-white',
  '[&>svg]:size-4 supports-[display:grid]:grid',
  'p-4',
  '',
  'truncate uppercase italic underline',
  'overflow-x-auto overflow-hidden',
  'w-full h-auto min-w-0 max-w-prose',
  'cursor-pointer z-50 opacity-60',
];

// ---------------------------------------------------------------------------

console.log('\n=== round-trip identity ===');
for (const s of CORPUS) {
  test(`round-trips: ${JSON.stringify(s.slice(0, 52))}`, () => {
    const tokens = tp.tokenize(s);
    assert.strictEqual(tp.stringifyTokens(tokens), s.trim().replace(/\s+/g, ' '));
  });
}

test('round-trips through applyEdits with an empty edit list', () => {
  for (const s of CORPUS) {
    assert.strictEqual(tp.applyEdits(s, []), s.trim().replace(/\s+/g, ' '));
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== regressions: silent class destruction ===');

test('text-center survives a text colour edit', () => {
  const out = tp.mergeProps('text-center text-white', { textColor: 'red-500' });
  assert.ok(out.includes('text-center'), `text-center lost: ${out}`);
  assert.ok(out.includes('text-red-500'), `colour not applied: ${out}`);
  assert.ok(!out.includes('text-white'), `old colour kept: ${out}`);
});

test('text-center is classified as alignment, not colour', () => {
  const { props } = tp.parseClassName('text-center');
  assert.strictEqual(props.textAlign, 'center');
  assert.strictEqual(props.textColor, undefined);
});

test('border side and style survive a border colour edit', () => {
  const out = tp.mergeProps('border-t border-dashed border-zinc-200', { borderColor: 'blue-500' });
  assert.ok(out.includes('border-t'), `border-t lost: ${out}`);
  assert.ok(out.includes('border-dashed'), `border-dashed lost: ${out}`);
  assert.ok(out.includes('border-blue-500'), `colour not applied: ${out}`);
  assert.ok(!out.includes('border-zinc-200'), `old colour kept: ${out}`);
});

test('custom theme radius/shadow keys are replaced, not duplicated', () => {
  const theme = { borderRadius: ['card', 'lg'], boxShadow: ['card', 'md'] };
  const out = tp.mergeProps('rounded-card shadow-card p-4', { boxShadow: 'md' }, { theme });
  const shadows = out.split(/\s+/).filter((t) => t.startsWith('shadow'));
  assert.strictEqual(shadows.length, 1, `expected one shadow token, got ${JSON.stringify(shadows)}`);
  assert.strictEqual(shadows[0], 'shadow-md');
  assert.ok(out.includes('rounded-card'), `radius lost: ${out}`);
});

test('custom keys are handled even without theme information', () => {
  const out = tp.mergeProps('rounded-card shadow-card p-4', { borderRadius: 'lg' });
  const radii = out.split(/\s+/).filter((t) => t.startsWith('rounded'));
  assert.strictEqual(radii.length, 1, `duplicate radius: ${out}`);
  assert.strictEqual(radii[0], 'rounded-lg');
});

test('flex-1 is not mistaken for a flex direction', () => {
  const { props } = tp.parseClassName('flex-1');
  assert.strictEqual(props.flex, '1');
  assert.strictEqual(props.flexDirection, undefined);
  const out = tp.mergeProps('flex flex-1', { flexDirection: 'col' });
  assert.ok(out.includes('flex-1'), `flex-1 lost: ${out}`);
  assert.ok(out.includes('flex-col'), `direction not applied: ${out}`);
});

test('bg-cover is not mistaken for a background colour', () => {
  const { props } = tp.parseClassName('bg-cover');
  assert.strictEqual(props.bgSize, 'cover');
  const out = tp.mergeProps('bg-cover bg-center', { background: 'red-500' });
  assert.ok(out.includes('bg-cover'), `bg-cover lost: ${out}`);
});

// ---------------------------------------------------------------------------

console.log('\n=== order preservation ===');

test('editing one property leaves every other token in place', () => {
  const input = 'mt-6 text-[2.5rem] font-medium leading-[1.02] text-white sm:text-6xl md:text-7xl';
  const out = tp.mergeProps(input, { fontWeight: 'bold' });
  assert.strictEqual(
    out,
    'mt-6 text-[2.5rem] font-bold leading-[1.02] text-white sm:text-6xl md:text-7xl',
    `unexpected reordering:\n  in:  ${input}\n  out: ${out}`
  );
});

test('a new property appends rather than reshuffling', () => {
  const out = tp.mergeProps('flex items-center gap-3', { background: 'brand' });
  assert.strictEqual(out, 'flex items-center gap-3 bg-brand');
});

test('removing a property leaves a clean gap', () => {
  const out = tp.mergeProps('flex items-center gap-3 bg-brand', { background: null });
  assert.strictEqual(out, 'flex items-center gap-3');
});

test('unknown utilities are never touched', () => {
  const input = 'animate-pulse will-change-transform backdrop-blur-sm p-4';
  const out = tp.mergeProps(input, { padding: { top: '8' } });
  for (const t of ['animate-pulse', 'will-change-transform', 'backdrop-blur-sm']) {
    assert.ok(out.includes(t), `${t} lost: ${out}`);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== variants (responsive + state) ===');

test('base edit does not touch responsive or state variants', () => {
  const out = tp.mergeProps('bg-white hover:bg-black md:bg-gray-100', { background: 'brand' });
  assert.strictEqual(out, 'bg-brand hover:bg-black md:bg-gray-100');
});

test('a variant edit targets only that variant', () => {
  const out = tp.applyEdits('bg-white hover:bg-black md:bg-gray-100', [
    { prop: 'background', value: 'brand', variants: ['hover'] },
  ]);
  assert.strictEqual(out, 'bg-white hover:bg-brand md:bg-gray-100');
});

test('a new variant value is appended with canonical variant order', () => {
  const out = tp.applyEdits('p-4', [
    { prop: 'background', value: 'brand', variants: ['hover', 'md'] },
  ]);
  assert.strictEqual(out, 'p-4 md:hover:bg-brand');
});

test('variant order in the source is treated as equivalent', () => {
  const out = tp.applyEdits('md:hover:bg-black', [
    { prop: 'background', value: 'brand', variants: ['hover', 'md'] },
  ]);
  assert.strictEqual(out, 'md:hover:bg-brand');
});

test('variants are enumerated for the inspector', () => {
  const parsed = tp.parseClassName('bg-white hover:bg-black md:bg-gray-100 md:hover:underline');
  assert.deepStrictEqual(parsed.variants, ['', 'hover', 'md', 'hover:md']);
  assert.strictEqual(parsed.variantProps['hover'].background, 'black');
  assert.strictEqual(parsed.variantProps['md'].background, 'gray-100');
});

test('arbitrary variants survive untouched', () => {
  const input = '[&>svg]:size-4 supports-[display:grid]:grid p-2';
  const out = tp.mergeProps(input, { padding: { top: '4', right: '4', bottom: '4', left: '4' } });
  assert.ok(out.includes('[&>svg]:size-4'), out);
  assert.ok(out.includes('supports-[display:grid]:grid'), out);
});

// ---------------------------------------------------------------------------

console.log('\n=== spacing ===');

test('uniform padding collapses to one class', () => {
  const out = tp.mergeProps('', { padding: { top: '4', right: '4', bottom: '4', left: '4' } });
  assert.strictEqual(out, 'p-4');
});

test('axis-symmetric padding uses px/py', () => {
  const out = tp.mergeProps('', { padding: { top: '2', right: '6', bottom: '2', left: '6' } });
  assert.strictEqual(out, 'px-6 py-2');
});

test('one differing side uses the shorthand plus an override', () => {
  const out = tp.mergeProps('p-4', { padding: { top: '2' } });
  assert.strictEqual(out, 'p-4 pt-2');
});

test('editing padding keeps its position in the class list', () => {
  const out = tp.mergeProps('flex p-4 text-white', { padding: { top: '2' } });
  assert.strictEqual(out, 'flex p-4 pt-2 text-white');
});

test('px-6 py-3 edits do not duplicate padding tokens', () => {
  const out = tp.mergeProps('px-6 py-3 bg-blue-600', { padding: { left: '8' } });
  const pads = out.split(/\s+/).filter((t) => /^p[xytrbl]?-/.test(t));
  assert.ok(pads.length <= 4, `too many padding tokens: ${out}`);
  const parsed = tp.parseClassName(out).props.padding;
  assert.deepStrictEqual(parsed, { top: '3', right: '6', bottom: '3', left: '8' }, out);
});

test('negative margins round-trip', () => {
  const parsed = tp.parseClassName('-mt-4 -mx-2');
  assert.strictEqual(parsed.props.margin.top, '-4');
  assert.strictEqual(parsed.props.margin.left, '-2');
  assert.strictEqual(tp.stringifyTokens(tp.tokenize('-mt-4 -mx-2')), '-mt-4 -mx-2');
});

test('a negative margin can be written back', () => {
  const out = tp.mergeProps('', { margin: { top: '-4', right: null, bottom: null, left: null } });
  assert.strictEqual(out, '-mt-4');
});

test('removing padding drops every padding token', () => {
  const out = tp.mergeProps('flex p-4 pt-2 text-white', { padding: null });
  assert.strictEqual(out, 'flex text-white');
});

test('responsive padding is independent of base padding', () => {
  const out = tp.applyEdits('p-4', [
    { prop: 'padding', value: { top: '8', right: '8', bottom: '8', left: '8' }, variants: ['md'] },
  ]);
  assert.strictEqual(out, 'p-4 md:p-8');
  const parsed = tp.parseClassName(out);
  assert.strictEqual(parsed.variantProps['md'].padding.top, '8');
  assert.strictEqual(parsed.variantProps[''].padding.top, '4');
});

// ---------------------------------------------------------------------------

console.log('\n=== bare-value utilities ===');

test('bare rounded/border/shadow parse as empty values', () => {
  const { props } = tp.parseClassName('rounded border shadow');
  assert.strictEqual(props.borderRadius, '');
  assert.strictEqual(props.borderWidth, '');
  assert.strictEqual(props.boxShadow, '');
});

test('setting a bare value emits the bare class', () => {
  const out = tp.mergeProps('rounded-lg', { borderRadius: '' });
  assert.strictEqual(out, 'rounded');
});

test('null removes a bare class', () => {
  const out = tp.mergeProps('rounded border p-2', { borderRadius: null });
  assert.strictEqual(out, 'border p-2');
});

// ---------------------------------------------------------------------------

console.log('\n=== colour values ===');

test('opacity suffixes are preserved on colours', () => {
  const { props } = tp.parseClassName('bg-ember/40');
  assert.strictEqual(props.background, 'ember/40');
  assert.strictEqual(tp.stringifyTokens(tp.tokenize('bg-ember/40')), 'bg-ember/40');
});

test('arbitrary colour values round-trip', () => {
  const out = tp.mergeProps('bg-white', { background: '[#ff0000]' });
  assert.strictEqual(out, 'bg-[#ff0000]');
  const { props } = tp.parseClassName(out);
  assert.strictEqual(props.background, '[#ff0000]');
});

test('arbitrary font sizes are sizes, not colours', () => {
  const { props } = tp.parseClassName('text-[13px]');
  assert.strictEqual(props.fontSize, '[13px]');
  assert.strictEqual(props.textColor, undefined);
});

// ---------------------------------------------------------------------------

console.log('\n=== interpolation placeholders (template literals) ===');

test('placeholder tokens are preserved in position', () => {
  const input = '__FRAMELAB_EXPR_0__ flex p-4';
  const out = tp.mergeProps(input, { padding: { top: '8', right: '8', bottom: '8', left: '8' } });
  assert.strictEqual(out, '__FRAMELAB_EXPR_0__ flex p-8');
});

// ---------------------------------------------------------------------------

console.log('\n=== design-system drift ===');

const DRIFT_THEME = {
  colors: {
    all: [{ name: 'brand', value: '#6e56cf' }, { name: 'white', value: '#ffffff' }],
    custom: ['brand'],
  },
  spacing: { all: ['4', '7', 'gutter'], custom: ['gutter'], values: { '4': '1rem', '7': '1.75rem', gutter: '1.75rem' } },
  borderRadius: { all: ['card', 'lg'], custom: ['card'], values: { card: '14px', lg: '0.5rem' } },
  fontSize: { all: ['lg'], custom: [], values: { lg: '1.125rem' } },
};

test('a hardcoded hex that matches a token is reported', () => {
  const d = tp.findDrift('bg-[#6e56cf] p-4', DRIFT_THEME);
  assert.strictEqual(d.length, 1, JSON.stringify(d));
  assert.strictEqual(d[0].token, 'brand');
  assert.strictEqual(d[0].suggestedClass, 'bg-brand');
});

test('hex case and shorthand do not hide a match', () => {
  assert.strictEqual(tp.findDrift('bg-[#6E56CF]', DRIFT_THEME)[0].token, 'brand');
  assert.strictEqual(tp.findDrift('text-[#FFF]', DRIFT_THEME)[0].token, 'white');
});

test('rem and px are compared as the same length', () => {
  assert.strictEqual(tp.findDrift('p-[16px]', DRIFT_THEME)[0].token, '4');
  assert.strictEqual(tp.findDrift('p-[1rem]', DRIFT_THEME)[0].token, '4');
  assert.strictEqual(tp.findDrift('rounded-[14px]', DRIFT_THEME)[0].token, 'card');
  assert.strictEqual(tp.findDrift('text-[1.125rem]', DRIFT_THEME)[0].token, 'lg');
});

test('a project token beats a stock step of the same value', () => {
  // 1.75rem is both `7` and `gutter`; the named one is the better answer.
  assert.strictEqual(tp.findDrift('p-[1.75rem]', DRIFT_THEME)[0].token, 'gutter');
});

test('a genuine one-off is left alone', () => {
  assert.deepStrictEqual(tp.findDrift('bg-[#123456] p-[13px] m-[3px]', DRIFT_THEME), []);
});

test('values already using tokens report nothing', () => {
  assert.deepStrictEqual(tp.findDrift('bg-brand p-4 rounded-card', DRIFT_THEME), []);
});

test('drift is found inside variants and the prefix is kept', () => {
  const d = tp.findDrift('md:hover:bg-[#6e56cf]', DRIFT_THEME);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].suggestedClass, 'md:hover:bg-brand');
});

test('per-side spacing keeps its side when rewritten', () => {
  const d = tp.findDrift('pt-[16px]', DRIFT_THEME);
  assert.strictEqual(d[0].suggestedClass, 'pt-4');
});

test('fixing drift rewrites only the drifted tokens, in place', () => {
  const input = 'flex bg-[#6e56cf] p-[16px] shadow-none bg-[#123456]';
  const { className, fixed } = tp.applyDriftFixes(input, DRIFT_THEME);
  assert.strictEqual(className, 'flex bg-brand p-4 shadow-none bg-[#123456]');
  assert.strictEqual(fixed.length, 2);
});

test('with no theme there is nothing to compare against', () => {
  assert.deepStrictEqual(tp.findDrift('bg-[#6e56cf]', null), []);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed}/${passed + failed} parser tests passed`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.name}: ${f.err.message}`);
  process.exit(1);
}
