'use strict';

// Tailwind v4 theme reader.
//
// v4 deleted tailwind.config.js: the design system now lives in CSS as custom
// properties inside `@theme` blocks, and the utility name is the property name
// minus its namespace — `--color-brand-500` is what makes `bg-brand-500` exist.
//
// This module reads those blocks and produces exactly the token shape
// themeEngine's v3 path produces, so the inspector, class validation and drift
// detection work against a v4 project without knowing which major it is.
//
// Two v4 details make this more than a regex over `--name: value`:
//
//   * `@theme inline` (what shadcn/ui generates) defines tokens as references:
//     `--color-background: var(--background)`, with the real value in `:root`
//     and an override in `.dark`. Reading the @theme block alone yields the
//     string "var(--background)", which is useless as a swatch and can never
//     match a hardcoded hex. So we collect ordinary rules too and resolve.
//
//   * Values are oklch(), and often calc() over another var. Drift detection
//     compares against hex and pixels, so both are reduced at load time —
//     downstream code keeps comparing plain values and never learns about
//     colour spaces.

const fs = require('fs');
const path = require('path');

// Where a Next.js project's Tailwind entry stylesheet usually lives. Checked in
// order; the first file that imports Tailwind or declares a @theme block wins.
const CSS_ENTRY_CANDIDATES = [
  'app/globals.css',
  'src/app/globals.css',
  'styles/globals.css',
  'src/styles/globals.css',
  'app/global.css',
  'src/app/global.css',
  'styles/tailwind.css',
  'src/styles/tailwind.css',
  'app/index.css',
  'src/index.css',
  'src/app.css',
  'css/globals.css',
];

const MAX_IMPORT_DEPTH = 4;

// ---------------------------------------------------------------------------
// CSS scanning
// ---------------------------------------------------------------------------

function stripComments(css) {
  // Preserve length-neutral behaviour isn't needed; we only read declarations.
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Find the matching `}` for the `{` at openIndex, counting nesting. Returns -1
// when the block is unterminated, which we treat as "ignore this block" rather
// than guessing where the author meant it to end.
function matchBrace(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split a declaration body into `--name` -> raw value. Values may span lines
// (v4's own --font-sans does) and may contain braces-free function calls with
// commas, so we split on top-level semicolons only.
function parseDeclarations(body) {
  const out = new Map();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const decl = buf.trim();
    buf = '';
    if (!decl.startsWith('--')) return;
    const colon = decl.indexOf(':');
    if (colon === -1) return;
    const name = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (name.length > 2 && value) out.set(name, value);
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { flush(); continue; }
    buf += ch;
  }
  flush();
  return out;
}

/**
 * Walk a stylesheet collecting the two things that matter: declarations inside
 * `@theme` blocks (the tokens themselves) and declarations inside ordinary
 * rules (the scope `@theme inline` references resolve against).
 *
 * `.dark` is collected separately — a dark override must not silently become
 * the value we show as the token's colour.
 */
function scanCss(css, acc) {
  const src = stripComments(css);
  const atTheme = /@theme\b([^{]*)\{/g;
  const themeRanges = [];
  let m;
  while ((m = atTheme.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(src, open);
    if (close === -1) continue;
    const body = src.slice(open + 1, close);
    for (const [name, value] of parseDeclarations(body)) {
      acc.theme.set(name, value);
      // A @theme declaration is also in scope for later var() lookups.
      if (!acc.vars.has(name)) acc.vars.set(name, value);
    }
    themeRanges.push([m.index, close]);
    atTheme.lastIndex = close;
  }

  // Ordinary rules: `:root { --x: … }`, `.dark { --x: … }`. We don't need a
  // real selector parser — everything up to `{` since the previous `}` is the
  // selector, and we only care whether it mentions a dark scope.
  const ruleRe = /([^{}@;]+)\{/g;
  while ((m = ruleRe.exec(src))) {
    const open = m.index + m[0].length - 1;
    if (themeRanges.some(([s, e]) => m.index >= s && m.index <= e)) continue;
    const close = matchBrace(src, open);
    if (close === -1) continue;
    const selector = m[1].trim();
    const decls = parseDeclarations(src.slice(open + 1, close));
    if (decls.size) {
      const dark = /(^|[\s,])(\.dark|\[data-theme=['"]?dark)/.test(selector);
      for (const [name, value] of decls) {
        if (dark) acc.darkVars.set(name, value);
        else if (!acc.vars.has(name)) acc.vars.set(name, value);
      }
    }
    ruleRe.lastIndex = close;
  }

  return acc;
}

// Follow relative `@import "./x.css"` so a split design system still resolves.
// Bare specifiers (`tailwindcss`, `tw-animate-css`) are package imports; the
// Tailwind defaults are loaded separately from node_modules, and other packages
// don't define this project's tokens.
function collectImports(css, fromFile) {
  const out = [];
  const re = /@import\s+(?:url\()?["']([^"')]+)["']\)?[^;]*;/g;
  let m;
  while ((m = re.exec(stripComments(css)))) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const resolved = path.resolve(path.dirname(fromFile), spec);
    out.push(resolved.endsWith('.css') ? resolved : resolved + '.css');
  }
  return out;
}

function readStylesheet(file, acc, depth, seen) {
  if (depth > MAX_IMPORT_DEPTH) return acc;
  const real = path.resolve(file);
  if (seen.has(real) || !fs.existsSync(real)) return acc;
  seen.add(real);
  let css;
  try { css = fs.readFileSync(real, 'utf8'); } catch { return acc; }
  scanCss(css, acc);
  for (const next of collectImports(css, real)) {
    readStylesheet(next, acc, depth + 1, seen);
  }
  return acc;
}

function emptyAcc() {
  return { theme: new Map(), vars: new Map(), darkVars: new Map() };
}

// ---------------------------------------------------------------------------
// Value resolution: var() -> literal, calc() -> number, oklch() -> hex
// ---------------------------------------------------------------------------

// Expand var(--x) / var(--x, fallback) against the collected scope. Cyclic
// references resolve to the fallback (or are left alone) rather than hanging.
function resolveVars(value, vars, seen) {
  if (typeof value !== 'string' || !value.includes('var(')) return value;
  const stack = seen || new Set();
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at === -1) { out += value.slice(i); break; }
    out += value.slice(i, at);
    const close = matchParen(value, at + 3);
    if (close === -1) { out += value.slice(at); break; }
    const inner = value.slice(at + 4, close);
    const comma = topLevelComma(inner);
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    let replacement;
    if (stack.has(name)) {
      replacement = fallback;
    } else if (vars.has(name)) {
      stack.add(name);
      replacement = resolveVars(vars.get(name), vars, stack);
      stack.delete(name);
      // A reference that bottoms out in nothing (a cycle, or a chain ending in
      // an undefined variable) is what this var()'s own fallback is for.
      if (!replacement) replacement = fallback;
    } else {
      replacement = fallback;
    }
    out += replacement;
    i = close + 1;
  }
  return out.trim();
}

function matchParen(str, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function topLevelComma(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

const PX_PER_REM = 16;

// shadcn's radius scale is `calc(var(--radius) - 4px)` all the way down, so a
// v4 project has no literal radius values at all unless we evaluate this.
// Deliberately narrow: + - * / over lengths in one unit family, no nesting
// beyond parentheses, and any surprise gives up and returns the input.
function evalCalc(value) {
  if (typeof value !== 'string' || !value.includes('calc(')) return value;
  const at = value.indexOf('calc(');
  const close = matchParen(value, at + 4);
  if (close === -1) return value;
  const inner = evalCalc(value.slice(at + 5, close));
  const result = evalExpression(inner);
  if (result == null) return value;
  const rest = value.slice(0, at) + result + value.slice(close + 1);
  return evalCalc(rest);
}

// Reduce "0.625rem - 4px" to "0.375rem". Everything is converted to px, then
// rendered back in the unit the first operand used so values stay recognisable.
function evalExpression(expr) {
  const tokens = String(expr).trim().match(/(\d*\.?\d+[a-z%]*|[-+*/]|\(|\))/gi);
  if (!tokens) return null;
  let unit = null;
  const rpn = [];
  const ops = [];
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const tok of tokens) {
    if (/^\d/.test(tok)) {
      const m = tok.match(/^(\d*\.?\d+)([a-z%]*)$/i);
      if (!m) return null;
      const u = m[2].toLowerCase();
      if (u && u !== 'px' && u !== 'rem') return null;
      if (u && !unit) unit = u;
      rpn.push(u === 'rem' ? parseFloat(m[1]) * PX_PER_REM : parseFloat(m[1]));
    } else if (tok === '(') {
      ops.push(tok);
    } else if (tok === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') rpn.push(ops.pop());
      if (!ops.length) return null;
      ops.pop();
    } else {
      while (ops.length && prec[ops[ops.length - 1]] >= prec[tok]) rpn.push(ops.pop());
      ops.push(tok);
    }
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') return null;
    rpn.push(op);
  }

  const stack = [];
  for (const tok of rpn) {
    if (typeof tok === 'number') { stack.push(tok); continue; }
    const b = stack.pop();
    const a = stack.pop();
    if (a == null || b == null) return null;
    if (tok === '+') stack.push(a + b);
    else if (tok === '-') stack.push(a - b);
    else if (tok === '*') stack.push(a * b);
    else if (tok === '/') { if (!b) return null; stack.push(a / b); }
    else return null;
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  const px = stack[0];
  const n = unit === 'rem' ? px / PX_PER_REM : px;
  return round(n, 5) + (unit || 'px');
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// --- colour ----------------------------------------------------------------

function toHex(n) {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}

function gammaEncode(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// oklch -> sRGB hex. v4 ships its entire default palette in oklch and shadcn
// writes project colours the same way, so without this every colour in a v4
// project is an opaque string: no swatch, and no drift match against a hex.
function oklchToHex(l, c, h) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;

  return '#' + [r, g, bl].map((x) => toHex(gammaEncode(x) * 255)).join('');
}

function hslToHex(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => toHex(x * 255)).join('');
}

function num(token, scale) {
  if (token == null) return null;
  const t = String(token).trim();
  if (t.endsWith('%')) {
    const n = parseFloat(t);
    return Number.isNaN(n) ? null : (n / 100) * (scale == null ? 1 : scale);
  }
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

// Split "0.145 0 0 / 50%" into its components, dropping the alpha: framelab
// compares and renders 6-digit hex, and Tailwind's own opacity modifier
// (`bg-brand/40`) is the supported way to express alpha.
function colorArgs(inner) {
  const slash = inner.indexOf('/');
  const head = slash === -1 ? inner : inner.slice(0, slash);
  return head.trim().split(/[\s,]+/).filter(Boolean);
}

/** Reduce any CSS colour we can recognise to `#rrggbb`; otherwise pass through. */
function colorToHex(value) {
  if (typeof value !== 'string') return value;
  const v = value.trim();

  const ok = v.match(/^oklch\(([^)]*)\)$/i);
  if (ok) {
    const parts = colorArgs(ok[1]);
    if (parts.length < 3) return v;
    const l = num(parts[0], 1);
    const c = num(parts[1]);
    const h = num(parts[2]) || 0;
    if (l == null || c == null) return v;
    return oklchToHex(l, c, h);
  }

  const hsl = v.match(/^hsla?\(([^)]*)\)$/i);
  if (hsl) {
    const parts = colorArgs(hsl[1]);
    if (parts.length < 3) return v;
    // hslToHex wants saturation and lightness on 0-100, which is what the
    // percentages already read as — scale them back up after num() normalises.
    const h = num(parts[0]);
    const s = num(parts[1], 100);
    const l = num(parts[2], 100);
    if (h == null || s == null || l == null) return v;
    return hslToHex(h, s, l);
  }

  // Bare "0 0% 100%" triplets are the pre-v4 shadcn convention, still common in
  // projects that migrated their config but not their variables.
  const bare = v.match(/^(-?\d*\.?\d+)\s+(-?\d*\.?\d+)%\s+(-?\d*\.?\d+)%$/);
  if (bare) return hslToHex(parseFloat(bare[1]), parseFloat(bare[2]), parseFloat(bare[3]));

  return v;
}

module.exports = {
  CSS_ENTRY_CANDIDATES,
  scanCss,
  readStylesheet,
  emptyAcc,
  parseDeclarations,
  collectImports,
  resolveVars,
  evalCalc,
  colorToHex,
  oklchToHex,
  hslToHex,
  stripComments,
};
