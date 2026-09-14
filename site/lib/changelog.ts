/**
 * Reads the repository's CHANGELOG.md at build time.
 *
 * The file is the source of truth — it is what npm consumers see on GitHub —
 * so the site renders it rather than keeping a second copy that drifts. Parsing
 * is deliberately small: this is one file in one repository written in a house
 * style, not arbitrary markdown off the internet. Anything the parser doesn't
 * recognise falls through as a paragraph rather than disappearing.
 */
import fs from 'fs';
import path from 'path';

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; content: Inline[] }
  | { type: 'link'; content: Inline[]; href: string };

export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; items: Inline[][] };

export type Section = { heading: string | null; blocks: Block[] };
export type Release = { version: string; sections: Section[] };

/**
 * Split a line into text, `code`, **strong** and [links](href).
 *
 * Strong and link bodies are parsed recursively, because **bold with `code`
 * inside** is ordinary markdown and rendering its backticks literally looks
 * like a typo. Double-backtick spans come first: that is markdown's escape for
 * code that itself contains a backtick, which this changelog uses for template
 * literals.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /``(.+?)``|`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'code', value: m[1].trim() });
    else if (m[2] !== undefined) out.push({ type: 'code', value: m[2] });
    else if (m[3] !== undefined) out.push({ type: 'strong', content: parseInline(m[3]) });
    else out.push({ type: 'link', content: parseInline(m[4]), href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/**
 * Group lines into blocks. Consecutive non-blank lines are one paragraph —
 * markdown's soft-wrap rule — and `-` starts a list item that may itself wrap
 * onto indented continuation lines.
 */
function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (!items) return;
    blocks.push({ type: 'list', items: items.map((i) => parseInline(i)) });
    items = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!items) items = [];
      items.push(bullet[1]);
      continue;
    }
    if (items) {
      // An indented line after a bullet continues that bullet.
      if (/^\s+/.test(raw)) {
        items[items.length - 1] += ' ' + line.trim();
        continue;
      }
      flushList();
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Parse the whole document into releases, each with its `###` sections. */
export function parseChangelog(markdown: string): Release[] {
  const lines = markdown.split('\n');
  const releases: Release[] = [];
  let release: Release | null = null;
  let heading: string | null = null;
  let buffer: string[] = [];

  const flushSection = () => {
    if (!release) return;
    const blocks = parseBlocks(buffer);
    buffer = [];
    if (heading === null && !blocks.length) return;
    release.sections.push({ heading, blocks });
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(?!#)(.*)$/);
    if (h2) {
      flushSection();
      heading = null;
      release = { version: h2[1].trim(), sections: [] };
      releases.push(release);
      continue;
    }
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3 && release) {
      flushSection();
      heading = h3[1].trim();
      continue;
    }
    // Everything above the first ## is the file's preamble; drop it.
    if (release) buffer.push(line);
  }
  flushSection();
  return releases;
}

/**
 * The changelog lives at the repository root, one level above the site. Next
 * runs getStaticProps from the site directory, so this resolves the same way
 * locally and on a build whose root directory is the repository.
 */
export function readChangelog(): Release[] {
  const file = path.join(process.cwd(), '..', 'CHANGELOG.md');
  return parseChangelog(fs.readFileSync(file, 'utf8'));
}
