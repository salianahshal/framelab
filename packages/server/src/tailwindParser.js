'use strict';

const FONT_SIZES = new Set([
  'xs', 'sm', 'base', 'lg', 'xl',
  '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
]);
const FONT_WEIGHTS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium',
  'semibold', 'bold', 'extrabold', 'black',
]);
const RADIUS = new Set([
  'none', 'sm', '', 'md', 'lg', 'xl', '2xl', '3xl', 'full',
]);
const SHADOWS = new Set(['none', 'sm', '', 'md', 'lg', 'xl', '2xl', 'inner']);
const DISPLAYS = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex',
  'grid', 'inline-grid', 'hidden', 'contents',
]);
const FLEX_DIRECTIONS = new Set(['row', 'row-reverse', 'col', 'col-reverse']);
const ITEMS = new Set(['start', 'end', 'center', 'baseline', 'stretch']);
const JUSTIFY = new Set([
  'start', 'end', 'center', 'between', 'around', 'evenly', 'stretch',
]);

const PADDING_PREFIXES = {
  p: 'all', px: 'x', py: 'y', pt: 'top', pr: 'right', pb: 'bottom', pl: 'left',
};
const MARGIN_PREFIXES = {
  m: 'all', mx: 'x', my: 'y', mt: 'top', mr: 'right', mb: 'bottom', ml: 'left',
};

function isHexColor(s) {
  return /^#[0-9a-fA-F]{3,8}$/.test(s);
}

function tokenize(className) {
  if (!className) return [];
  return className.trim().split(/\s+/).filter(Boolean);
}

function classifyToken(token) {
  if (!token) return { kind: 'unknown', token };

  if (token.startsWith('bg-')) return { kind: 'background', value: token.slice(3) };
  if (token.startsWith('text-')) {
    const v = token.slice(5);
    if (FONT_SIZES.has(v)) return { kind: 'fontSize', value: v };
    if (/^\[-?\d*\.?\d+(px|rem|em|%|vh|vw|pt|ch)\]$/i.test(v)) {
      return { kind: 'fontSize', value: v };
    }
    return { kind: 'textColor', value: v };
  }
  if (token.startsWith('font-')) {
    const v = token.slice(5);
    if (FONT_WEIGHTS.has(v)) return { kind: 'fontWeight', value: v };
    return { kind: 'fontFamily', value: v };
  }

  if (token === 'rounded') return { kind: 'rounded', value: '' };
  if (token.startsWith('rounded-')) {
    const v = token.slice(8);
    if (RADIUS.has(v)) return { kind: 'rounded', value: v };
    return { kind: 'unknown', token };
  }

  if (token === 'border') return { kind: 'borderWidth', value: '' };
  if (token.startsWith('border-')) {
    const v = token.slice(7);
    if (/^\d+$/.test(v)) return { kind: 'borderWidth', value: v };
    if (/^\[-?\d*\.?\d+(px|rem|em)\]$/i.test(v)) return { kind: 'borderWidth', value: v };
    return { kind: 'borderColor', value: v };
  }

  if (token === 'shadow') return { kind: 'shadow', value: '' };
  if (token.startsWith('shadow-')) {
    const v = token.slice(7);
    if (SHADOWS.has(v)) return { kind: 'shadow', value: v };
    return { kind: 'unknown', token };
  }

  if (DISPLAYS.has(token)) return { kind: 'display', value: token };

  if (token.startsWith('flex-')) {
    const v = token.slice(5);
    if (FLEX_DIRECTIONS.has(v)) return { kind: 'flexDirection', value: v };
    return { kind: 'unknown', token };
  }

  if (token.startsWith('items-')) {
    const v = token.slice(6);
    if (ITEMS.has(v)) return { kind: 'alignItems', value: v };
    return { kind: 'unknown', token };
  }

  if (token.startsWith('justify-')) {
    const v = token.slice(8);
    if (JUSTIFY.has(v)) return { kind: 'justifyContent', value: v };
    return { kind: 'unknown', token };
  }

  if (token.startsWith('gap-')) return { kind: 'gap', value: token.slice(4) };

  if (token.startsWith('w-')) return { kind: 'width', value: token.slice(2) };
  if (token.startsWith('h-')) return { kind: 'height', value: token.slice(2) };
  if (token.startsWith('min-w-')) return { kind: 'minWidth', value: token.slice(6) };
  if (token.startsWith('min-h-')) return { kind: 'minHeight', value: token.slice(6) };
  if (token.startsWith('max-w-')) return { kind: 'maxWidth', value: token.slice(6) };
  if (token.startsWith('max-h-')) return { kind: 'maxHeight', value: token.slice(6) };

  if (token.startsWith('opacity-')) return { kind: 'opacity', value: token.slice(8) };

  for (const [prefix, side] of Object.entries(PADDING_PREFIXES)) {
    if (token === prefix) return { kind: 'paddingRaw', side, value: '' };
    if (token.startsWith(prefix + '-')) {
      return { kind: 'paddingRaw', side, value: token.slice(prefix.length + 1) };
    }
  }
  for (const [prefix, side] of Object.entries(MARGIN_PREFIXES)) {
    if (token === prefix) return { kind: 'marginRaw', side, value: '' };
    if (token.startsWith(prefix + '-')) {
      return { kind: 'marginRaw', side, value: token.slice(prefix.length + 1) };
    }
  }

  return { kind: 'unknown', token };
}

function emptySpacing() {
  return { top: null, right: null, bottom: null, left: null };
}

function applySpacing(spacing, side, value) {
  if (side === 'all') {
    spacing.top = value;
    spacing.right = value;
    spacing.bottom = value;
    spacing.left = value;
  } else if (side === 'x') {
    spacing.left = value;
    spacing.right = value;
  } else if (side === 'y') {
    spacing.top = value;
    spacing.bottom = value;
  } else {
    spacing[side] = value;
  }
}

function parseClassName(className) {
  const tokens = tokenize(className);
  const props = {
    background: null,
    textColor: null,
    fontSize: null,
    fontWeight: null,
    fontFamily: null,
    padding: emptySpacing(),
    margin: emptySpacing(),
    rounded: null,
    borderWidth: null,
    borderColor: null,
    display: null,
    flexDirection: null,
    alignItems: null,
    justifyContent: null,
    gap: null,
    width: null,
    height: null,
    minWidth: null,
    minHeight: null,
    maxWidth: null,
    maxHeight: null,
    opacity: null,
    shadow: null,
  };
  const unknown = [];

  for (const token of tokens) {
    const c = classifyToken(token);
    switch (c.kind) {
      case 'background': props.background = c.value; break;
      case 'textColor': props.textColor = c.value; break;
      case 'fontSize': props.fontSize = c.value; break;
      case 'fontWeight': props.fontWeight = c.value; break;
      case 'fontFamily': props.fontFamily = c.value; break;
      case 'rounded': props.rounded = c.value; break;
      case 'borderWidth': props.borderWidth = c.value; break;
      case 'borderColor': props.borderColor = c.value; break;
      case 'display': props.display = c.value; break;
      case 'flexDirection': props.flexDirection = c.value; break;
      case 'alignItems': props.alignItems = c.value; break;
      case 'justifyContent': props.justifyContent = c.value; break;
      case 'gap': props.gap = c.value; break;
      case 'width': props.width = c.value; break;
      case 'height': props.height = c.value; break;
      case 'minWidth': props.minWidth = c.value; break;
      case 'minHeight': props.minHeight = c.value; break;
      case 'maxWidth': props.maxWidth = c.value; break;
      case 'maxHeight': props.maxHeight = c.value; break;
      case 'opacity': props.opacity = c.value; break;
      case 'shadow': props.shadow = c.value; break;
      case 'paddingRaw': applySpacing(props.padding, c.side, c.value); break;
      case 'marginRaw': applySpacing(props.margin, c.side, c.value); break;
      default: unknown.push(token);
    }
  }

  return { props, unknown };
}

function spacingTokens(prefix, spacing) {
  if (
    spacing.top === null &&
    spacing.right === null &&
    spacing.bottom === null &&
    spacing.left === null
  ) {
    return [];
  }
  const allEqual =
    spacing.top !== null &&
    spacing.top === spacing.right &&
    spacing.top === spacing.bottom &&
    spacing.top === spacing.left;
  if (allEqual) return [join(prefix, spacing.top)];

  const xEqual = spacing.left !== null && spacing.left === spacing.right;
  const yEqual = spacing.top !== null && spacing.top === spacing.bottom;
  const out = [];
  if (xEqual && yEqual) {
    out.push(join(prefix + 'x', spacing.left));
    out.push(join(prefix + 'y', spacing.top));
    return out;
  }
  if (spacing.top !== null) out.push(join(prefix + 't', spacing.top));
  if (spacing.right !== null) out.push(join(prefix + 'r', spacing.right));
  if (spacing.bottom !== null) out.push(join(prefix + 'b', spacing.bottom));
  if (spacing.left !== null) out.push(join(prefix + 'l', spacing.left));
  return out;
}

function join(prefix, value) {
  if (value === '' || value === null || value === undefined) return prefix;
  return `${prefix}-${value}`;
}

function stringifyProps(props, unknown) {
  const tokens = [];

  if (props.display) tokens.push(props.display);
  if (props.flexDirection) tokens.push(`flex-${props.flexDirection}`);
  if (props.alignItems) tokens.push(`items-${props.alignItems}`);
  if (props.justifyContent) tokens.push(`justify-${props.justifyContent}`);
  if (props.gap !== null && props.gap !== undefined) tokens.push(join('gap', props.gap));

  if (props.width) tokens.push(join('w', props.width));
  if (props.height) tokens.push(join('h', props.height));
  if (props.minWidth) tokens.push(join('min-w', props.minWidth));
  if (props.minHeight) tokens.push(join('min-h', props.minHeight));
  if (props.maxWidth) tokens.push(join('max-w', props.maxWidth));
  if (props.maxHeight) tokens.push(join('max-h', props.maxHeight));

  tokens.push(...spacingTokens('p', props.padding || emptySpacing()));
  tokens.push(...spacingTokens('m', props.margin || emptySpacing()));

  if (props.background) tokens.push(`bg-${props.background}`);
  if (props.textColor) tokens.push(`text-${props.textColor}`);
  if (props.fontSize) tokens.push(`text-${props.fontSize}`);
  if (props.fontWeight) tokens.push(`font-${props.fontWeight}`);
  if (props.fontFamily) tokens.push(`font-${props.fontFamily}`);

  if (props.rounded !== null && props.rounded !== undefined) {
    tokens.push(props.rounded === '' ? 'rounded' : `rounded-${props.rounded}`);
  }
  if (props.borderWidth !== null && props.borderWidth !== undefined) {
    tokens.push(props.borderWidth === '' ? 'border' : `border-${props.borderWidth}`);
  }
  if (props.borderColor) tokens.push(`border-${props.borderColor}`);
  if (props.shadow !== null && props.shadow !== undefined) {
    tokens.push(props.shadow === '' ? 'shadow' : `shadow-${props.shadow}`);
  }
  if (props.opacity !== null && props.opacity !== undefined) {
    tokens.push(`opacity-${props.opacity}`);
  }

  if (unknown && unknown.length) tokens.push(...unknown);

  return tokens.join(' ');
}

function mergeProps(existingClassName, partialProps) {
  const { props, unknown } = parseClassName(existingClassName || '');
  const merged = { ...props };
  for (const [key, value] of Object.entries(partialProps || {})) {
    if (key === 'padding' || key === 'margin') {
      merged[key] = { ...(merged[key] || emptySpacing()), ...(value || {}) };
    } else {
      merged[key] = value;
    }
  }
  return stringifyProps(merged, unknown);
}

module.exports = {
  parseClassName,
  stringifyProps,
  mergeProps,
  isHexColor,
};
