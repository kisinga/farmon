/**
 * Markdown frontmatter parsing for the docs import path.
 *
 * The repo `docs-content/*.md` files are the source of truth for product docs;
 * the app imports them into the `docs` collection. This is the in-browser
 * counterpart to what the Go `docs import` CLI used to do — same minimal
 * contract, so existing files load unchanged. Pure and app-agnostic (no
 * collection/DraftEntry types) so it sits in the shared `@core` layer and is
 * unit-testable on its own.
 */

/** A doc parsed from a `.md` file: the four frontmatter keys + the body. */
export interface ParsedDoc {
  slug: string;
  title: string;
  /** Free-form here; the caller validates it against the known categories. */
  category: string;
  order: number;
  body: string;
}

/**
 * Split a leading `---\nkey: value\n---\n` block from the body. Minimal by
 * design (known keys, single-line scalars), CRLF-normalised — mirrors the old
 * Go `parseFrontmatter`. No frontmatter → `{}` and the whole input as body.
 */
export function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const s = raw.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return { fm, body: s };

  const end = s.indexOf('\n---', 4);
  if (end < 0) return { fm, body: s };

  const header = s.slice(4, end);
  // Past the closing `\n---`, then drop the line break(s) that follow it.
  const body = s.slice(end + 4).replace(/^\n?\n?/, '');

  for (const line of header.split('\n')) {
    const i = line.indexOf(':');
    if (i >= 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fm, body };
}

/**
 * Parse a `.md` file into a doc, or `null` when it isn't one — a file with no
 * `category` (e.g. `README.md`) is skipped, exactly as the Go importer did.
 * Slug falls back to the filename sans `.md`; `order` parses to 0 when absent
 * or non-numeric.
 */
export function parseDocFile(fileName: string, raw: string): ParsedDoc | null {
  const { fm, body } = parseFrontmatter(raw);
  if (!fm['category']) return null;

  const slug = fm['slug'] || fileName.replace(/\.md$/, '');
  const order = Number.parseInt(fm['order'] ?? '', 10);
  return {
    slug,
    title: fm['title'] ?? '',
    category: fm['category'],
    order: Number.isNaN(order) ? 0 : order,
    body,
  };
}
