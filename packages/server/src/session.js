'use strict';

// Session registry.
//
// `framelab` (the canvas) and `framelab mcp` are separate processes started in
// separate terminals. For an AI client to ask "what is the user pointing at?",
// the MCP process has to find the running canvas server first.
//
// Each sync server drops a small descriptor in the OS temp directory, keyed by
// a hash of the project root. Nothing is written into the user's project, so
// there is no stray file to gitignore and no risk of committing local state.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'framelab-sessions');

function keyFor(rootDir) {
  // Resolve through symlinks so /var and /private/var agree, the same reason
  // the path guards do.
  let resolved = path.resolve(rootDir);
  try { resolved = fs.realpathSync(resolved); } catch {}
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

function fileFor(rootDir) {
  return path.join(DIR, `${keyFor(rootDir)}.json`);
}

function write(rootDir, info) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(
      fileFor(rootDir),
      JSON.stringify({ ...info, rootDir: path.resolve(rootDir), pid: process.pid, startedAt: Date.now() }),
      'utf8'
    );
    return true;
  } catch {
    return false;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function read(rootDir) {
  try {
    const raw = fs.readFileSync(fileFor(rootDir), 'utf8');
    const info = JSON.parse(raw);
    if (!isAlive(info.pid)) {
      clear(rootDir);
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

function clear(rootDir) {
  try { fs.unlinkSync(fileFor(rootDir)); } catch {}
}

module.exports = { read, write, clear, fileFor, DIR };
