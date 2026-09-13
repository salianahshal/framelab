'use strict';

// Turns the custom properties collected by cssTheme into the same token shape
// themeEngine's v3 path returns, so nothing downstream has to branch on the
// Tailwind major version.
//
// The mapping is v4's namespace convention: a `--<namespace>-<key>` property in
// a @theme block is what makes the corresponding utility exist, so
// `--color-brand-500` is the token `brand-500` under colours.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const css = require('./cssTheme');

// Longest prefix first: --font-weight-* must not be read as a --font-* family.
const NAMESPACES = [
  ['--font-weight-', 'fontWeight'],
  ['--color-', 'colors'],
  ['--spacing-', 'spacing'],
  ['--radius-', 'borderRadius'],
  ['--shadow-', 'boxShadow'],
  ['--text-', 'fontSize'],
];

// The numeric spacing steps v4 generates from the `--spacing` multiplier. Named
// after the utility suffix, since that is what a drift suggestion has to print.
const SPACING_STEPS = [
  '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44', '48', '52',
  '56', '60', '64', '72', '80', '96',
];

function projectRequire(rootDir) {
  // createRequire needs an absolute path; callers may hand us a relative root.
  return Module.createRequire(path.resolve(rootDir, 'package.json'));
}

/** The installed Tailwind's major version, or null when it isn't installed. */
function installedMajor(rootDir) {
  try {
    const pkgPath = projectRequire(rootDir).resolve('tailwindcss/package.json');
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '';
    const major = Number(String(version).split('.')[0]);
    return Number.isFinite(major) ? { major, version } : null;
  } catch {
    return null;
  }
}

/**
 * Find the stylesheet that sets up Tailwind. A project can put it anywhere, so
 * the known locations are checked first and only then a shallow scan — we look
 * for the two markers that actually matter (`@import "tailwindcss"` and
 * `@theme`) rather than trusting the filename.
 */
function findCssEntry(rootDir) {
  const looksLikeEntry = (file) => {
    try {
      const body = css.stripComments(fs.readFileSync(file, 'utf8'));
      if (/@theme\b/.test(body)) return true;
      return /@import\s+(?:url\()?["']tailwindcss["']/.test(body);
    } catch {
      return false;
    }
  };

  for (const rel of css.CSS_ENTRY_CANDIDATES) {
    const full = path.resolve(rootDir, rel);
    if (fs.existsSync(full) && looksLikeEntry(full)) return full;
  }

  for (const dir of ['app', 'src/app', 'styles', 'src/styles', 'src', '.']) {
    const base = path.resolve(rootDir, dir);
    let entries;
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
      const full = path.join(base, entry.name);
      if (looksLikeEntry(full)) return full;
    }
  }
  return null;
}

/** Tailwind's own theme.css, read the same way, to tell stock from project. */
function loadDefaultTokens(rootDir) {
  let themeCss;
  try {
    themeCss = projectRequire(rootDir).resolve('tailwindcss/theme.css');
  } catch {
    return null;
  }
  const acc = css.readStylesheet(themeCss, css.emptyAcc(), 0, new Set());
  return acc.theme;
}

function splitNamespace(name) {
  for (const [prefix, category] of NAMESPACES) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
    // `--text-sm--line-height` describes the `sm` token, it is not a token.
    if (!key || key.includes('--')) return null;
    return { category, key };
  }
  return null;
}

function finalize(category, raw, vars) {
  const resolved = css.evalCalc(css.resolveVars(raw, vars));
  if (!resolved) return null;
  if (resolved.includes('var(')) return null;
  return category === 'colors' ? css.colorToHex(resolved) : resolved;
}

function spacingSort(a, b) {
  const an = parseFloat(a);
  const bn = parseFloat(b);
  const aNum = !Number.isNaN(an);
  const bNum = !Number.isNaN(bn);
  if (aNum && bNum) return an - bn;
  if (aNum) return 1;
  if (bNum) return -1;
  return String(a).localeCompare(String(b));
}

// v4 derives the whole numeric scale from one multiplier, so `p-4` exists
// without `--spacing-4` existing. Drift detection has to know those values or
// `p-[16px]` looks like a genuine one-off on every v4 project.
function derivedSpacing(spacingBase) {
  const px = toPx(spacingBase);
  if (px == null) return {};
  const unit = /rem\s*$/.test(String(spacingBase)) ? 'rem' : 'px';
  const out = { px: '1px', 0: '0px' };
  for (const step of SPACING_STEPS) {
    const value = px * parseFloat(step);
    out[step] = unit === 'rem'
      ? round(value / 16, 5) + 'rem'
      : round(value, 5) + 'px';
  }
  return out;
}

function toPx(value) {
  const m = String(value || '').trim().match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return (m[2] || 'px') === 'px' ? n : n * 16;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function partition(values, defaultKeys) {
  const dset = new Set(defaultKeys);
  const keys = Object.keys(values);
  const all = [...keys];
  const custom = [];
  const defaults = [];
  for (const k of keys) (dset.has(k) ? defaults : custom).push(k);
  return { all, custom, defaults, values };
}

/**
 * Build the token set from collected properties.
 *
 * v4's `@theme` extends Tailwind's defaults rather than replacing them, so the
 * default theme is laid down first and the project's declarations applied over
 * it — `--color-red-500: #f00` re-tints a stock colour, it doesn't invent one.
 * A value of `initial` removes a token, and the `--namespace-*: initial`
 * wildcard clears the namespace, which is how a project drops the stock palette
 * entirely. Both have to be honoured or the inspector offers utilities the
 * build no longer generates.
 */
function buildTokens(acc, defaultTheme) {
  const vars = new Map(acc.vars);
  const byCategory = {
    colors: {}, spacing: {}, fontSize: {}, borderRadius: {}, boxShadow: {}, fontWeight: {},
  };
  const stock = {
    colors: new Set(), spacing: new Set(), fontSize: new Set(),
    borderRadius: new Set(), boxShadow: new Set(), fontWeight: new Set(),
  };
  // Colour families rather than full keys: `brand-muted` is a project colour
  // because `brand` is, the same rule the v3 loader applies.
  const stockColorFamilies = new Set();

  if (defaultTheme) {
    const defaultVars = new Map(defaultTheme);
    for (const [name, raw] of defaultTheme) {
      const split = splitNamespace(name);
      if (!split) continue;
      stock[split.category].add(split.key);
      if (split.category === 'colors') stockColorFamilies.add(split.key.split('-')[0]);
      const value = finalize(split.category, raw, defaultVars);
      if (value != null && value !== 'initial') byCategory[split.category][split.key] = value;
    }
  }

  for (const [name, raw] of acc.theme) {
    // `--color-*: initial` drops every colour Tailwind ships.
    const wildcard = name.match(/^(--[a-z-]+?)-\*$/);
    if (wildcard && raw.trim() === 'initial') {
      const split = splitNamespace(wildcard[1] + '-x');
      if (split) byCategory[split.category] = {};
      continue;
    }
    const split = splitNamespace(name);
    if (!split) continue;
    if (raw.trim() === 'initial') {
      delete byCategory[split.category][split.key];
      continue;
    }
    const value = finalize(split.category, raw, vars);
    if (value == null) continue;
    byCategory[split.category][split.key] = value;
  }

  // The bare `--spacing` multiplier, project or stock.
  const spacingBase = acc.theme.has('--spacing')
    ? finalize('spacing', acc.theme.get('--spacing'), vars)
    : (defaultTheme && defaultTheme.get('--spacing')) || null;
  for (const [k, v] of Object.entries(derivedSpacing(spacingBase))) {
    if (!(k in byCategory.spacing)) byCategory.spacing[k] = v;
    stock.spacing.add(k);
  }

  const colorList = Object.entries(byCategory.colors).map(([name, value]) => ({ name, value }));
  const isStockColor = (c) => stockColorFamilies.has(c.name.split('-')[0]);

  const orderedSpacing = {};
  for (const k of Object.keys(byCategory.spacing).sort(spacingSort)) {
    orderedSpacing[k] = byCategory.spacing[k];
  }

  return {
    colors: {
      all: colorList,
      custom: colorList.filter((c) => !isStockColor(c)),
      defaults: colorList.filter(isStockColor),
    },
    spacing: partition(orderedSpacing, stock.spacing),
    fontSize: partition(byCategory.fontSize, stock.fontSize),
    borderRadius: partition(byCategory.borderRadius, stock.borderRadius),
    boxShadow: partition(byCategory.boxShadow, stock.boxShadow),
    fontWeight: partition(byCategory.fontWeight, stock.fontWeight),
  };
}

/**
 * Read a v4 project's theme. Returns the same envelope as the v3 loader, with
 * `configFile` pointing at the stylesheet that plays the config's role.
 */
function loadThemeV4(rootDir) {
  const entry = findCssEntry(rootDir);
  if (!entry) {
    return { found: false, configFile: null, tokens: null, reason: 'no-css-entry' };
  }
  const seen = new Set();
  try {
    const acc = css.readStylesheet(entry, css.emptyAcc(), 0, seen);
    // The files that actually contributed, so the watcher knows which edits
    // invalidate the theme — v4's "config" can be split across @imports.
    const sources = [...seen];
    if (!acc.theme.size) {
      // A stylesheet that imports Tailwind but declares no @theme block is a
      // project running entirely on stock tokens — not an error.
      return {
        found: true, configFile: entry, sources,
        tokens: buildTokens(acc, loadDefaultTokens(rootDir)),
        tailwind: 4, reason: 'no-theme-block',
      };
    }
    return {
      found: true,
      configFile: entry,
      sources,
      tokens: buildTokens(acc, loadDefaultTokens(rootDir)),
      tailwind: 4,
    };
  } catch (err) {
    return {
      found: true, configFile: entry, sources: [...seen], tokens: null,
      tailwind: 4, reason: 'css-parse-error', error: err.message,
    };
  }
}

module.exports = {
  loadThemeV4,
  findCssEntry,
  buildTokens,
  installedMajor,
  loadDefaultTokens,
  splitNamespace,
  derivedSpacing,
  NAMESPACES,
};
