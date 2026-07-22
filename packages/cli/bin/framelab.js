#!/usr/bin/env node
'use strict';

const { run } = require('../src');

run(process.argv.slice(2)).catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
