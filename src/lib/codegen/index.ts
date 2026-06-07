/**
 * `@core/codegen` — ESPHome bundle generation.
 *
 * Browser-safe: every export here runs in the Angular editor. Per-site
 * documentation moved to `@core/docs` (runtime markdown + `{{slot}}` fill).
 */

export {
  generateEsphome,
  generateAll,
  generateFirmware,
  siteRoot,
  createTestMetadata,
  generateDefaultSecrets,
  type GeneratedFile,
} from './generate';

export { type GeneratorId, type SecretsMap, type GenerationMetadata } from './backends/types';

export { generateBoardPackage } from './generators/board-package';
export { generateRoutes } from './generators/routes';
export { collectEntityCodegen } from './generators/collect';

export { generateSelfTest, activeProbes } from './self-test';
