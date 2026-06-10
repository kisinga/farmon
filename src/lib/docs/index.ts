/**
 * `@core` documentation subsystem.
 *
 * One mechanism for runtime-dynamic docs: author markdown with `{{slot}}`
 * placeholders, fill them from live `@core` data ({@link fillVars}/{@link renderDoc}),
 * and guard against name drift ({@link unknownSlots}). See vars.ts for the
 * per-scope variable vocabulary.
 */
export {
  siteVars, boardVars, nodeVars, vocabFor,
  type DocScope, type SiteVarCtx, type NodeVarCtx,
} from './vars';
export { fillVars, renderDoc, previewDoc } from './render';
export { extractSlots, unknownSlots } from './validate';
export { parseFrontmatter, parseDocFile, type ParsedDoc } from './frontmatter';
export { assembleSiteDoc, type DocRecord, type SiteDocInput } from './assemble';
