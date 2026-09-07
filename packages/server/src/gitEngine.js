'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BUFFER = 16 * 1024 * 1024;

function runGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          err.gitArgs = args;
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

async function isGitRepo(cwd) {
  try {
    await runGit(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

// Show only paths under rootDir even when it's a sub-dir of a parent repo.
async function getStatus(rootDir) {
  if (!(await isGitRepo(rootDir))) return { initialized: false, files: [] };
  const out = await runGit(
    ['status', '--porcelain=v1', '-z', '--', '.'],
    rootDir
  );
  // -z separates entries with NUL. Each entry: "XY path"
  // Renames: "R  old\0new" — code is "R " + space + old, with new in next slot.
  const files = [];
  let i = 0;
  while (i < out.length) {
    if (out[i] === '\0') { i++; continue; }
    const xy = out.slice(i, i + 2);
    // skip "XY " (3 chars)
    let end = out.indexOf('\0', i + 3);
    if (end === -1) end = out.length;
    const filePart = out.slice(i + 3, end);
    files.push({ code: xy, path: filePart });
    i = end + 1;
    // Renamed/copied entries also include the original path in the next NUL slot
    if (xy.startsWith('R') || xy.startsWith('C')) {
      const oldEnd = out.indexOf('\0', i);
      i = (oldEnd === -1 ? out.length : oldEnd + 1);
    }
  }
  return { initialized: true, files };
}

async function getDiff(rootDir, opts = {}) {
  if (!(await isGitRepo(rootDir))) return { initialized: false, diff: '' };
  const ctx = opts.context || 3;
  const args = ['diff', '--no-color', '--unified=' + ctx, 'HEAD', '--', '.'];
  let diff = '';
  try {
    diff = await runGit(args, rootDir);
  } catch (err) {
    if (/unknown revision|bad revision|ambiguous argument 'HEAD'/.test(err.stderr || '')) {
      diff = await runGit(['diff', '--no-color', '--unified=' + ctx, '--', '.'], rootDir);
    } else {
      throw err;
    }
  }

  // `git diff HEAD` skips untracked files. Append a synthetic diff for each
  // untracked path so the panel can show their full content too.
  try {
    const untracked = await runGit(
      ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'],
      rootDir
    );
    const paths = untracked.split('\0').filter(Boolean);
    for (const rel of paths) {
      const abs = path.join(rootDir, rel);
      try {
        const content = fs.readFileSync(abs, 'utf8');
        const lines = content.split('\n');
        // Drop a trailing empty line caused by trailing newline so the count is honest
        const lastIsEmpty = lines.length && lines[lines.length - 1] === '';
        const counted = lastIsEmpty ? lines.slice(0, -1) : lines;
        const header =
          `diff --git a/${rel} b/${rel}\n` +
          `new file mode 100644\n` +
          `--- /dev/null\n` +
          `+++ b/${rel}\n` +
          `@@ -0,0 +1,${counted.length} @@\n`;
        const body = counted.map((l) => '+' + l).join('\n');
        diff += (diff.endsWith('\n') || !diff ? '' : '\n') + header + body + '\n';
      } catch {
        // binary or unreadable — skip
      }
    }
  } catch {}

  return { initialized: true, diff };
}

// Same symlink caveat as the sync server: a path that arrives in its resolved
// form (/private/var/...) must still be recognised as living inside a root
// given in its unresolved form (/var/...), or git gets a path outside the repo.
function realpathOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function relInside(rootDir, filePath) {
  const abs = path.resolve(filePath);
  const candidates = [
    [path.resolve(rootDir), abs],
    [realpathOrSelf(rootDir), realpathOrSelf(path.dirname(abs)) === path.dirname(abs)
      ? abs
      : path.join(realpathOrSelf(path.dirname(abs)), path.basename(abs))],
  ];
  for (const [root, target] of candidates) {
    const rel = path.relative(root, target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return null;
}

async function revertFile(rootDir, filePath) {
  const rel = relInside(rootDir, filePath);
  if (!rel) return { ok: false, reason: 'outside-root' };
  await runGit(['checkout', 'HEAD', '--', rel], rootDir);
  return { ok: true };
}

// Revert just one hunk inside a file's diff against HEAD. Approach:
// 1. Take the unified diff for that file.
// 2. Slice out the hunk at hunkIndex, keep the file headers.
// 3. Write that mini-patch to a temp file.
// 4. `git apply --reverse <patch>` against the working tree.
// Surrounding hunks stay applied; only the targeted hunk is undone.
async function revertHunk(rootDir, filePath, hunkIndex) {
  const rel = relInside(rootDir, filePath);
  if (!rel) return { ok: false, reason: 'outside-root' };
  if (typeof hunkIndex !== 'number' || hunkIndex < 0) {
    return { ok: false, reason: 'invalid-hunk-index' };
  }

  let fileDiff = '';
  try {
    fileDiff = await runGit(
      ['diff', '--no-color', '--unified=3', 'HEAD', '--', rel],
      rootDir
    );
  } catch (err) {
    return { ok: false, reason: 'diff-failed', detail: err.stderr || err.message };
  }
  if (!fileDiff.trim()) return { ok: false, reason: 'no-diff' };

  const lines = fileDiff.split('\n');
  const firstHunkLine = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunkLine < 0) return { ok: false, reason: 'no-hunks' };

  const headerLines = lines.slice(0, firstHunkLine);
  const hunkBoundaries = [];
  for (let i = firstHunkLine; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) hunkBoundaries.push(i);
  }
  hunkBoundaries.push(lines.length);

  if (hunkIndex >= hunkBoundaries.length - 1) {
    return { ok: false, reason: 'hunk-out-of-range', hunks: hunkBoundaries.length - 1 };
  }

  const start = hunkBoundaries[hunkIndex];
  const end = hunkBoundaries[hunkIndex + 1];
  const hunkLines = lines.slice(start, end);

  // Build a patch that includes only the file headers + this one hunk.
  // Trim trailing empty lines to avoid spurious blank lines at the end.
  while (hunkLines.length && hunkLines[hunkLines.length - 1] === '') {
    hunkLines.pop();
  }
  const patch = headerLines.concat(hunkLines).join('\n') + '\n';

  const tmpPath = path.join(
    os.tmpdir(),
    `framelab-revert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.patch`
  );
  fs.writeFileSync(tmpPath, patch);
  try {
    await runGit(['apply', '--reverse', '--', tmpPath], rootDir);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'apply-failed',
      detail: (err.stderr || err.message || '').trim(),
    };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

async function discardAll(rootDir) {
  if (!(await isGitRepo(rootDir))) return { ok: false, reason: 'not-a-repo' };
  await runGit(['checkout', 'HEAD', '--', '.'], rootDir);
  return { ok: true };
}

async function commit(rootDir, message, files) {
  if (!message || !String(message).trim()) {
    return { ok: false, reason: 'empty-message' };
  }
  const rels = (files || [])
    .map((f) => relInside(rootDir, f))
    .filter(Boolean);
  if (rels.length) {
    await runGit(['add', '--', ...rels], rootDir);
  } else {
    // stage everything under root
    await runGit(['add', '--', '.'], rootDir);
  }
  await runGit(['commit', '-m', String(message)], rootDir);
  const sha = (await runGit(['rev-parse', '--short', 'HEAD'], rootDir)).trim();
  return { ok: true, sha };
}

// Suggest a one-line commit message based on what changed. Hand-rolled so
// users get a clean default — no AI required.
async function suggestCommitMessage(rootDir) {
  const { files } = await getStatus(rootDir);
  if (!files.length) return '';
  if (files.length === 1) {
    const base = path.basename(files[0].path);
    return `style(${base}): visual edit`;
  }
  const baseNames = [...new Set(files.map((f) => path.basename(f.path)))];
  if (baseNames.length <= 3) return `style: edit ${baseNames.join(', ')}`;
  return `style: edit ${baseNames.length} files`;
}

module.exports = {
  isGitRepo,
  getStatus,
  getDiff,
  revertFile,
  revertHunk,
  discardAll,
  commit,
  suggestCommitMessage,
};
