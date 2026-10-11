'use strict';

// The Babel path needs the runtime as a *string* so it can be parsed and
// inlined into the entry file. The bundler path needs it as a *module*. Rather
// than keep two copies in step, client.js is the source of truth and this
// reads it back off disk — the plugin only ever runs in Node, so it can.

const fs = require('fs');
const path = require('path');

const CLIENT_FILE = path.join(__dirname, 'client.js');

// Strip the leading 'use strict' and the file's own comments: what the plugin
// unshifts into a program body should be the IIFE and nothing else.
function readRuntimeSource() {
  const body = fs.readFileSync(CLIENT_FILE, 'utf8');
  const start = body.indexOf('(function(){');
  if (start === -1) {
    throw new Error('framelab: client.js no longer starts with the runtime IIFE');
  }
  return body.slice(start).trim();
}

const RUNTIME_SOURCE = readRuntimeSource();

module.exports = { RUNTIME_SOURCE, CLIENT_FILE };
