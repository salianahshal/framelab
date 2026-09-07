'use strict';

// Tailwind class-string model.
//
// The central invariant: a className is an ORDERED LIST OF TOKENS, and an edit
// replaces/removes/appends only the tokens belonging to the property being
// edited. Every other token — including ones we don't understand — is re-emitted
// byte-for-byte in its original position.
//
//   parse(s) -> tokens ;  stringify(tokens) === s   (for any s, always)
//
// That guarantee is what makes "surgical source editing" true at the class
// level, not just the file level. The previous implementation parsed into a
// flat property bag and re-serialised in canonical order, which reordered every
// class on every edit and silently dropped anything it failed to classify
// (`text-center`, `border-dashed`, `border-t`, custom theme keys …).
//
// Tokens carry their variants (`md:`, `hover:`, `dark:`, `group-hover:`,
// `[&>svg]:`) so responsive and state styles are first-class editable values
// rather than opaque strings.
//
// Opaque placeholders: a token may be a pinned, uneditable chunk (used for
// `${...}` interpolations inside template-literal classNames). They occupy a
// position in the list and are re-emitted verbatim, so editing the static
// classes around them never reorders or disturbs them.

// ---------------------------------------------------------------------------
// Known value sets
// ---------------------------------------------------------------------------

const DEFAULT_FONT_SIZES = [
  'xs', 'sm', 'base', 'lg', 'xl',
  '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
];
const FONT_WEIGHTS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium',
  'semibold', 'bold', 'extrabold', 'black',
]);
const DEFAULT_RADIUS = ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];
const DEFAULT_SHADOWS = ['DEFAULT', 'sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none'];

const DISPLAYS = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex',
  'grid', 'inline-grid', 'hidden', 'contents', 'flow-root',
  'table', 'inline-table', 'list-item',
]);
const POSITIONS = new Set(['static', 'fixed', 'absolute', 'relative', 'sticky']);
const FLEX_DIRECTIONS = new Set(['row', 'row-reverse', 'col', 'col-reverse']);
const FLEX_WRAPS = new Set(['wrap', 'wrap-reverse', 'nowrap']);
// `flex-1` / `flex-auto` / `flex-none` / `flex-initial` are the flex shorthand,
// NOT a direction. Keeping them apart stops a direction edit eating them.
const FLEX_SHORTHAND = new Set(['1', 'auto', 'initial', 'none']);

const ITEMS = new Set(['start', 'end', 'center', 'baseline', 'stretch']);
const JUSTIFY = new Set([
  'normal', 'start', 'end', 'center', 'between', 'around', 'evenly', 'stretch',
]);
const SELF = new Set(['auto', 'start', 'end', 'center', 'stretch', 'baseline']);

const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);
const TEXT_OVERFLOWS = new Set(['ellipsis', 'clip']);
const TEXT_WRAPS = new Set(['wrap', 'nowrap', 'balance', 'pretty']);
const TEXT_TRANSFORMS = new Set(['uppercase', 'lowercase', 'capitalize', 'normal-case']);
const FONT_STYLES = new Set(['italic', 'not-italic']);
const TEXT_DECORATIONS = new Set(['underline', 'overline', 'line-through', 'no-underline']);

const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);
const BORDER_SIDES = new Set(['t', 'r', 'b', 'l', 'x', 'y', 's', 'e']);
const RADIUS_CORNERS = new Set([
  't', 'r', 'b', 'l', 'tl', 'tr', 'br', 'bl', 's', 'e', 'ss', 'se', 'es', 'ee',
]);

const OVERFLOWS = new Set(['auto', 'hidden', 'clip', 'visible', 'scroll']);

const PADDING_SIDES = { p: 'all', px: 'x', py: 'y', pt: 'top', pr: 'right', pb: 'bottom', pl: 'left' };
const MARGIN_SIDES = { m: 'all', mx: 'x', my: 'y', mt: 'top', mr: 'right', mb: 'bottom', ml: 'left' };

// Sizing utilities, longest prefix first so `min-w-` wins over `w-`.
const SIZE_PREFIXES = [
  ['min-w', 'minWidth'], ['min-h', 'minHeight'],
  ['max-w', 'maxWidth'], ['max-h', 'maxHeight'],
  ['w', 'width'], ['h', 'height'], ['size', 'size'],
];

const INSET_PREFIXES = [
  ['inset-x', 'insetX'], ['inset-y', 'insetY'], ['inset', 'inset'],
  ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'],
];

const ARBITRARY_LENGTH = /^\[-?\d*\.?\d+(px|rem|em|%|vh|vw|vmin|vmax|pt|ch|ex|cm|mm|in|fr)\]$/i;
const NUMERIC = /^-?\d*\.?\d+$/;

function isArbitrary(v) {
  return typeof v === 'string' && v.startsWith('[') && v.endsWith(']');
}
function isHexColor(s) {
  return /^#[0-9a-fA-F]{3,8}$/.test(s);
}
// A colour token may carry an opacity suffix: `bg-brand/40`, `text-white/70`.
function stripOpacitySuffix(v) {
  if (!v) return { value: v, alpha: null };
  // Don't split inside an arbitrary value — `bg-[url(a/b)]` has slashes.
  if (isArbitrary(v)) return { value: v, alpha: null };
  const i = v.lastIndexOf('/');
  if (i <= 0) return { value: v, alpha: null };
  return { value: v.slice(0, i), alpha: v.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Theme-aware key sets
// ---------------------------------------------------------------------------

// The project's own tailwind.config keys make classification exact: without
// them `rounded-card` and `shadow-card` look like nonsense and get mangled.
function buildKeySets(theme) {
  const t = theme || {};
  const keys = (category, fallback) => {
    const v = t[category];
    const list = Array.isArray(v) ? v : (v && v.all) || null;
    const out = new Set(fallback);
    if (list) for (const k of list) out.add(k === 'DEFAULT' ? '' : k);
    return out;
  };
  return {
    fontSize: keys('fontSize', DEFAULT_FONT_SIZES),
    borderRadius: keys('borderRadius', DEFAULT_RADIUS.map((k) => (k === 'DEFAULT' ? '' : k))),
    boxShadow: keys('boxShadow', DEFAULT_SHADOWS.map((k) => (k === 'DEFAULT' ? '' : k))),
    fontWeight: keys('fontWeight', [...FONT_WEIGHTS]),
    fontFamily: t.fontFamily
      ? keys('fontFamily', ['sans', 'serif', 'mono'])
      : new Set(['sans', 'serif', 'mono']),
  };
}
const DEFAULT_KEYS = buildKeySets(null);

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

// Split "md:hover:bg-brand/40" into variants + base, honouring brackets so
// arbitrary values and arbitrary variants (`[&>svg]:`, `bg-[url(a:b)]`) survive.
function splitVariants(raw) {
  const variants = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) {
      variants.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  return { variants, base: raw.slice(start) };
}

function variantKey(variants) {
  return [...variants].sort().join(':');
}

// Canonical order when we WRITE a new variant token: breakpoint first, then
// state. Matches what people type by hand ("md:hover:bg-x").
const BREAKPOINT_ORDER = ['sm', 'md', 'lg', 'xl', '2xl'];
function orderVariants(variants) {
  const bp = [];
  const rest = [];
  for (const v of variants) (BREAKPOINT_ORDER.includes(v) ? bp : rest).push(v);
  bp.sort((a, b) => BREAKPOINT_ORDER.indexOf(a) - BREAKPOINT_ORDER.indexOf(b));
  return [...bp, ...rest];
}

function classifyBase(base, keys) {
  const K = keys || DEFAULT_KEYS;
  const unknown = { prop: null, value: null };

  // Standalone keywords -------------------------------------------------
  if (DISPLAYS.has(base)) return { prop: 'display', value: base };
  if (POSITIONS.has(base)) return { prop: 'position', value: base };
  if (TEXT_TRANSFORMS.has(base)) return { prop: 'textTransform', value: base };
  if (FONT_STYLES.has(base)) return { prop: 'fontStyle', value: base };
  if (TEXT_DECORATIONS.has(base)) return { prop: 'textDecoration', value: base };
  if (base === 'truncate') return { prop: 'truncate', value: base };
  if (base === 'border') return { prop: 'borderWidth', value: '', side: 'all' };
  if (base === 'rounded') return { prop: 'borderRadius', value: '', side: 'all' };
  if (base === 'shadow') return { prop: 'boxShadow', value: '' };
  if (base === 'italic') return { prop: 'fontStyle', value: 'italic' };

  const dash = base.indexOf('-');
  const head = dash < 0 ? base : base.slice(0, dash);
  const tail = dash < 0 ? '' : base.slice(dash + 1);

  // Spacing --------------------------------------------------------------
  // Negative margins are written `-mt-4`; the sign lives on the utility.
  let negative = false;
  let sBase = base;
  if (base.startsWith('-')) {
    negative = true;
    sBase = base.slice(1);
  }
  const sDash = sBase.indexOf('-');
  const sHead = sDash < 0 ? sBase : sBase.slice(0, sDash);
  const sTail = sDash < 0 ? '' : sBase.slice(sDash + 1);

  if (Object.prototype.hasOwnProperty.call(PADDING_SIDES, sHead) && (sDash > 0 || !negative)) {
    if (sDash < 0) {
      if (negative) return unknown;
      return { prop: 'padding', side: PADDING_SIDES[sHead], value: '' };
    }
    return { prop: 'padding', side: PADDING_SIDES[sHead], value: (negative ? '-' : '') + sTail };
  }
  if (Object.prototype.hasOwnProperty.call(MARGIN_SIDES, sHead)) {
    if (sDash < 0) {
      if (negative) return unknown;
      return { prop: 'margin', side: MARGIN_SIDES[sHead], value: '' };
    }
    return { prop: 'margin', side: MARGIN_SIDES[sHead], value: (negative ? '-' : '') + sTail };
  }

  // text-* is the most overloaded prefix in Tailwind. Order matters.
  if (head === 'text') {
    if (TEXT_ALIGNS.has(tail)) return { prop: 'textAlign', value: tail };
    if (TEXT_OVERFLOWS.has(tail)) return { prop: 'textOverflow', value: tail };
    if (TEXT_WRAPS.has(tail)) return { prop: 'textWrap', value: tail };
    if (K.fontSize.has(tail)) return { prop: 'fontSize', value: tail };
    if (ARBITRARY_LENGTH.test(tail)) return { prop: 'fontSize', value: tail };
    return { prop: 'textColor', value: tail };
  }

  if (head === 'font') {
    if (K.fontWeight.has(tail) || FONT_WEIGHTS.has(tail)) return { prop: 'fontWeight', value: tail };
    if (NUMERIC.test(tail) || isArbitrary(tail)) return { prop: 'fontWeight', value: tail };
    return { prop: 'fontFamily', value: tail };
  }

  if (head === 'bg') {
    // bg-cover / bg-center / bg-no-repeat are not colours.
    if (['cover', 'contain', 'auto'].includes(tail)) return { prop: 'bgSize', value: tail };
    if (['no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'repeat-round', 'repeat-space'].includes(tail)) {
      return { prop: 'bgRepeat', value: tail };
    }
    if (['fixed', 'local', 'scroll'].includes(tail)) return { prop: 'bgAttachment', value: tail };
    if (tail.startsWith('gradient-')) return { prop: 'bgImage', value: tail };
    return { prop: 'background', value: tail };
  }

  if (head === 'border') {
    if (BORDER_STYLES.has(tail)) return { prop: 'borderStyle', value: tail };
    if (tail === 'collapse' || tail === 'separate') return { prop: 'borderCollapse', value: tail };
    if (NUMERIC.test(tail) || ARBITRARY_LENGTH.test(tail)) {
      return { prop: 'borderWidth', side: 'all', value: tail };
    }
    // border-t / border-t-2 / border-x-4
    const sideDash = tail.indexOf('-');
    const maybeSide = sideDash < 0 ? tail : tail.slice(0, sideDash);
    if (BORDER_SIDES.has(maybeSide)) {
      const rest = sideDash < 0 ? '' : tail.slice(sideDash + 1);
      if (rest === '' || NUMERIC.test(rest) || ARBITRARY_LENGTH.test(rest)) {
        return { prop: 'borderWidth', side: maybeSide, value: rest };
      }
      return { prop: 'borderColor', side: maybeSide, value: rest };
    }
    return { prop: 'borderColor', side: 'all', value: tail };
  }

  if (head === 'rounded') {
    const cornerDash = tail.indexOf('-');
    const maybeCorner = cornerDash < 0 ? tail : tail.slice(0, cornerDash);
    if (RADIUS_CORNERS.has(maybeCorner)) {
      const rest = cornerDash < 0 ? '' : tail.slice(cornerDash + 1);
      if (rest === '' || K.borderRadius.has(rest) || isArbitrary(rest)) {
        return { prop: 'borderRadius', side: maybeCorner, value: rest };
      }
    }
    if (K.borderRadius.has(tail) || isArbitrary(tail)) {
      return { prop: 'borderRadius', side: 'all', value: tail };
    }
    // Unrecognised radius key (project token we weren't told about): still a
    // radius — classifying it keeps a radius edit from duplicating it.
    return { prop: 'borderRadius', side: 'all', value: tail };
  }

  if (head === 'shadow') {
    if (K.boxShadow.has(tail) || isArbitrary(tail)) return { prop: 'boxShadow', value: tail };
    if (['inner', 'none'].includes(tail)) return { prop: 'boxShadow', value: tail };
    // Tailwind 3.3+ shadow colours: `shadow-brand/30`.
    return { prop: 'shadowColor', value: tail };
  }

  if (head === 'opacity') return { prop: 'opacity', value: tail };
  if (head === 'z') return { prop: 'zIndex', value: tail };
  if (head === 'leading') return { prop: 'lineHeight', value: tail };
  if (head === 'tracking') return { prop: 'letterSpacing', value: tail };
  if (head === 'cursor') return { prop: 'cursor', value: tail };
  if (head === 'overflow') {
    const oDash = tail.indexOf('-');
    if (oDash > 0) {
      const axis = tail.slice(0, oDash);
      if (axis === 'x' || axis === 'y') {
        return { prop: 'overflow', side: axis, value: tail.slice(oDash + 1) };
      }
    }
    if (OVERFLOWS.has(tail)) return { prop: 'overflow', side: 'all', value: tail };
    return unknown;
  }

  if (head === 'flex') {
    if (FLEX_DIRECTIONS.has(tail)) return { prop: 'flexDirection', value: tail };
    if (FLEX_WRAPS.has(tail)) return { prop: 'flexWrap', value: tail };
    if (FLEX_SHORTHAND.has(tail) || NUMERIC.test(tail) || isArbitrary(tail)) {
      return { prop: 'flex', value: tail };
    }
    return unknown;
  }
  if (head === 'items') {
    return ITEMS.has(tail) ? { prop: 'alignItems', value: tail } : unknown;
  }
  if (head === 'justify') {
    if (tail.startsWith('items-') || tail.startsWith('self-')) return unknown;
    return JUSTIFY.has(tail) ? { prop: 'justifyContent', value: tail } : unknown;
  }
  if (head === 'self') {
    return SELF.has(tail) ? { prop: 'alignSelf', value: tail } : unknown;
  }
  if (head === 'gap') {
    if (tail.startsWith('x-')) return { prop: 'gap', side: 'x', value: tail.slice(2) };
    if (tail.startsWith('y-')) return { prop: 'gap', side: 'y', value: tail.slice(2) };
    return { prop: 'gap', side: 'all', value: tail };
  }
  if (base.startsWith('grid-cols-')) return { prop: 'gridCols', value: base.slice(10) };
  if (base.startsWith('grid-rows-')) return { prop: 'gridRows', value: base.slice(10) };

  // Sizing ---------------------------------------------------------------
  for (const [prefix, prop] of SIZE_PREFIXES) {
    if (sBase === prefix) continue;
    if (sBase.startsWith(prefix + '-')) {
      return { prop, value: (negative ? '-' : '') + sBase.slice(prefix.length + 1) };
    }
  }

  // Position offsets -----------------------------------------------------
  for (const [prefix, prop] of INSET_PREFIXES) {
    if (sBase === prefix) continue;
    if (sBase.startsWith(prefix + '-')) {
      return { prop, value: (negative ? '-' : '') + sBase.slice(prefix.length + 1) };
    }
  }

  return unknown;
}

// A parsed token. `raw` is the source of truth for re-emission.
function makeToken(raw, keys) {
  if (raw && raw.__opaque) return { kind: 'opaque', raw: raw.text, variants: [], prop: null };
  let text = String(raw);
  let important = false;
  const { variants, base: withBang } = splitVariants(text);
  let base = withBang;
  if (base.startsWith('!')) {
    important = true;
    base = base.slice(1);
  }
  const c = classifyBase(base, keys);
  return {
    kind: 'class',
    raw: text,
    variants,
    variantKey: variantKey(variants),
    important,
    base,
    prop: c.prop,
    value: c.value == null ? null : c.value,
    side: c.side || null,
  };
}

function tokenize(className, keys) {
  if (className == null) return [];
  const parts = String(className).split(/(\s+)/);
  const tokens = [];
  for (const part of parts) {
    if (!part || /^\s+$/.test(part)) continue;
    tokens.push(makeToken(part, keys));
  }
  return tokens;
}

function stringifyTokens(tokens) {
  return tokens.map((t) => t.raw).filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function joinUtility(prefix, value) {
  if (value === '' || value === null || value === undefined) return prefix;
  const v = String(value);
  if (v.startsWith('-')) return `-${prefix}-${v.slice(1)}`;
  return `${prefix}-${v}`;
}

function withVariants(variants, important, body) {
  const v = variants && variants.length ? orderVariants(variants).join(':') + ':' : '';
  return v + (important ? '!' : '') + body;
}

const SIDE_TO_PADDING = { all: 'p', x: 'px', y: 'py', top: 'pt', right: 'pr', bottom: 'pb', left: 'pl' };
const SIDE_TO_MARGIN = { all: 'm', x: 'mx', y: 'my', top: 'mt', right: 'mr', bottom: 'mb', left: 'ml' };

// Render a token body for a property/value pair.
function renderBody(prop, value, side) {
  switch (prop) {
    case 'display':
    case 'position':
    case 'textTransform':
    case 'fontStyle':
    case 'textDecoration':
      return String(value);
    case 'padding': return joinUtility(SIDE_TO_PADDING[side || 'all'], value);
    case 'margin': return joinUtility(SIDE_TO_MARGIN[side || 'all'], value);
    case 'background': return joinUtility('bg', value);
    case 'textColor': return joinUtility('text', value);
    case 'fontSize': return joinUtility('text', value);
    case 'textAlign': return joinUtility('text', value);
    case 'fontWeight': return joinUtility('font', value);
    case 'fontFamily': return joinUtility('font', value);
    case 'lineHeight': return joinUtility('leading', value);
    case 'letterSpacing': return joinUtility('tracking', value);
    case 'borderRadius':
      return joinUtility(side && side !== 'all' ? `rounded-${side}` : 'rounded', value);
    case 'borderWidth':
      return joinUtility(side && side !== 'all' ? `border-${side}` : 'border', value);
    case 'borderColor':
      return joinUtility(side && side !== 'all' ? `border-${side}` : 'border', value);
    case 'borderStyle': return joinUtility('border', value);
    case 'boxShadow': return joinUtility('shadow', value);
    case 'shadowColor': return joinUtility('shadow', value);
    case 'opacity': return joinUtility('opacity', value);
    case 'zIndex': return joinUtility('z', value);
    case 'gap':
      return joinUtility(side && side !== 'all' ? `gap-${side}` : 'gap', value);
    case 'flexDirection': return joinUtility('flex', value);
    case 'flexWrap': return joinUtility('flex', value);
    case 'flex': return joinUtility('flex', value);
    case 'alignItems': return joinUtility('items', value);
    case 'justifyContent': return joinUtility('justify', value);
    case 'alignSelf': return joinUtility('self', value);
    case 'gridCols': return joinUtility('grid-cols', value);
    case 'gridRows': return joinUtility('grid-rows', value);
    case 'width': return joinUtility('w', value);
    case 'height': return joinUtility('h', value);
    case 'size': return joinUtility('size', value);
    case 'minWidth': return joinUtility('min-w', value);
    case 'minHeight': return joinUtility('min-h', value);
    case 'maxWidth': return joinUtility('max-w', value);
    case 'maxHeight': return joinUtility('max-h', value);
    case 'overflow':
      return joinUtility(side && side !== 'all' ? `overflow-${side}` : 'overflow', value);
    case 'cursor': return joinUtility('cursor', value);
    case 'top': return joinUtility('top', value);
    case 'right': return joinUtility('right', value);
    case 'bottom': return joinUtility('bottom', value);
    case 'left': return joinUtility('left', value);
    case 'inset': return joinUtility('inset', value);
    case 'insetX': return joinUtility('inset-x', value);
    case 'insetY': return joinUtility('inset-y', value);
    case 'textOverflow': return joinUtility('text', value);
    case 'textWrap': return joinUtility('text', value);
    case 'bgSize': return joinUtility('bg', value);
    case 'bgRepeat': return joinUtility('bg', value);
    case 'bgAttachment': return joinUtility('bg', value);
    case 'bgImage': return joinUtility('bg', value);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Reading values
// ---------------------------------------------------------------------------

const SPACING_PROPS = new Set(['padding', 'margin']);

function emptySpacing() {
  return { top: null, right: null, bottom: null, left: null };
}

function applySpacingSide(spacing, side, value) {
  if (side === 'all') {
    spacing.top = value; spacing.right = value;
    spacing.bottom = value; spacing.left = value;
  } else if (side === 'x') {
    spacing.left = value; spacing.right = value;
  } else if (side === 'y') {
    spacing.top = value; spacing.bottom = value;
  } else {
    spacing[side] = value;
  }
}

// Resolve the effective property values for one variant set.
function readVariant(tokens, vKey) {
  const props = {
    padding: emptySpacing(),
    margin: emptySpacing(),
  };
  for (const t of tokens) {
    if (t.kind !== 'class' || !t.prop) continue;
    if (t.variantKey !== vKey) continue;
    if (SPACING_PROPS.has(t.prop)) {
      applySpacingSide(props[t.prop], t.side || 'all', t.value);
    } else if (t.prop === 'borderWidth' || t.prop === 'borderColor' ||
               t.prop === 'borderRadius' || t.prop === 'gap' || t.prop === 'overflow') {
      // Side-aware but surfaced as a scalar for the "all" case; per-side values
      // are still reachable through the token list.
      if (!t.side || t.side === 'all') props[t.prop] = t.value;
      else if (props[t.prop] === undefined) props[t.prop] = null;
    } else {
      props[t.prop] = t.value;
    }
  }
  return props;
}

// Every variant present in the class string, base first.
function listVariants(tokens) {
  const seen = new Set(['']);
  const out = [''];
  for (const t of tokens) {
    if (t.kind !== 'class' || !t.variants.length) continue;
    if (seen.has(t.variantKey)) continue;
    seen.add(t.variantKey);
    out.push(t.variantKey);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

// Minimal token set for a 4-side spacing map, biased toward the shortest
// idiomatic form so we don't expand `p-4` into four classes for one change.
function emitSpacingTokens(prop, sides) {
  const { top, right, bottom, left } = sides;
  const present = [top, right, bottom, left].filter((v) => v !== null && v !== undefined);
  if (!present.length) return [];
  const all = [top, right, bottom, left];
  const complete = all.every((v) => v !== null && v !== undefined);

  if (complete) {
    if (top === right && top === bottom && top === left) {
      return [{ prop, side: 'all', value: top }];
    }
    const xEq = left === right;
    const yEq = top === bottom;
    if (xEq && yEq) {
      return [
        { prop, side: 'x', value: left },
        { prop, side: 'y', value: top },
      ];
    }
    // Exactly one side differs from a value shared by the other three:
    // `p-4 pt-2` rather than four separate classes.
    const sideNames = ['top', 'right', 'bottom', 'left'];
    for (let i = 0; i < 4; i++) {
      const others = all.filter((_, j) => j !== i);
      if (others[0] === others[1] && others[1] === others[2] && others[0] !== all[i]) {
        return [
          { prop, side: 'all', value: others[0] },
          { prop, side: sideNames[i], value: all[i] },
        ];
      }
    }
    if (xEq) {
      return [
        { prop, side: 'x', value: left },
        { prop, side: 'top', value: top },
        { prop, side: 'bottom', value: bottom },
      ];
    }
    if (yEq) {
      return [
        { prop, side: 'y', value: top },
        { prop, side: 'left', value: left },
        { prop, side: 'right', value: right },
      ];
    }
  }
  const out = [];
  if (top !== null && top !== undefined) out.push({ prop, side: 'top', value: top });
  if (right !== null && right !== undefined) out.push({ prop, side: 'right', value: right });
  if (bottom !== null && bottom !== undefined) out.push({ prop, side: 'bottom', value: bottom });
  if (left !== null && left !== undefined) out.push({ prop, side: 'left', value: left });
  return out;
}

// Properties that share a token prefix and must be treated as mutually
// exclusive when writing: setting a font size must replace an existing
// `text-lg`, but must NOT touch `text-center` or `text-white`.
function matchesEditTarget(token, prop, side) {
  if (token.prop !== prop) return false;
  if (side === undefined || side === null) return true;
  const tSide = token.side || 'all';
  return tSide === side;
}

/**
 * Apply a list of edits to a class string.
 *
 * edit: { prop, value, side?, variants? }
 *   value === null | undefined  → remove the property
 *   variants defaults to []     → the base (unprefixed) variant
 *
 * Tokens not targeted by an edit are re-emitted verbatim, in place.
 */
function applyEdits(className, edits, options) {
  const keys = options && options.theme ? buildKeySets(options.theme) : DEFAULT_KEYS;
  const tokens = tokenize(className, keys);
  for (const edit of edits || []) {
    applyOneEdit(tokens, edit, keys);
  }
  return stringifyTokens(tokens);
}

function applyOneEdit(tokens, edit, keys) {
  const prop = edit.prop;
  if (!prop) return;
  const variants = edit.variants || [];
  const vKey = variantKey(variants);

  if (SPACING_PROPS.has(prop)) {
    return applySpacingEdit(tokens, prop, edit, variants, vKey, keys);
  }

  const side = edit.side === undefined ? null : edit.side;
  const value = edit.value;
  const remove = value === null || value === undefined || value === '';
  // `rounded` / `border` / `shadow` legitimately have an empty value (the bare
  // class). An explicit empty string means "bare class", not "remove".
  const bareAllowed = prop === 'borderRadius' || prop === 'borderWidth' || prop === 'boxShadow';
  const isRemove = value === null || value === undefined || (value === '' && !bareAllowed);

  const indices = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'class') continue;
    if (t.variantKey !== vKey) continue;
    if (matchesEditTarget(t, prop, side === null ? undefined : side)) indices.push(i);
  }

  if (isRemove) {
    for (let i = indices.length - 1; i >= 0; i--) tokens.splice(indices[i], 1);
    return;
  }

  const body = renderBody(prop, value, side === null ? 'all' : side);
  if (body == null) return;
  const raw = withVariants(variants, false, body);
  const next = makeToken(raw, keys);

  if (indices.length) {
    // Replace the first occurrence in place; drop any duplicates after it.
    tokens[indices[0]] = next;
    for (let i = indices.length - 1; i >= 1; i--) tokens.splice(indices[i], 1);
  } else {
    tokens.push(next);
  }
}

function applySpacingEdit(tokens, prop, edit, variants, vKey, keys) {
  // Current per-side values for this variant.
  const sides = emptySpacing();
  const indices = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'class' || t.prop !== prop || t.variantKey !== vKey) continue;
    applySpacingSide(sides, t.side || 'all', t.value);
    indices.push(i);
  }

  // The patch may be a 4-side object or a single side + value.
  if (edit.side) {
    applySpacingSide(sides, edit.side, edit.value === undefined ? null : edit.value);
  } else if (edit.value && typeof edit.value === 'object') {
    for (const [k, v] of Object.entries(edit.value)) {
      if (k === 'all' || k === 'x' || k === 'y') applySpacingSide(sides, k, v);
      else if (k in sides) sides[k] = v === undefined ? null : v;
    }
  } else if (edit.value === null || edit.value === undefined) {
    sides.top = sides.right = sides.bottom = sides.left = null;
  } else {
    applySpacingSide(sides, 'all', edit.value);
  }

  const specs = emitSpacingTokens(prop, sides);
  const newTokens = specs.map((s) =>
    makeToken(withVariants(variants, false, renderBody(s.prop, s.value, s.side)), keys)
  );

  const anchor = indices.length ? indices[0] : tokens.length;
  for (let i = indices.length - 1; i >= 0; i--) tokens.splice(indices[i], 1);
  const insertAt = Math.min(anchor, tokens.length);
  tokens.splice(insertAt, 0, ...newTokens);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
//
// A model that writes `bg-brnad` produces a class Tailwind silently ignores:
// nothing errors, nothing renders, and the drift is invisible until someone
// notices the button is the wrong colour. Checking a value against the
// project's own scales turns that into an answerable question with a
// suggestion attached.

// Values that are valid for any colour utility regardless of the palette.
const COLOR_KEYWORDS = new Set(['inherit', 'current', 'transparent', 'none']);
// Values that are valid for any sizing utility.
const SIZE_KEYWORDS = new Set([
  'auto', 'full', 'screen', 'min', 'max', 'fit', 'px', 'none', 'prose',
  'dvh', 'dvw', 'svh', 'lvh',
]);
const FRACTION = /^\d+\/\d+$/;

const DEFAULT_KEYS_SPACING = [
  'px', '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8',
  '9', '10', '11', '12', '14', '16', '20', '24', '28', '32', '36', '40', '44',
  '48', '52', '56', '60', '64', '72', '80', '96',
];

const COLOR_PROPS_SET = new Set(['background', 'textColor', 'borderColor', 'shadowColor']);
const SPACING_SCALE_PROPS = new Set([
  'padding', 'margin', 'gap', 'width', 'height', 'minWidth', 'minHeight',
  'maxWidth', 'maxHeight', 'size', 'top', 'right', 'bottom', 'left', 'inset',
  'insetX', 'insetY',
]);

function themeColorNames(theme) {
  const out = new Set();
  const colors = theme && theme.colors;
  const list = Array.isArray(colors) ? colors : (colors && colors.all) || null;
  if (list) for (const c of list) out.add(typeof c === 'string' ? c : c.name);
  return out;
}

// The theme we are handed comes from resolveConfig, so when a category is
// present it is already the complete scale for this project — including any
// Tailwind defaults the project kept. Unioning our own fallback on top would
// re-admit values a project deliberately removed, so the fallback is only for
// when there is no theme at all.
function partitionValues(theme, category, fallback) {
  const v = theme && theme[category];
  const list = Array.isArray(v) ? v : (v && v.all) || null;
  if (list && list.length) {
    return new Set(list.map((k) => (k === 'DEFAULT' ? '' : k)));
  }
  return new Set(fallback || []);
}

/**
 * The set of values a property will accept, given the project's theme.
 * Returns null for properties we do not constrain.
 */
function knownValuesFor(prop, theme) {
  if (COLOR_PROPS_SET.has(prop)) {
    // With no palette to check against there is nothing meaningful to say, and
    // a warning on every colour would be noise.
    const palette = themeColorNames(theme);
    if (!palette.size) return null;
    for (const k of COLOR_KEYWORDS) palette.add(k);
    return palette;
  }
  if (SPACING_SCALE_PROPS.has(prop)) {
    const set = partitionValues(theme, 'spacing', DEFAULT_KEYS_SPACING);
    for (const k of SIZE_KEYWORDS) set.add(k);
    return set;
  }
  if (prop === 'fontSize') return partitionValues(theme, 'fontSize', DEFAULT_FONT_SIZES);
  if (prop === 'fontWeight') return partitionValues(theme, 'fontWeight', [...FONT_WEIGHTS]);
  if (prop === 'fontFamily') return partitionValues(theme, 'fontFamily', ['sans', 'serif', 'mono']);
  if (prop === 'borderRadius') {
    return partitionValues(theme, 'borderRadius', DEFAULT_RADIUS.map((k) => (k === 'DEFAULT' ? '' : k)));
  }
  if (prop === 'boxShadow') {
    return partitionValues(theme, 'boxShadow', DEFAULT_SHADOWS.map((k) => (k === 'DEFAULT' ? '' : k)));
  }
  if (prop === 'display') return DISPLAYS;
  if (prop === 'position') return POSITIONS;
  if (prop === 'flexDirection') return FLEX_DIRECTIONS;
  if (prop === 'flexWrap') return FLEX_WRAPS;
  if (prop === 'alignItems') return ITEMS;
  if (prop === 'justifyContent') return JUSTIFY;
  if (prop === 'alignSelf') return SELF;
  if (prop === 'textAlign') return TEXT_ALIGNS;
  if (prop === 'textTransform') return TEXT_TRANSFORMS;
  if (prop === 'borderStyle') return BORDER_STYLES;
  if (prop === 'overflow') return OVERFLOWS;
  return null;
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[n];
}

function suggestionsFor(value, known, limit = 3) {
  const target = String(value).toLowerCase();
  const targetNum = Number(target);
  const numeric = target !== '' && !Number.isNaN(targetNum);

  // For an off-scale number the useful answer is the nearest steps that do
  // exist, not the ones that happen to share characters.
  if (numeric) {
    const steps = [];
    for (const candidate of known) {
      const n = Number(candidate);
      if (candidate === '' || Number.isNaN(n)) continue;
      steps.push({ candidate, distance: Math.abs(n - targetNum) });
    }
    if (steps.length) {
      steps.sort((a, b) => a.distance - b.distance || Number(a.candidate) - Number(b.candidate));
      return steps.slice(0, limit).map((s) => s.candidate);
    }
  }

  const scored = [];
  for (const candidate of known) {
    if (candidate === '') continue;
    const c = String(candidate).toLowerCase();
    // A near-miss, or the right family with the wrong step ("brand" vs "brand-dark").
    const distance = editDistance(target, c);
    const related = c.startsWith(target) || target.startsWith(c) ||
      c.split('-')[0] === target.split('-')[0];
    if (distance <= 3 || related) scored.push({ candidate, distance: related ? Math.min(distance, 2) : distance });
  }
  scored.sort((a, b) => a.distance - b.distance || String(a.candidate).length - String(b.candidate).length);
  return scored.slice(0, limit).map((s) => s.candidate);
}

/**
 * Check one property/value pair against the project's design system.
 * Arbitrary values (`[#ff0000]`, `[13px]`) always pass — they are an explicit
 * decision to step outside the scale, not a typo.
 */
function validateValue(prop, value, theme) {
  if (value === null || value === undefined) return { ok: true };
  const raw = String(value);
  if (raw === '') return { ok: true };
  if (isArbitrary(raw)) return { ok: true, arbitrary: true };
  if (raw.includes('__FRAMELAB_EXPR_')) return { ok: true };

  const known = knownValuesFor(prop, theme);
  if (!known) return { ok: true };

  // Colours may carry an opacity suffix, sizes may be fractions or negative.
  let candidate = raw;
  if (COLOR_PROPS_SET.has(prop)) candidate = stripOpacitySuffix(candidate).value;
  if (SPACING_SCALE_PROPS.has(prop)) {
    if (candidate.startsWith('-')) candidate = candidate.slice(1);
    if (FRACTION.test(candidate)) return { ok: true };
    if (/^\d+(\.\d+)?$/.test(candidate) && known.has(candidate)) return { ok: true };
  }

  if (known.has(candidate)) return { ok: true };
  return { ok: false, value: raw, prop, suggestions: suggestionsFor(candidate, known) };
}

/**
 * Validate a list of edits. Returns one entry per value that is not part of
 * the project's design system, with the nearest names that are.
 */
function validateEdits(edits, theme) {
  const problems = [];
  for (const edit of edits || []) {
    if (!edit || !edit.prop) continue;
    const values = [];
    if (SPACING_PROPS.has(edit.prop) && edit.value && typeof edit.value === 'object') {
      for (const [side, v] of Object.entries(edit.value)) values.push([side, v]);
    } else {
      values.push([null, edit.value]);
    }
    for (const [side, v] of values) {
      const result = validateValue(edit.prop, v, theme);
      if (result.ok) continue;
      problems.push({
        prop: edit.prop,
        side: side || undefined,
        value: result.value,
        variants: edit.variants || [],
        suggestions: result.suggestions,
        message: `"${result.value}" is not in this project's ${describeScale(edit.prop)}` +
          (result.suggestions.length ? `. Did you mean ${result.suggestions.map((x) => `"${x}"`).join(', ')}?` : '.'),
      });
    }
  }
  return problems;
}

function describeScale(prop) {
  if (COLOR_PROPS_SET.has(prop)) return 'colour palette';
  if (SPACING_SCALE_PROPS.has(prop)) return 'spacing scale';
  if (prop === 'fontSize') return 'font size scale';
  if (prop === 'fontWeight') return 'font weight scale';
  if (prop === 'fontFamily') return 'font families';
  if (prop === 'borderRadius') return 'border radius scale';
  if (prop === 'boxShadow') return 'shadow scale';
  return `${prop} values`;
}

// ---------------------------------------------------------------------------
// Public API (back-compatible surface)
// ---------------------------------------------------------------------------

function parseClassName(className, options) {
  const keys = options && options.theme ? buildKeySets(options.theme) : DEFAULT_KEYS;
  const tokens = tokenize(className, keys);
  const props = readVariant(tokens, '');
  const unknown = tokens
    .filter((t) => t.kind === 'class' && !t.prop)
    .map((t) => t.raw);

  return {
    props,
    unknown,
    tokens: tokens.map((t) => ({
      raw: t.raw,
      kind: t.kind,
      variants: t.variants || [],
      variantKey: t.variantKey || '',
      prop: t.prop || null,
      value: t.value === undefined ? null : t.value,
      side: t.side || null,
    })),
    variants: listVariants(tokens),
    variantProps: Object.fromEntries(
      listVariants(tokens).map((v) => [v, readVariant(tokens, v)])
    ),
  };
}

// Older callers (and the published MCP tool schema) use the short names.
const PROP_ALIASES = {
  rounded: 'borderRadius',
  shadow: 'boxShadow',
  radius: 'borderRadius',
};

// Legacy shape: a flat property patch applied to the base variant.
function mergeProps(existingClassName, partialProps, options) {
  const edits = [];
  for (const [rawKey, value] of Object.entries(partialProps || {})) {
    const key = PROP_ALIASES[rawKey] || rawKey;
    edits.push({ prop: key, value });
  }
  return applyEdits(existingClassName || '', edits, options);
}

// Kept for callers that used it to re-serialise a parsed bag. Now expressed as
// an edit against the original string so ordering and unknowns survive.
function stringifyProps(props, unknown) {
  const base = (unknown || []).join(' ');
  return mergeProps(base, props || {});
}

module.exports = {
  parseClassName,
  stringifyProps,
  mergeProps,
  applyEdits,
  tokenize,
  stringifyTokens,
  buildKeySets,
  isHexColor,
  isArbitrary,
  stripOpacitySuffix,
  listVariants,
  readVariant,
  validateValue,
  validateEdits,
  knownValuesFor,
  suggestionsFor,
  PROP_ALIASES,
  emitSpacingTokens,
  BREAKPOINT_ORDER,
};
