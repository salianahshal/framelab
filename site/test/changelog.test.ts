// The changelog parser is the only real logic on this site, and when it gets
// something wrong the page still renders — just with backticks showing through
// or a line quietly missing. That fails silently, so it gets tests.

import assert from 'assert';
import { parseInline, parseChangelog, readChangelog } from '../lib/changelog.ts';

let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  assert.deepStrictEqual(actual, expected,
    `${label}\n  got:  ${JSON.stringify(actual)}\n  want: ${JSON.stringify(expected)}`);
  passed++;
  console.log(`  ok  ${label}`);
}

function divider(label: string) {
  console.log(`\n=== ${label} ===`);
}

divider('inline');
check('plain text', parseInline('hello'), [{ type: 'text', value: 'hello' }]);

check('code span', parseInline('use `bg-brand` here'), [
  { type: 'text', value: 'use ' },
  { type: 'code', value: 'bg-brand' },
  { type: 'text', value: ' here' },
]);

// Markdown's escape for code that itself contains a backtick.
check('double-backtick span', parseInline('`` `p-4 ${x}` ``'), [
  { type: 'code', value: '`p-4 ${x}`' },
]);

// The bug this file exists for: backticks inside bold rendered literally.
check('code nested in strong', parseInline('**A `b` c.**'), [
  {
    type: 'strong',
    content: [
      { type: 'text', value: 'A ' },
      { type: 'code', value: 'b' },
      { type: 'text', value: ' c.' },
    ],
  },
]);

check('link', parseInline('see [docs](https://x.dev)'), [
  { type: 'text', value: 'see ' },
  { type: 'link', href: 'https://x.dev', content: [{ type: 'text', value: 'docs' }] },
]);

check('a lone asterisk is not emphasis', parseInline('2 * 3'), [
  { type: 'text', value: '2 * 3' },
]);

divider('document');
const doc = `# Changelog

Preamble that should not appear in any release.

## 1.1.0

### Added

Some prose that
wraps across lines.

- first bullet
- a bullet that wraps
  onto the next line

## 1.0.0

Initial release.
`;
const releases = parseChangelog(doc);

check('one entry per version', releases.map((r) => r.version), ['1.1.0', '1.0.0']);
check('the preamble is dropped', releases[0].sections[0].heading, 'Added');
check('soft-wrapped lines join into one paragraph',
  releases[0].sections[0].blocks[0],
  { type: 'paragraph', content: [{ type: 'text', value: 'Some prose that wraps across lines.' }] });

const list = releases[0].sections[0].blocks[1];
check('bullets are one list', list.type, 'list');
check('a wrapped bullet stays one item',
  list.type === 'list' ? list.items.length : -1, 2);
check('the continuation line is joined',
  list.type === 'list' ? list.items[1][0] : null,
  { type: 'text', value: 'a bullet that wraps onto the next line' });

check('a release with no ### still keeps its prose',
  releases[1].sections[0].heading, null);

divider('the real CHANGELOG.md');
const real = readChangelog();
check('every release has a version', real.every((r) => /^\d+\.\d+\.\d+$/.test(r.version)), true);
check('no release is empty', real.every((r) => r.sections.some((s) => s.blocks.length)), true);
// A stray backtick reaching the page means a code span did not close.
const text = JSON.stringify(real.map((r) => r.sections));
const strays = (text.match(/"type":"text","value":"[^"]*`/g) || []).length;
check('no unclosed code spans leak into text', strays, 0);

console.log(`\n${passed}/${passed} changelog parser tests passed`);
