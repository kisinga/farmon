/**
 * Render a documentation body: fill `{{slots}}` with live values, then
 * markdown → HTML.
 *
 * `micromustache` does the logic-less, CSP-safe slot fill (no eval, hardened
 * against prototype pollution); `marked` is dynamically imported so it lands in
 * a lazy chunk and never weighs down the initial app bundle. We resolve via an
 * explicit function so an unresolved slot renders empty instead of throwing —
 * validate.ts (the drift guard) is what actually guarantees every slot is in
 * scope; this just keeps a rendered doc robust to partial data.
 *
 * Content is admin-authored (trusted), and the markdown intentionally allows
 * inline HTML, so output is not sanitized here.
 */
import { renderFn } from 'micromustache';

/** Fill `{{slots}}` only (no markdown). Synchronous and tiny. */
export function fillVars(body: string, vars: Record<string, string | number>): string {
  return renderFn(body, (name) => (name in vars ? vars[name] : ''));
}

/** Fill `{{slots}}`, then render markdown → HTML. `marked` is lazy-loaded. */
export async function renderDoc(body: string, vars: Record<string, string | number>): Promise<string> {
  const filled = fillVars(body, vars);
  const { marked } = await import('marked');
  // `await` collapses marked's `string | Promise<string>` return to `string`.
  return await marked.parse(filled, { gfm: true });
}

/**
 * Authoring preview: render markdown → HTML with each `{{slot}}` shown as a
 * visible `«slot»` token (no live data needed), so an author sees both the prose
 * structure and where values will land.
 */
export async function previewDoc(body: string): Promise<string> {
  const shown = renderFn(body, (name) => `«${name}»`);
  const { marked } = await import('marked');
  return await marked.parse(shown, { gfm: true });
}
