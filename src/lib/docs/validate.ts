/**
 * Doc drift guard: every `{{slot}}` a doc references must exist in its scope's
 * vocabulary. A domain rename that drops a slot becomes a loud test failure
 * here, never a silently-blank doc in front of a customer.
 */
import { vocabFor, type DocScope } from './vars';

const SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * The slot names a doc body references. The vocabulary is flat, so a nested
 * path (`{{a.b}}`) or index (`{{a[0]}}`) keys on its root segment (`a`).
 */
export function extractSlots(body: string): string[] {
  const slots = new Set<string>();
  for (const m of body.matchAll(SLOT_RE)) {
    const root = m[1].trim().split(/[.[]/)[0].trim();
    if (root) slots.add(root);
  }
  return [...slots];
}

/** Slots a doc uses that are NOT in its scope's vocabulary (empty = clean). */
export function unknownSlots(body: string, scope: DocScope): string[] {
  const vocab = new Set(vocabFor(scope));
  return extractSlots(body).filter(s => !vocab.has(s));
}
