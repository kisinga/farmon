// Public API for the MajiFlow codegen library.
// Consumed by: cli/main.ts, app/ (Electron renderer), and tests.

export {
  type Manifest,
  type ManifestNode,
  type Route,
  type Timing,
  nodesByKind,
} from "./schema.js";

export {
  BoardDefSchema,
  PinCapability,
  type BoardDef,
  type PinDef,
  reservedPins,
  exposedPins,
  pinsWithCapability,
  loadBoard,
  loadBoardFromYaml,
} from "./board.js";

export {
  runTopologyRules,
  runManifestRules,
  validateAll,
  type ValidateOptions,
  type ValidationResult,
  type RuleDiagnostic,
  type TopologyRule,
  type ManifestRule,
} from "./validate.js";

export {
  generateAll,
  generateEsphome,
  generateFirmware,
  generateSiteHA,
  generateDefaultSecrets,
  type GeneratedFile,
  type GeneratorId,
  type SecretsMap,
} from "./generate.js";

export {
  generateSelfTest,
} from "./self-test/index.js";

export {
  type SiteDashboardSystem,
} from "./generators/site-dashboard.js";
