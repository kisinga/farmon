/** Accent colour per documentation category, shared by the docs list and the
 *  importer so the two never disagree. (Hexes mirror the theme accents; the
 *  cross-stack token unification is tracked separately.) */
export const DOC_CAT_COLOR: Record<string, string> = {
  narrative: '#22d3ee', node: '#34d399', wiring: '#fbbf24', glossary: '#a78bfa',
};

/** Category accent, with a neutral fallback for an unknown category. */
export function docCatColor(category: string): string {
  return DOC_CAT_COLOR[category] ?? '#94a3b8';
}
