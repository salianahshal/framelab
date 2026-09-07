'use strict';

const fs = require('fs');
const parser = require('@babel/parser');
const traverseImport = require('@babel/traverse');
const traverse = traverseImport.default || traverseImport;

const PARSE_OPTIONS = {
  sourceType: 'module',
  plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
  errorRecovery: true,
  ranges: true,
  tokens: false,
};

// Helper functions commonly used to compose class strings. The first string
// literal argument is treated as the element's base classes, which is what
// makes shadcn/ui-style codebases editable rather than opaque.
const CLASS_HELPERS = new Set([
  'cn', 'clsx', 'classnames', 'classNames', 'cx', 'twMerge', 'twJoin', 'tw', 'cva',
]);

const EXPR_PLACEHOLDER = /__FRAMELAB_EXPR_(\d+)__/g;
function placeholderFor(i) {
  return `__FRAMELAB_EXPR_${i}__`;
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseCode(code) {
  return parser.parse(code, PARSE_OPTIONS);
}

function getTagName(openingElement) {
  const name = openingElement.name;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') {
    const parts = [];
    let cursor = name;
    while (cursor.type === 'JSXMemberExpression') {
      parts.unshift(cursor.property.name);
      cursor = cursor.object;
    }
    if (cursor.type === 'JSXIdentifier') parts.unshift(cursor.name);
    return parts.join('.');
  }
  if (name.type === 'JSXNamespacedName') {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return 'unknown';
}

function isFragment(openingElement) {
  const name = openingElement.name;
  if (name.type === 'JSXIdentifier' && name.name === 'Fragment') return true;
  if (
    name.type === 'JSXMemberExpression' &&
    name.object &&
    name.object.type === 'JSXIdentifier' &&
    name.object.name === 'React' &&
    name.property &&
    name.property.name === 'Fragment'
  ) {
    return true;
  }
  return false;
}

function findClassNameAttr(node) {
  for (const attr of node.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    if (!attr.name || attr.name.name !== 'className') continue;
    return attr;
  }
  return null;
}

function calleeName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Class-string surface
// ---------------------------------------------------------------------------
//
// A "surface" is the editable class text of an element plus the knowledge of
// how to write an edited version back into the source. Four shapes are
// supported; each writes back a byte range and nothing else.
//
//   string    className="a b"
//   template  className={`a ${x} b`}   — interpolations become placeholders
//   call      className={cn('a b', x)} — first string literal argument
//   none      no className attribute at all
//
// Anything else (ternaries, identifiers, member expressions) stays read-only.

function templateSurface(expr, code) {
  const parts = [];
  const dynamic = [];
  for (let i = 0; i < expr.quasis.length; i++) {
    const q = expr.quasis[i];
    parts.push(q.value.cooked != null ? q.value.cooked : q.value.raw);
    if (i < expr.expressions.length) {
      const e = expr.expressions[i];
      const src = '${' + code.slice(e.start, e.end) + '}';
      dynamic.push(src);
      parts.push(` ${placeholderFor(i)} `);
    }
  }
  const value = parts.join('').replace(/\s+/g, ' ').trim();
  return { value, dynamic };
}

// Rebuild a template literal from an edited placeholder-bearing class string.
// Interpolations keep their original source text and their relative position;
// any that the editor somehow dropped are re-appended so no code is ever lost.
function rebuildTemplate(value, dynamic) {
  const used = new Set();
  let out = '';
  let last = 0;
  const text = String(value == null ? '' : value);
  EXPR_PLACEHOLDER.lastIndex = 0;
  let m;
  while ((m = EXPR_PLACEHOLDER.exec(text)) !== null) {
    const idx = Number(m[1]);
    out += text.slice(last, m.index);
    if (dynamic[idx] !== undefined) {
      out += dynamic[idx];
      used.add(idx);
    }
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  for (let i = 0; i < dynamic.length; i++) {
    if (!used.has(i)) out += (out.endsWith(' ') || !out ? '' : ' ') + dynamic[i];
  }
  // Collapse the double spaces left where placeholders were padded.
  out = out.replace(/[ \t]+/g, ' ').trim();
  return '`' + out + '`';
}

// JSX attribute strings are NOT JavaScript strings: `\"` is not an escape
// sequence there, it is a literal backslash followed by a quote that closes the
// attribute. Pick a quote style that needs no escaping, and fall back to an
// expression container (where real JS escaping applies) when both quote
// characters appear in the value.
function jsxAttributeLiteral(value) {
  const s = String(value == null ? '' : value);
  if (!/[\n\r\t\\]/.test(s)) {
    if (!s.includes('"')) return JSON.stringify(s);
    if (!s.includes("'")) return "'" + s + "'";
  }
  return '{' + JSON.stringify(s) + '}';
}

function classSurface(attr, code) {
  if (!attr) return { kind: 'none', value: null };
  if (!attr.value) return { kind: 'boolean', value: null };

  if (attr.value.type === 'StringLiteral') {
    return { kind: 'string', value: attr.value.value, node: attr.value, context: 'jsx-attr' };
  }

  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;

    if (expr.type === 'StringLiteral') {
      return { kind: 'string', value: expr.value, node: expr, context: 'js' };
    }

    if (expr.type === 'TemplateLiteral') {
      const { value, dynamic } = templateSurface(expr, code);
      return { kind: 'template', value, node: expr, dynamicParts: dynamic };
    }

    if (expr.type === 'CallExpression' && CLASS_HELPERS.has(calleeName(expr.callee))) {
      const args = expr.arguments || [];
      const firstString = args.findIndex((a) => a.type === 'StringLiteral');
      if (firstString >= 0) {
        return {
          kind: 'call',
          value: args[firstString].value,
          node: args[firstString],
          callee: calleeName(expr.callee),
          call: expr,
        };
      }
      const firstTemplate = args.findIndex(
        (a) => a.type === 'TemplateLiteral' && a.expressions.length === 0
      );
      if (firstTemplate >= 0) {
        const q = args[firstTemplate].quasis[0];
        return {
          kind: 'call',
          value: q.value.cooked != null ? q.value.cooked : q.value.raw,
          node: args[firstTemplate],
          callee: calleeName(expr.callee),
          call: expr,
        };
      }
      // No literal to edit yet — a new leading string argument can be added.
      return {
        kind: 'call-empty',
        value: '',
        node: expr,
        callee: calleeName(expr.callee),
        call: expr,
      };
    }
  }

  return { kind: 'expression', value: null, node: attr.value };
}

const EDITABLE_KINDS = new Set(['string', 'template', 'call', 'call-empty', 'none', 'boolean']);

function isEditableKind(kind) {
  return EDITABLE_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function buildFramelabId(node, filePath) {
  const tag = getTagName(node);
  const line = node.loc.start.line;
  const startChar =
    typeof node.start === 'number' ? node.start : node.loc.start.column;
  return `${tag}|${filePath}|${line}|${startChar}`;
}

function parseFramelabId(id) {
  const idx1 = id.indexOf('|');
  const idx3 = id.lastIndexOf('|');
  const idx2 = id.lastIndexOf('|', idx3 - 1);
  if (idx1 < 0 || idx2 < 0 || idx3 < 0) {
    throw new Error(`Invalid framelabId: ${id}`);
  }
  return {
    tagName: id.slice(0, idx1),
    filePath: id.slice(idx1 + 1, idx2),
    line: Number(id.slice(idx2 + 1, idx3)),
    startChar: Number(id.slice(idx3 + 1)),
  };
}

function isElementNode(n) {
  return n && (n.type === 'JSXElement' || n.type === 'JSXFragment');
}

// A structural path ("2.0.1") that survives className and text edits — those
// change byte offsets and line numbers but never the shape of the tree. The
// canvas uses it to keep the current selection alive across its own writes.
function buildStableKeys(ast) {
  const keys = new Map();
  const roots = [];

  traverse(ast, {
    'JSXElement|JSXFragment'(path) {
      const parent = path.parentPath ? path.parentPath.node : null;
      if (!isElementNode(parent)) roots.push(path.node);
    },
  });
  roots.sort((a, b) => a.start - b.start);

  const walk = (node, prefix) => {
    keys.set(node, prefix);
    const children = (node.children || []).filter(isElementNode);
    children.forEach((child, i) => walk(child, `${prefix}.${i}`));
  };
  roots.forEach((root, i) => walk(root, String(i)));
  return keys;
}

// ---------------------------------------------------------------------------
// Children / text
// ---------------------------------------------------------------------------

function classifyChildren(jsxElement) {
  const children = jsxElement.children || [];
  if (children.length === 0) return { kind: 'empty', value: null, textNodes: [] };

  let hasExpression = false;
  let hasNested = false;
  const textNodes = [];

  for (const c of children) {
    if (c.type === 'JSXText') textNodes.push(c);
    else if (c.type === 'JSXExpressionContainer') {
      if (c.expression && c.expression.type !== 'JSXEmptyExpression') hasExpression = true;
    } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') {
      hasNested = true;
    } else if (c.type === 'JSXSpreadChild') {
      hasExpression = true;
    }
  }

  if (hasExpression) return { kind: 'expression', value: null, textNodes };
  if (hasNested) return { kind: 'children', value: null, textNodes };

  const combined = textNodes.map((t) => t.value).join('');
  const trimmed = combined.trim();
  if (!trimmed) return { kind: 'empty', value: null, textNodes };
  return { kind: 'text', value: trimmed, textNodes };
}

// JSX text is not a string literal: `{`, `}`, `<` and `>` are syntax. Text
// containing them has to be written as an expression container instead, or the
// file stops parsing the moment someone types a brace.
const JSX_UNSAFE = /[{}<>]/;
function encodeJsxText(text) {
  const s = String(text == null ? '' : text);
  if (!JSX_UNSAFE.test(s)) return s;
  return '{' + JSON.stringify(s) + '}';
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractElements(filePath, sourceOverride) {
  const code = sourceOverride !== undefined ? sourceOverride : readSource(filePath);
  const ast = parseCode(code);
  const stableKeys = buildStableKeys(ast);
  const elements = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      if (isFragment(opening)) return;

      const framelabId = buildFramelabId(opening, filePath);
      const classNameAttr = findClassNameAttr(opening);
      const cls = classSurface(classNameAttr, code);
      const text = classifyChildren(path.node);

      // Nearest ancestor that is itself a tagged element (fragments are
      // transparent, matching what the canvas sees in the DOM).
      let parentId = null;
      let p = path.parentPath;
      while (p) {
        if (p.node.type === 'JSXElement' && p.node.openingElement &&
            !isFragment(p.node.openingElement) && p.node.openingElement.loc) {
          parentId = buildFramelabId(p.node.openingElement, filePath);
          break;
        }
        if (p.node.type !== 'JSXElement' && p.node.type !== 'JSXFragment') break;
        p = p.parentPath;
      }

      const stableKey = stableKeys.get(path.node) || null;

      elements.push({
        framelabId,
        stableKey,
        parentId,
        depth: stableKey ? stableKey.split('.').length - 1 : 0,
        tagName: getTagName(opening),
        line: opening.loc.start.line,
        column: opening.loc.start.column,
        startChar:
          typeof opening.start === 'number' ? opening.start : opening.loc.start.column,
        className: cls.value,
        classNameKind: cls.kind,
        classNameEditable: isEditableKind(cls.kind),
        classNameHelper: cls.callee || null,
        classNameDynamic: cls.dynamicParts || null,
        selfClosing: !!opening.selfClosing,
        textContent: text.value,
        textKind: text.kind,
      });
    },
  });

  return { code, elements };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

// Resolution order: exact byte offset, then structural key, then tag+line.
// The fallbacks matter because the canvas holds an id captured before an edit
// shifted every offset after it.
function findElementByFramelabId(filePath, framelabId, sourceOverride, opts) {
  const { tagName, startChar, line } = parseFramelabId(framelabId);
  const code = sourceOverride !== undefined ? sourceOverride : readSource(filePath);
  const ast = parseCode(code);
  const stableKey = opts && opts.stableKey;
  const stableKeys = stableKey ? buildStableKeys(ast) : null;

  let exact = null;
  let byStableKey = null;
  let byLineAndTag = null;

  traverse(ast, {
    JSXElement(path) {
      if (exact) return;
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      const t = getTagName(opening);
      if (opening.start === startChar && t === tagName) {
        exact = { node: opening, element: path.node, code, ast };
        return;
      }
      if (stableKeys && !byStableKey && stableKeys.get(path.node) === stableKey) {
        byStableKey = { node: opening, element: path.node, code, ast };
      }
      if (t !== tagName) return;
      if (!byLineAndTag && opening.loc.start.line === line) {
        byLineAndTag = { node: opening, element: path.node, code, ast };
      }
    },
  });

  return exact || byStableKey || byLineAndTag;
}

function getClassName(filePath, framelabId, opts) {
  const found = findElementByFramelabId(filePath, framelabId, undefined, opts);
  if (!found) return { found: false };
  const attr = findClassNameAttr(found.node);
  const cls = classSurface(attr, found.code);
  return {
    found: true,
    kind: cls.kind,
    editable: isEditableKind(cls.kind),
    className: cls.value,
    dynamicParts: cls.dynamicParts || null,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

// Never hand back a file that stopped parsing. A refused write leaves the
// source untouched, which is strictly better than a corrupt buffer the user
// discovers when their dev server explodes.
function writeChecked(filePath, code, updated) {
  try {
    parser.parse(updated, { ...PARSE_OPTIONS, errorRecovery: false });
  } catch (err) {
    return { ok: false, reason: 'would-not-parse', detail: err.message };
  }
  fs.writeFileSync(filePath, updated, 'utf8');
  return { ok: true };
}

function updateClassName(filePath, framelabId, newClassName, opts) {
  const code = readSource(filePath);
  const found = findElementByFramelabId(filePath, framelabId, code, opts);
  if (!found) return { ok: false, reason: 'element-not-found' };

  const attr = findClassNameAttr(found.node);
  const cls = classSurface(attr, code);

  if (!isEditableKind(cls.kind)) {
    return { ok: false, reason: 'className-not-static' };
  }

  const next = String(newClassName == null ? '' : newClassName).trim();
  let updated;

  if (cls.kind === 'string') {
    const literal =
      cls.context === 'jsx-attr' ? jsxAttributeLiteral(next) : JSON.stringify(next);
    updated = code.slice(0, cls.node.start) + literal + code.slice(cls.node.end);
  } else if (cls.kind === 'template') {
    const rebuilt = rebuildTemplate(next, cls.dynamicParts || []);
    updated = code.slice(0, cls.node.start) + rebuilt + code.slice(cls.node.end);
  } else if (cls.kind === 'call') {
    updated = code.slice(0, cls.node.start) + JSON.stringify(next) + code.slice(cls.node.end);
  } else if (cls.kind === 'call-empty') {
    // Insert as the FIRST argument: helpers like twMerge let later arguments
    // win, so base classes belong at the front.
    const call = cls.call;
    const insertAt = call.arguments.length
      ? call.arguments[0].start
      : code.indexOf('(', call.callee.end) + 1;
    const suffix = call.arguments.length ? ', ' : '';
    updated = code.slice(0, insertAt) + JSON.stringify(next) + suffix + code.slice(insertAt);
  } else {
    // No className attribute yet — add one right after the tag name.
    const insertAt = found.node.name.end;
    updated =
      code.slice(0, insertAt) + ` className=${jsxAttributeLiteral(next)}` + code.slice(insertAt);
  }

  const written = writeChecked(filePath, code, updated);
  if (!written.ok) return written;

  return {
    ok: true,
    previous: cls.value,
    next,
    kind: cls.kind,
    bytesBefore: code.length,
    bytesAfter: updated.length,
  };
}

function getTextContent(filePath, framelabId, opts) {
  const found = findElementByFramelabId(filePath, framelabId, undefined, opts);
  if (!found) return { found: false };
  const text = classifyChildren(found.element);
  return { found: true, kind: text.kind, value: text.value };
}

function updateTextContent(filePath, framelabId, newText, opts) {
  const code = readSource(filePath);
  const found = findElementByFramelabId(filePath, framelabId, code, opts);
  if (!found) return { ok: false, reason: 'element-not-found' };

  const text = classifyChildren(found.element);
  if (text.kind === 'expression') return { ok: false, reason: 'has-expression-children' };
  if (text.kind === 'children') return { ok: false, reason: 'has-nested-element-children' };

  const replacement = encodeJsxText(newText);
  const element = found.element;

  if (text.textNodes.length === 0) {
    if (element.openingElement && element.openingElement.selfClosing) {
      return { ok: false, reason: 'self-closing-element' };
    }
    if (!element.closingElement) return { ok: false, reason: 'no-closing-tag' };
    const insertAt = element.openingElement.end;
    const updated = code.slice(0, insertAt) + replacement + code.slice(insertAt);
    const written = writeChecked(filePath, code, updated);
    if (!written.ok) return written;
    return { ok: true, previous: '', next: String(newText == null ? '' : newText) };
  }

  const first = text.textNodes[0];
  const last = text.textNodes[text.textNodes.length - 1];
  const original = code.slice(first.start, last.end);
  const leading = (original.match(/^\s*/) || [''])[0];
  const trailing = (original.match(/\s*$/) || [''])[0];

  const updated =
    code.slice(0, first.start) + leading + replacement + trailing + code.slice(last.end);
  const written = writeChecked(filePath, code, updated);
  if (!written.ok) return written;
  return { ok: true, previous: original.trim(), next: String(newText == null ? '' : newText) };
}

// ---------------------------------------------------------------------------
// Structural moves
// ---------------------------------------------------------------------------

function isCommentChild(node) {
  return node &&
    node.type === 'JSXExpressionContainer' &&
    node.expression &&
    node.expression.type === 'JSXEmptyExpression';
}

function isWhitespaceText(node) {
  return node && node.type === 'JSXText' && !node.value.trim();
}

// A leading comment belongs to the element it introduces. Reordering elements
// while leaving comments pinned to their old slot silently re-labels the code
// — `{/* Hero */}` ends up above a completely different section. Group each
// element with the comment (and the whitespace between them) that precedes it,
// and move the whole block.
function blockForElement(children, elemIndex) {
  let start = elemIndex;
  let cursor = elemIndex - 1;
  if (isWhitespaceText(children[cursor]) && isCommentChild(children[cursor - 1])) {
    cursor -= 1;
  }
  if (isCommentChild(children[cursor])) {
    // Keep the blank line that separates this block from the previous one
    // outside the block, so spacing stays where the author put it.
    start = cursor;
  }
  return { start, end: elemIndex };
}

function reorderSiblings(code, parent, sourceNode, targetNode, position) {
  let regionStart, regionEnd;
  if (parent.type === 'JSXElement') {
    if (!parent.openingElement || !parent.closingElement) return null;
    regionStart = parent.openingElement.end;
    regionEnd = parent.closingElement.start;
  } else if (parent.type === 'JSXFragment') {
    regionStart = parent.openingFragment.end;
    regionEnd = parent.closingFragment.start;
  } else {
    return null;
  }

  const children = parent.children || [];
  const elemNodes = children.filter(isElementNode);

  const srcIdx = elemNodes.indexOf(sourceNode);
  const tgtIdx = elemNodes.indexOf(targetNode);
  if (srcIdx < 0 || tgtIdx < 0) return null;

  const newOrder = elemNodes.slice();
  newOrder.splice(srcIdx, 1);
  let insertAt = position === 'before' ? tgtIdx : tgtIdx + 1;
  if (srcIdx < tgtIdx) insertAt -= 1;
  newOrder.splice(insertAt, 0, sourceNode);

  if (newOrder.every((n, i) => n === elemNodes[i])) return code;

  // Each element's movable block, keyed by the element node.
  const blocks = new Map();
  const consumed = new Set();
  children.forEach((child, i) => {
    if (!isElementNode(child)) return;
    const block = blockForElement(children, i);
    blocks.set(child, block);
    for (let j = block.start; j < block.end; j++) consumed.add(j);
  });

  const textOf = (block) =>
    code.slice(children[block.start].start, children[block.end].end);

  let rebuilt = '';
  let elemPtr = 0;
  for (let i = 0; i < children.length; i++) {
    if (consumed.has(i)) continue; // emitted as part of its element's block
    const child = children[i];
    if (isElementNode(child)) {
      rebuilt += textOf(blocks.get(newOrder[elemPtr++]));
    } else {
      rebuilt += code.slice(child.start, child.end);
    }
  }

  return code.slice(0, regionStart) + rebuilt + code.slice(regionEnd);
}

function moveElement(filePath, sourceId, targetId, position, opts) {
  if (position !== 'before' && position !== 'after') {
    return { ok: false, reason: 'invalid-position' };
  }
  if (sourceId === targetId) return { ok: false, reason: 'cannot-move-onto-self' };

  const code = readSource(filePath);
  const ast = parseCode(code);
  const stableKeys = buildStableKeys(ast);

  // The canvas holds ids captured from the rendered DOM, which go stale the
  // moment an earlier edit shifts byte offsets. Fall back to the structural key
  // and then to tag+line, exactly as single-element lookups do — otherwise a
  // drag right after a style tweak fails with an unexplained conflict.
  const candidates = [];
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      candidates.push({
        node: path.node,
        parent: path.parentPath ? path.parentPath.node : null,
        id: buildFramelabId(opening, filePath),
        stableKey: stableKeys.get(path.node) || null,
        tagName: getTagName(opening),
        line: opening.loc.start.line,
      });
    },
  });

  const resolve = (id, stableKey) => {
    const exact = candidates.find((c) => c.id === id);
    if (exact) return exact;
    if (stableKey) {
      const byKey = candidates.find((c) => c.stableKey === stableKey);
      if (byKey) return byKey;
    }
    const parsed = (() => {
      try { return parseFramelabId(id); } catch { return null; }
    })();
    if (!parsed) return null;
    return candidates.find((c) => c.tagName === parsed.tagName && c.line === parsed.line) || null;
  };

  const sourceMatch = resolve(sourceId, opts && opts.sourceKey);
  const targetMatch = resolve(targetId, opts && opts.targetKey);

  const found = {
    source: sourceMatch ? sourceMatch.node : null,
    target: targetMatch ? targetMatch.node : null,
  };
  const parents = {
    source: sourceMatch ? sourceMatch.parent : null,
    target: targetMatch ? targetMatch.parent : null,
  };

  if (!found.source) return { ok: false, reason: 'source-not-found' };
  if (!found.target) return { ok: false, reason: 'target-not-found' };
  if (found.source === found.target) return { ok: false, reason: 'cannot-move-onto-self' };
  if (!parents.source || !parents.source.children) return { ok: false, reason: 'invalid-parent' };
  if (parents.source !== parents.target) return { ok: false, reason: 'cross-parent-not-supported' };

  let sourceContainsTarget = false;
  traverse(ast, {
    JSXElement(path) {
      if (sourceContainsTarget) return;
      if (path.node === found.source) {
        path.traverse({
          JSXElement(inner) {
            if (inner.node === found.target) sourceContainsTarget = true;
          },
        });
      }
    },
  });
  if (sourceContainsTarget) return { ok: false, reason: 'cannot-move-into-self' };

  const updated = reorderSiblings(code, parents.source, found.source, found.target, position);
  if (updated === null) return { ok: false, reason: 'reorder-failed' };
  if (updated === code) return { ok: true, noChange: true };

  const written = writeChecked(filePath, code, updated);
  if (!written.ok) return written;

  return { ok: true, bytesBefore: code.length, bytesAfter: updated.length };
}

// ---------------------------------------------------------------------------
// Delete / restore
// ---------------------------------------------------------------------------

// An element written on its own line owns the line break and indentation that
// introduce it. Removing the node alone would leave a blank, space-filled line
// behind, so extend the cut back over that whitespace when it is the only thing
// between the element and the previous line.
function cutRangeFor(code, node) {
  let start = node.start;
  const end = node.end;
  let i = start - 1;
  while (i >= 0 && (code[i] === ' ' || code[i] === '\t')) i--;
  if (i >= 0 && code[i] === '\n') start = i;
  return { start, end };
}

// The indentation of the line the node starts on, used to re-insert it later.
function indentOf(code, node) {
  let i = node.start - 1;
  let indent = '';
  while (i >= 0 && (code[i] === ' ' || code[i] === '\t')) {
    indent = code[i] + indent;
    i--;
  }
  return (i >= 0 && code[i] === '\n') ? indent : '';
}

function elementChildrenOf(node) {
  return (node.children || []).filter(isElementNode);
}

function findByIdOrKey(candidates, id, stableKey) {
  const exact = candidates.find((c) => c.id === id);
  if (exact) return exact;
  if (stableKey) {
    const byKey = candidates.find((c) => c.stableKey === stableKey);
    if (byKey) return byKey;
  }
  let parsed = null;
  try { parsed = parseFramelabId(id); } catch { parsed = null; }
  if (!parsed) return null;
  return candidates.find((c) => c.tagName === parsed.tagName && c.line === parsed.line) || null;
}

function collectCandidates(ast, filePath, stableKeys) {
  const candidates = [];
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      candidates.push({
        node: path.node,
        parent: path.parentPath ? path.parentPath.node : null,
        id: buildFramelabId(opening, filePath),
        stableKey: stableKeys.get(path.node) || null,
        tagName: getTagName(opening),
        line: opening.loc.start.line,
      });
    },
  });
  return candidates;
}

/**
 * Remove an element and everything it contains.
 *
 * Returns the removed source text along with where it sat, which is exactly
 * what `insertElement` needs to put it back — so a delete is undoable without
 * ever handing the server a whole-file write.
 */
function deleteElement(filePath, framelabId, opts) {
  const code = readSource(filePath);
  const ast = parseCode(code);
  const stableKeys = buildStableKeys(ast);
  const candidates = collectCandidates(ast, filePath, stableKeys);

  const match = findByIdOrKey(candidates, framelabId, opts && opts.stableKey);
  if (!match) return { ok: false, reason: 'element-not-found' };

  const parent = match.parent;
  if (!isElementNode(parent)) {
    // The outermost element of a return expression: removing it leaves the
    // component returning nothing. Say so plainly instead of writing a file
    // that will not parse.
    return { ok: false, reason: 'cannot-delete-root' };
  }

  const siblings = elementChildrenOf(parent);
  const index = siblings.indexOf(match.node);
  if (index < 0) return { ok: false, reason: 'element-not-in-parent' };

  const { start, end } = cutRangeFor(code, match.node);
  const removed = code.slice(match.node.start, match.node.end);
  const updated = code.slice(0, start) + code.slice(end);

  const written = writeChecked(filePath, code, updated);
  if (!written.ok) return written;

  return {
    ok: true,
    removed,
    parentKey: stableKeys.get(parent) || null,
    index,
    tagName: match.tagName,
    bytesBefore: code.length,
    bytesAfter: updated.length,
  };
}

/**
 * Put an element back as child `index` of the element with `parentKey`.
 * Used to undo a delete; the source text is re-indented to match its
 * neighbours so the restored file matches the original byte for byte.
 */
function insertElement(filePath, parentKey, index, source) {
  const text = String(source == null ? '' : source).trim();
  if (!text) return { ok: false, reason: 'empty-source' };

  const code = readSource(filePath);
  const ast = parseCode(code);
  const stableKeys = buildStableKeys(ast);

  let parent = null;
  for (const [node, key] of stableKeys.entries()) {
    if (key === parentKey) { parent = node; break; }
  }
  if (!parent) return { ok: false, reason: 'parent-not-found' };
  if (!isElementNode(parent)) return { ok: false, reason: 'invalid-parent' };

  const siblings = elementChildrenOf(parent);
  const at = Math.max(0, Math.min(Number(index) || 0, siblings.length));

  let insertPos;
  let indent;
  if (siblings.length === 0) {
    // No element children to anchor against: drop it just inside the parent.
    if (parent.type === 'JSXElement') {
      if (!parent.openingElement || !parent.closingElement) {
        return { ok: false, reason: 'no-children-region' };
      }
      insertPos = parent.openingElement.end;
    } else {
      insertPos = parent.openingFragment.end;
    }
    indent = indentOf(code, parent) + '  ';
  } else if (at < siblings.length) {
    const next = siblings[at];
    indent = indentOf(code, next);
    insertPos = cutRangeFor(code, next).start;
  } else {
    const prev = siblings[siblings.length - 1];
    indent = indentOf(code, prev);
    insertPos = prev.end;
  }

  const updated =
    code.slice(0, insertPos) + '\n' + indent + text + code.slice(insertPos);

  const written = writeChecked(filePath, code, updated);
  if (!written.ok) return written;

  return { ok: true, bytesBefore: code.length, bytesAfter: updated.length };
}

module.exports = {
  extractElements,
  getClassName,
  updateClassName,
  getTextContent,
  updateTextContent,
  moveElement,
  deleteElement,
  insertElement,
  parseFramelabId,
  buildFramelabId,
  classSurface,
  encodeJsxText,
  jsxAttributeLiteral,
  rebuildTemplate,
  isEditableKind,
  CLASS_HELPERS,
};
