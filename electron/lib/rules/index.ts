import type { SystemTopology } from '@far-mon/core';
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types.js";
import {
  runTopologyRules as _runTopologyRules,
  runManifestRules as _runManifestRules,
  validateAll as _validateAll,
  type ValidationResult,
  type ValidateOptions,
} from "./runner.js";

// Topology rules — pump-inlet-valve, pump-outlet-ordering, endpoint-flow-warning
// are now entity-declared constraints (on pump.ts and endpoint.ts descriptors).
// ALL_TOPOLOGY_RULES is empty unless new non-constraint topology rules are added.

// Manifest rules
import { pinConflicts } from "./manifest/pin-conflicts.js";
import { reservedPinsRule } from "./manifest/reserved-pins.js";
import { pinExposure } from "./manifest/pin-exposure.js";
import { referenceIntegrity } from "./manifest/reference-integrity.js";
import { valveMaskOverflow } from "./manifest/valve-mask-overflow.js";
import { uniqueIds } from "./manifest/unique-ids.js";
import { orphanedComponents } from "./manifest/orphaned-components.js";
import { pinCapabilities } from "./manifest/pin-capabilities.js";
import { gpioBudget } from "./manifest/gpio-budget.js";
import { routeNames } from "./manifest/route-names.js";
import { routeConcurrency } from "./manifest/route-concurrency.js";
import { automationRouteRef } from "./manifest/automation-route-ref.js";
import { routeCount } from "./manifest/route-count.js";
import { timingSanity } from "./manifest/timing-sanity.js";
import { boardCapacity } from "./manifest/board-capacity.js";
import { providerReferences } from "./manifest/provider-references.js";
import { pinTransportConsistency } from "./manifest/pin-transport-consistency.js";

// Entity-specific topology rules are registered on NodeDescriptor.rules
// and collected by the runner via NODE_REGISTRY. No imports needed here.

export const ALL_TOPOLOGY_RULES: TopologyRule[] = [];

export const ALL_MANIFEST_RULES: ManifestRule[] = [
  pinConflicts,
  reservedPinsRule,
  pinExposure,
  referenceIntegrity,
  valveMaskOverflow,
  routeCount,
  uniqueIds,
  orphanedComponents,
  pinCapabilities,
  gpioBudget,
  routeNames,
  routeConcurrency,
  automationRouteRef,
  timingSanity,
  boardCapacity,
  providerReferences,
  pinTransportConsistency,
];

// Convenience wrappers with default rule sets

export function runTopologyRules(
  topology: SystemTopology,
  rules: TopologyRule[] = ALL_TOPOLOGY_RULES,
): ValidationResult {
  return _runTopologyRules(topology, rules);
}

export function runManifestRules(
  manifest: Manifest,
  board: BoardDef,
  rules: ManifestRule[] = ALL_MANIFEST_RULES,
  opts: ValidateOptions = {},
): ValidationResult {
  return _runManifestRules(manifest, board, rules, opts);
}

export function validateAll(
  topology: SystemTopology,
  manifest: Manifest,
  board: BoardDef,
  opts: ValidateOptions = {},
): ValidationResult {
  return _validateAll(topology, manifest, board, ALL_TOPOLOGY_RULES, ALL_MANIFEST_RULES, opts);
}

// Re-export types
export type { TopologyRule, ManifestRule, RuleDiagnostic, Severity } from "./rule.types.js";
export type { ValidationResult, ValidateOptions } from "./runner.js";
