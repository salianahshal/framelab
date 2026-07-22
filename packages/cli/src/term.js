'use strict';

// Tiny terminal coloring helper — no chalk dependency. Auto-disables when
// stdout isn't a TTY (e.g. CI logs) or NO_COLOR is set.
const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const codes = {
  reset: 0,
  bold: 1, dim: 2, italic: 3, underline: 4,
  red: 31, green: 32, yellow: 33, blue: 34,
  magenta: 35, cyan: 36, gray: 90,
};

function color(name, str) {
  if (!enabled || !codes[name]) return String(str);
  return `\x1b[${codes[name]}m${str}\x1b[0m`;
}

const symbols = {
  ok: '✓',
  warn: '!',
  err: '✗',
  arrow: '→',
};

function ok(msg)   { console.log(color('green', symbols.ok) + ' ' + msg); }
function warn(msg) { console.log(color('yellow', symbols.warn) + ' ' + msg); }
function err(msg)  { console.error(color('red', symbols.err) + ' ' + msg); }
function info(msg) { console.log('  ' + color('dim', msg)); }
function hl(msg)   { return color('cyan', msg); }
function bold(msg) { return color('bold', msg); }
function dim(msg)  { return color('dim', msg); }

module.exports = { color, ok, warn, err, info, hl, bold, dim, symbols };
