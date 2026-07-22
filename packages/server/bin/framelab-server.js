#!/usr/bin/env node
'use strict';

const path = require('path');
const { createSyncServer } = require('../src/syncServer');

const rootArg = process.argv[2];
const rootDir = rootArg ? path.resolve(rootArg) : process.cwd();
const port = Number(process.env.FRAMELAB_PORT) || 3131;
const canvasPort = Number(process.env.FRAMELAB_CANVAS_PORT) || 3133;

const server = createSyncServer({ rootDir, port, canvasPort });
server.listen().then(() => {
  console.log(`[framelab] api+ws listening on http://localhost:${port}`);
  console.log(`[framelab] canvas    on   http://localhost:${canvasPort}`);
  console.log(`[framelab] watching ${rootDir}`);
});
