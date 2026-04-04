// Public API for the waterctl codegen library.
// Consumed by: cli/main.ts, app/ (Electron renderer), and tests.

export {
  ManifestSchema,
  type Manifest,
  type Tank,
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
  validate,
  type ValidateOptions,
  type ValidationResult,
} from "./validate.js";

export { generateAll, type GeneratedFile } from "./generate.js";
