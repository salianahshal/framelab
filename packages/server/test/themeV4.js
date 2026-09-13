'use strict';

// Tailwind v4 theme reading: the @theme CSS blocks that replaced
// tailwind.config.js, read into the same token shape the v3 path produces.

const path = require('path');
const assert = require('assert');

const css = require('../src/cssTheme');
const themeV4 = require('../src/themeV4');
const themeEngine = require('../src/themeEngine');
const tailwindParser = require('../src/tailwindParser');

const FIXTURE = path.join(__dirname, 'fixtures', 'v4-app');

function divider(label) {
  console.log(`\n=== ${label} ===`);
}

function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  console.log(`  ok  ${label} = ${JSON.stringify(actual)}`);
}

async function main() {
  divider('colour conversion');
  // v4 ships its whole palette in oklch; these are the published hex values.
  check('oklch red-500', css.colorToHex('oklch(63.7% 0.237 25.331)'), '#fb2c36');
  check('oklch white', css.colorToHex('oklch(1 0 0)'), '#ffffff');
  check('oklch near-black', css.colorToHex('oklch(0.145 0 0)'), '#0a0a0a');
  check('alpha dropped', css.colorToHex('oklch(1 0 0 / 50%)'), '#ffffff');
  check('hsl()', css.colorToHex('hsl(210 40% 96%)'), '#f1f5f9');
  check('bare hsl triplet', css.colorToHex('210 40% 96%'), '#f1f5f9');
  check('hex passthrough', css.colorToHex('#6e56cf'), '#6e56cf');
  check('unknown passthrough', css.colorToHex('color-mix(in srgb, red, blue)'),
    'color-mix(in srgb, red, blue)');

  divider('calc() reduction');
  // shadcn defines its entire radius scale as calc() over one variable.
  check('minus px', css.evalCalc('calc(0.625rem - 4px)'), '0.375rem');
  check('plus px', css.evalCalc('calc(0.625rem + 4px)'), '0.875rem');
  check('multiply', css.evalCalc('calc(0.25rem * 6)'), '1.5rem');
  check('nested', css.evalCalc('calc(calc(1rem + 1rem) / 2)'), '1rem');
  check('gives up on unknown units', css.evalCalc('calc(100% - 2ch)'), 'calc(100% - 2ch)');

  divider('var() resolution');
  const vars = new Map([['--a', 'var(--b)'], ['--b', '1rem'], ['--loop', 'var(--loop)']]);
  check('chain', css.resolveVars('var(--a)', vars), '1rem');
  check('fallback used', css.resolveVars('var(--missing, 2rem)', vars), '2rem');
  check('cycle does not hang', css.resolveVars('var(--loop, 0)', vars), '0');

  divider('declaration parsing');
  // v4's own --font-sans spans several lines and contains commas.
  const decls = css.parseDeclarations(`
    --font-sans:
      ui-sans-serif, system-ui,
      sans-serif;
    --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  `);
  check('multi-line value joined', /ui-sans-serif, system-ui/.test(decls.get('--font-sans')), true);
  check('commas inside functions survive',
    decls.get('--shadow-sm'), '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)');

  divider('namespace mapping');
  check('colour', themeV4.splitNamespace('--color-brand-500'), { category: 'colors', key: 'brand-500' });
  check('radius', themeV4.splitNamespace('--radius-card'), { category: 'borderRadius', key: 'card' });
  check('weight beats family', themeV4.splitNamespace('--font-weight-bold'),
    { category: 'fontWeight', key: 'bold' });
  // `--text-sm--line-height` describes the `sm` token; it is not a token itself.
  check('sub-key ignored', themeV4.splitNamespace('--text-sm--line-height'), null);
  check('non-theme property ignored', themeV4.splitNamespace('--my-var'), null);

  divider('load the v4 fixture');
  const result = await themeEngine.loadTheme(FIXTURE);
  check('detected as v4', result.tailwind, 4);
  check('entry stylesheet', path.basename(result.configFile), 'globals.css');
  check('followed the @import', result.sources.map((s) => path.basename(s)).sort(),
    ['brand.css', 'globals.css']);

  const t = result.tokens;
  const color = (name) => (t.colors.all.find((c) => c.name === name) || {}).value;

  divider('project tokens');
  // `@theme inline` points at :root, so the token is only useful once resolved.
  check('inline token resolved through :root', color('background'), '#ffffff');
  check('inline token, oklch', color('foreground'), '#0a0a0a');
  check('inline token, plain hex', color('card'), '#6e56cf');
  check('token from an imported sheet', color('brand'), '#6e56cf');
  check('legacy hsl triplet', color('legacy'), '#f1f5f9');
  check('project colours listed as custom',
    t.colors.custom.map((c) => c.name).sort(),
    ['background', 'brand', 'brand-muted', 'card', 'foreground', 'legacy']);

  check('calc() radius resolved', t.borderRadius.values.sm, '0.375rem');
  check('project radius', t.borderRadius.values.card, '0.625rem');
  check('radius custom keys', t.borderRadius.custom, ['card']);
  check('project spacing', t.spacing.values.gutter, '1.75rem');
  check('project font size', t.fontSize.values.hero, '3.5rem');
  check('project shadow named', t.boxShadow.custom, ['card']);
  check('project weight', t.fontWeight.values.chonk, '850');

  divider('stock tokens are still there');
  // v4's @theme extends the defaults rather than replacing them.
  check('stock colour survives', color('red-500'), '#fb2c36');
  check('stock palette present', t.colors.defaults.length > 200, true);
  check('stock radius survives', t.borderRadius.values.xl, '0.75rem');
  // The numeric scale is generated from the --spacing multiplier, so these
  // values exist without any --spacing-4 declaration to read.
  check('derived spacing 4', t.spacing.values['4'], '1rem');
  check('derived spacing 7', t.spacing.values['7'], '1.75rem');
  check('derived spacing px', t.spacing.values.px, '1px');

  divider('a custom --spacing multiplier rescales the derived steps');
  const scaled = themeV4.derivedSpacing('0.5rem');
  check('4 doubles', scaled['4'], '2rem');
  check('1 doubles', scaled['1'], '0.5rem');

  divider('v4 removal idioms');
  // `--color-*: initial` is how a project drops Tailwind's palette entirely,
  // and `--radius-md: initial` drops one token. Both have to reach the
  // inspector or it offers utilities the build no longer generates.
  const defaults = themeV4.loadDefaultTokens(FIXTURE);
  const cleared = themeV4.buildTokens({
    theme: new Map([
      ['--color-*', 'initial'],
      ['--color-brand', '#6e56cf'],
      ['--radius-md', 'initial'],
    ]),
    vars: new Map(),
    darkVars: new Map(),
  }, defaults);
  check('wildcard clears the stock palette', cleared.colors.all.map((c) => c.name), ['brand']);
  check('one token removed', 'md' in cleared.borderRadius.values, false);
  check('its siblings survive', cleared.borderRadius.values.lg, '0.5rem');

  divider('class parsing uses the v4 tokens');
  const parsed = tailwindParser.parseClassName(
    'rounded-card shadow-card text-hero p-gutter font-chonk bg-brand text-foreground',
    { theme: t }
  );
  check('nothing unrecognised', parsed.unknown, []);
  check('shadow-card is a box shadow, not a colour', parsed.props.boxShadow, 'card');
  check('text-hero is a size', parsed.props.fontSize, 'hero');
  check('text-foreground is a colour', parsed.props.textColor, 'foreground');
  check('font-chonk is a weight', parsed.props.fontWeight, 'chonk');
  check('rounded-card', parsed.props.borderRadius, 'card');
  check('p-gutter', parsed.props.padding.top, 'gutter');

  divider('drift detection against a v4 design system');
  const drifted = 'bg-[#6e56cf] p-[1.75rem] rounded-[0.625rem] text-[3.5rem] md:gap-[16px]';
  const drift = tailwindParser.findDrift(drifted, t);
  for (const d of drift) console.log(`  ${d.message}`);
  check('every drifted value found', drift.length, 5);
  check('suggestions', drift.map((d) => d.suggestedClass),
    ['bg-card', 'p-gutter', 'rounded-card', 'text-hero', 'md:gap-4']);
  const fixed = tailwindParser.applyDriftFixes(drifted, t);
  check('fix rewrites in place', fixed.className,
    'bg-card p-gutter rounded-card text-hero md:gap-4');

  divider('arbitrary oklch is matched too');
  // The shape people actually write on v4, underscores and all.
  const okDrift = tailwindParser.findDrift('text-[oklch(0.145_0_0)] bg-[oklch(1_0_0)]', t);
  check('oklch arbitrary values recognised', okDrift.map((d) => d.suggestedClass),
    ['text-foreground', 'bg-background']);

  divider('a genuine one-off is left alone');
  const oneOff = tailwindParser.findDrift('bg-[#123456] p-[13px]', t);
  check('no false positives', oneOff.length, 0);

  divider('v3 projects are unaffected');
  const v3 = await themeEngine.loadTheme(path.join(__dirname, '..', '..', '..', 'examples', 'test-next-app'));
  check('still read as v3', v3.tailwind, 3);
  check('v3 config file', path.basename(v3.configFile || ''), 'tailwind.config.js');

  console.log('\nall themeV4 checks passed');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
