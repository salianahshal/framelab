'use strict';

const { declare } = require('@babel/helper-plugin-utils');
const parser = require('@babel/parser');
const { RUNTIME_SOURCE } = require('./runtime');

const ATTR_NAME = 'data-framelab-id';

const DEFAULT_SKIP_PATTERNS = [
  /[\\/]node_modules[\\/]/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

const ENTRY_PATTERNS = [
  /(^|[\\/])pages[\\/]_app\.[jt]sx?$/,
  /(^|[\\/])src[\\/]pages[\\/]_app\.[jt]sx?$/,
];

function isEntryFile(filename, customPatterns) {
  const patterns = ENTRY_PATTERNS.concat(customPatterns || []);
  return patterns.some((p) => p.test(filename));
}

function clickRuntimeEnabled(options) {
  if (options && typeof options.injectClickRuntime === 'boolean') {
    return options.injectClickRuntime;
  }
  return process.env.NEXT_PUBLIC_FRAMELAB === 'true';
}

function shouldSkipFile(filename, extraSkipPatterns) {
  if (!filename) return true;
  const patterns = DEFAULT_SKIP_PATTERNS.concat(extraSkipPatterns || []);
  return patterns.some((p) => p.test(filename));
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

function hasFramelabId(openingElement) {
  return openingElement.attributes.some(
    (attr) =>
      attr.type === 'JSXAttribute' &&
      attr.name &&
      attr.name.type === 'JSXIdentifier' &&
      attr.name.name === ATTR_NAME
  );
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

module.exports = declare((api, options) => {
  api.assertVersion(7);
  const t = api.types;

  const extraSkipPatterns = (options && options.skip) || [];

  return {
    name: '@framelab/babel-plugin',
    visitor: {
      Program: {
        enter(path, state) {
          const filename =
            (state.file && state.file.opts && state.file.opts.filename) || '';
          if (!filename) return;
          if (shouldSkipFile(filename, extraSkipPatterns)) return;
          if (!isEntryFile(filename, options && options.entryPatterns)) return;
          if (!clickRuntimeEnabled(options)) return;
          if (state.file._framelabRuntimeInjected) return;
          state.file._framelabRuntimeInjected = true;

          const ast = parser.parse(RUNTIME_SOURCE, { sourceType: 'script' });
          path.unshiftContainer('body', ast.program.body);
        },
      },
      JSXOpeningElement(path, state) {
        const filename =
          (state.file && state.file.opts && state.file.opts.filename) || '';

        if (shouldSkipFile(filename, extraSkipPatterns)) return;

        const node = path.node;
        if (!node || !node.loc) return;
        if (isFragment(node)) return;
        if (hasFramelabId(node)) return;

        const tag = getTagName(node);
        const line = node.loc.start.line;
        const startChar =
          typeof node.start === 'number' ? node.start : node.loc.start.column;

        const id = `${tag}|${filename}|${line}|${startChar}`;

        const attribute = t.jsxAttribute(
          t.jsxIdentifier(ATTR_NAME),
          t.stringLiteral(id)
        );

        node.attributes.push(attribute);
      },
    },
  };
});
