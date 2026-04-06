// Public API for the MajiFlow codegen library.
// Consumed by: cli/main.ts, app/ (Electron renderer), and tests.

export {
  type Manifest,
  type Tank,
  type WaterSource,
  type Valve,
  type FlowSensor,
  type Route,
  type Timing,
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

export { generateAll, type GeneratedFile } from "./generate.js";
