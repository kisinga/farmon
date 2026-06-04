import type { SiteTopology } from '@core';
import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types";
import {
  runTopologyRules as _runTopologyRules,
  runManifestRules as _runManifestRules,
  validateAll as _validateAll,
  type ValidationResult,
  type ValidateOptions,
} from "./runner";

// Topology rules — pump-inlet-valve, pump-outlet-ordering, endpoint-flow-warning
// are now entity-declared constraints (on pump.ts and endpoint.ts descriptors).

import { unclaimedRouteNodes } from "./topology/unclaimed-route-nodes";
import { managedCrossController } from "./topology/managed-cross-controller";

// Manifest rules
import { pinConflicts } from "./manifest/pin-conflicts";
import { reservedPinsRule } from "./manifest/reserved-pins";
import { pinExposure } from "./manifest/pin-exposure";
import { referenceIntegrity } from "./manifest/reference-integrity";
import { valveMaskOverflow } from "./manifest/valve-mask-overflow";
import { uniqueIds } from "./manifest/unique-ids";
import { orphanedComponents } from "./manifest/orphaned-components";
import { pinCapabilities } from "./manifest/pin-capabilities";
import { gpioBudget } from "./manifest/gpio-budget";
import { routeNames } from "./manifest/route-names";
import { routeConcurrency } from "./manifest/route-concurrency";
import { automationRouteRef } from "./manifest/automation-route-ref";
import { routeCount } from "./manifest/route-count";
import { timingSanity } from "./manifest/timing-sanity";
import { boardCapacity } from "./manifest/board-capacity";
import { providerReferences } from "./manifest/provider-references";
import { pinTransportConsistency } from "./manifest/pin-transport-consistency";
import { remoteNodes } from "./manifest/remote-nodes";

// Entity-specific topology rules are registered on NodeDescriptor.rules
// and collected by the runner via NODE_REGISTRY. No imports needed here.

export const ALL_TOPOLOGY_RULES: TopologyRule[] = [
  unclaimedRouteNodes,
];

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
  remoteNodes,
];

// Convenience wrappers with default rule sets

export function runTopologyRules(
  topology: SiteTopology,
  rules: TopologyRule[] = ALL_TOPOLOGY_RULES,
): ValidationResult {
  return _runTopologyRules(topology, rules);
}

/**
 * Topology rule set for a given deployment mode. `managed` adds the
 * cross-controller ban; `local` (or unset) uses the base set.
 */
export function topologyRulesForMode(mode?: ValidateOptions['mode']): TopologyRule[] {
  return mode === 'managed'
    ? [...ALL_TOPOLOGY_RULES, managedCrossController]
    : ALL_TOPOLOGY_RULES;
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
  topology: SiteTopology,
  manifest: Manifest,
  board: BoardDef,
  opts: ValidateOptions = {},
): ValidationResult {
  return _validateAll(topology, manifest, board, topologyRulesForMode(opts.mode), ALL_MANIFEST_RULES, opts);
}

// Re-export types
export type { TopologyRule, ManifestRule, RuleDiagnostic, Severity } from "./rule.types";
export type { ValidationResult, ValidateOptions } from "./runner";
