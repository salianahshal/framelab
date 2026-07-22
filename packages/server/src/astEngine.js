'use strict';

const fs = require('fs');
const parser = require('@babel/parser');
const traverseImport = require('@babel/traverse');
const traverse = traverseImport.default || traverseImport;

const PARSE_OPTIONS = {
  sourceType: 'module',
  plugins: ['jsx', 'typescript'],
  errorRecovery: true,
  ranges: true,
  tokens: false,
};

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
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

function classifyClassName(attr) {
  if (!attr) return { kind: 'none', value: null };
  if (!attr.value) return { kind: 'boolean', value: null };
  if (attr.value.type === 'StringLiteral') {
    return { kind: 'string', value: attr.value.value, node: attr.value };
  }
  if (
    attr.value.type === 'JSXExpressionContainer' &&
    attr.value.expression.type === 'StringLiteral'
  ) {
    return {
      kind: 'string',
      value: attr.value.expression.value,
      node: attr.value.expression,
    };
  }
  return { kind: 'expression', value: null, node: attr.value };
}

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

function classifyChildren(jsxElement) {
  const children = jsxElement.children || [];
  if (children.length === 0) return { kind: 'empty', value: null, textNodes: [] };

  let hasExpression = false;
  let hasNested = false;
  const textNodes = [];

  for (const c of children) {
    if (c.type === 'JSXText') textNodes.push(c);
    else if (c.type === 'JSXExpressionContainer') {
      // Pure {/* comment */} expression containers don't really count
      if (
        c.expression &&
        c.expression.type !== 'JSXEmptyExpression'
      ) hasExpression = true;
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

function extractElements(filePath, sourceOverride) {
  const code = sourceOverride !== undefined ? sourceOverride : readSource(filePath);
  const ast = parser.parse(code, PARSE_OPTIONS);
  const elements = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      if (isFragment(opening)) return;

      const framelabId = buildFramelabId(opening, filePath);
      const classNameAttr = findClassNameAttr(opening);
      const cls = classifyClassName(classNameAttr);
      const text = classifyChildren(path.node);

      elements.push({
        framelabId,
        tagName: getTagName(opening),
        line: opening.loc.start.line,
        startChar:
          typeof opening.start === 'number' ? opening.start : opening.loc.start.column,
        className: cls.value,
        classNameKind: cls.kind,
        textContent: text.value,
        textKind: text.kind,
      });
    },
  });

  return { code, elements };
}

function findElementByFramelabId(filePath, framelabId, sourceOverride) {
  const { tagName, startChar, line } = parseFramelabId(framelabId);
  const code = sourceOverride !== undefined ? sourceOverride : readSource(filePath);
  const ast = parser.parse(code, PARSE_OPTIONS);

  let exact = null;
  let byLineAndTag = null;

  traverse(ast, {
    JSXElement(path) {
      if (exact) return;
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      const t = getTagName(opening);
      if (t !== tagName) return;
      if (opening.start === startChar) {
        exact = { node: opening, element: path.node, code, ast };
        return;
      }
      if (!byLineAndTag && opening.loc.start.line === line) {
        byLineAndTag = { node: opening, element: path.node, code, ast };
      }
    },
  });

  return exact || byLineAndTag;
}

function getClassName(filePath, framelabId) {
  const found = findElementByFramelabId(filePath, framelabId);
  if (!found) return { found: false };
  const attr = findClassNameAttr(found.node);
  const cls = classifyClassName(attr);
  return { found: true, kind: cls.kind, className: cls.value };
}

function updateClassName(filePath, framelabId, newClassName) {
  const code = readSource(filePath);
  const found = findElementByFramelabId(filePath, framelabId, code);
  if (!found) {
    return { ok: false, reason: 'element-not-found' };
  }
  const attr = findClassNameAttr(found.node);
  const cls = classifyClassName(attr);

  if (cls.kind === 'expression') {
    return { ok: false, reason: 'className-not-static' };
  }

  const replacement = JSON.stringify(newClassName);

  let updated;
  if (cls.kind === 'string') {
    const valueStart = attr.value.start;
    const valueEnd = attr.value.end;
    updated = code.slice(0, valueStart) + replacement + code.slice(valueEnd);
  } else {
    const insertAt = found.node.name.end;
    updated =
      code.slice(0, insertAt) + ` className=${replacement}` + code.slice(insertAt);
  }

  fs.writeFileSync(filePath, updated, 'utf8');
  return {
    ok: true,
    previous: cls.value,
    next: newClassName,
    bytesBefore: code.length,
    bytesAfter: updated.length,
  };
}

function getTextContent(filePath, framelabId) {
  const found = findElementByFramelabId(filePath, framelabId);
  if (!found) return { found: false };
  const text = classifyChildren(found.element);
  return { found: true, kind: text.kind, value: text.value };
}

function updateTextContent(filePath, framelabId, newText) {
  const code = readSource(filePath);
  const found = findElementByFramelabId(filePath, framelabId, code);
  if (!found) return { ok: false, reason: 'element-not-found' };

  const text = classifyChildren(found.element);
  if (text.kind === 'expression') {
    return { ok: false, reason: 'has-expression-children' };
  }
  if (text.kind === 'children') {
    return { ok: false, reason: 'has-nested-element-children' };
  }

  const replacement = String(newText == null ? '' : newText);
  const element = found.element;

  // No existing children (self-closing or empty pair) — synthesize between tags.
  if (text.textNodes.length === 0) {
    if (element.openingElement && element.openingElement.selfClosing) {
      return { ok: false, reason: 'self-closing-element' };
    }
    if (!element.closingElement) {
      return { ok: false, reason: 'no-closing-tag' };
    }
    const insertAt = element.openingElement.end;
    const updated =
      code.slice(0, insertAt) + replacement + code.slice(insertAt);
    fs.writeFileSync(filePath, updated, 'utf8');
    return { ok: true, previous: '', next: replacement };
  }

  const first = text.textNodes[0];
  const last = text.textNodes[text.textNodes.length - 1];
  const original = code.slice(first.start, last.end);
  const leadingMatch = original.match(/^\s*/);
  const trailingMatch = original.match(/\s*$/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch ? trailingMatch[0] : '';

  const replaced = leading + replacement + trailing;
  const updated = code.slice(0, first.start) + replaced + code.slice(last.end);
  fs.writeFileSync(filePath, updated, 'utf8');
  return { ok: true, previous: original.trim(), next: replacement };
}

function findJSXElementWithParent(filePath, framelabId, sourceOverride) {
  const { tagName, startChar, line } = parseFramelabId(framelabId);
  const code = sourceOverride !== undefined ? sourceOverride : readSource(filePath);
  const ast = parser.parse(code, PARSE_OPTIONS);

  let exact = null;
  let byLineAndTag = null;

  traverse(ast, {
    JSXElement(path) {
      if (exact) return;
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      const t = getTagName(opening);
      if (t !== tagName) return;
      const parent = path.parentPath ? path.parentPath.node : null;
      if (opening.start === startChar) {
        exact = { node: path.node, parent, code, ast };
        return;
      }
      if (!byLineAndTag && opening.loc.start.line === line) {
        byLineAndTag = { node: path.node, parent, code, ast };
      }
    },
  });

  return exact || byLineAndTag;
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
  const elemNodes = children.filter(
    (c) => c.type === 'JSXElement' || c.type === 'JSXFragment'
  );

  const srcIdx = elemNodes.indexOf(sourceNode);
  const tgtIdx = elemNodes.indexOf(targetNode);
  if (srcIdx < 0 || tgtIdx < 0) return null;

  const newOrder = elemNodes.slice();
  newOrder.splice(srcIdx, 1);
  let insertAt = position === 'before' ? tgtIdx : tgtIdx + 1;
  if (srcIdx < tgtIdx) insertAt -= 1;
  newOrder.splice(insertAt, 0, sourceNode);

  if (
    newOrder.length === elemNodes.length &&
    newOrder.every((n, i) => n === elemNodes[i])
  ) {
    return code;
  }

  let rebuilt = '';
  let elemPtr = 0;
  for (const child of children) {
    if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
      const replacement = newOrder[elemPtr++];
      rebuilt += code.slice(replacement.start, replacement.end);
    } else {
      rebuilt += code.slice(child.start, child.end);
    }
  }

  return code.slice(0, regionStart) + rebuilt + code.slice(regionEnd);
}

function moveElement(filePath, sourceId, targetId, position) {
  if (position !== 'before' && position !== 'after') {
    return { ok: false, reason: 'invalid-position' };
  }
  if (sourceId === targetId) {
    return { ok: false, reason: 'cannot-move-onto-self' };
  }

  const code = readSource(filePath);
  const ast = parser.parse(code, PARSE_OPTIONS);

  const ids = { source: sourceId, target: targetId };
  const found = { source: null, target: null };
  const parents = { source: null, target: null };

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!opening || !opening.loc) return;
      const id = buildFramelabId(opening, filePath);
      for (const key of ['source', 'target']) {
        if (id === ids[key] && !found[key]) {
          found[key] = path.node;
          parents[key] = path.parentPath ? path.parentPath.node : null;
        }
      }
    },
  });

  if (!found.source) return { ok: false, reason: 'source-not-found' };
  if (!found.target) return { ok: false, reason: 'target-not-found' };
  if (!parents.source || !parents.source.children) {
    return { ok: false, reason: 'invalid-parent' };
  }
  if (parents.source !== parents.target) {
    return { ok: false, reason: 'cross-parent-not-supported' };
  }

  // Refuse if source contains target (would corrupt the file)
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
  if (sourceContainsTarget) {
    return { ok: false, reason: 'cannot-move-into-self' };
  }

  const updated = reorderSiblings(
    code,
    parents.source,
    found.source,
    found.target,
    position
  );
  if (updated === null) return { ok: false, reason: 'reorder-failed' };
  if (updated === code) return { ok: true, noChange: true };

  fs.writeFileSync(filePath, updated, 'utf8');
  return {
    ok: true,
    bytesBefore: code.length,
    bytesAfter: updated.length,
  };
}

module.exports = {
  extractElements,
  getClassName,
  updateClassName,
  getTextContent,
  updateTextContent,
  moveElement,
  parseFramelabId,
  buildFramelabId,
};
