/**
 * Validation entry point — delegates to the composable rule engine.
 *
 * All individual rules live in ./rules/topology/ and ./rules/manifest/.
 * This module re-exports the runner functions as the public API.
 */

export {
  runTopologyRules,
  runManifestRules,
  validateAll,
  ALL_TOPOLOGY_RULES,
  ALL_MANIFEST_RULES,
} from "./rules/index.js";

export type {
  ValidationResult,
  ValidateOptions,
} from "./rules/runner.js";

export type {
  TopologyRule,
  ManifestRule,
  RuleDiagnostic,
  Severity,
} from "./rules/rule.types.js";
