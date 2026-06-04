import type { SiteTopology } from '@core';
import type { Manifest } from "@core";
import type { BoardDef, ExpansionBoardCatalog } from "@core";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types";
import { z } from 'zod';
import { NODE_REGISTRY, REGISTRY_RULES, buildGraph, activeGraph, deriveRoutes, evaluateConstraints, evaluateRouteRules, evaluateEscalations, type ValidationResult, type TopologyNode, type DeploymentMode } from '@core';

export type { ValidationResult } from '@core';

function toResult(diagnostics: RuleDiagnostic[]): ValidationResult {
  return {
    errors: diagnostics.filter((d) => d.severity === "error").map((d) => d.message),
    warnings: diagnostics.filter((d) => d.severity === "warning").map((d) => d.message),
    ok: diagnostics.every((d) => d.severity !== "error"),
    diagnostics,
  };
}

export interface ValidateOptions {
  /** When true, GPIO budget overruns are warnings instead of errors. */
  loose?: boolean;
  /** Expansion-board catalog (DB-backed); threaded to rules that count
   *  expansion-channel supply, e.g. board-capacity. Empty when omitted. */
  expansionBoards?: ExpansionBoardCatalog;
  /** Deployment mode. When `managed`, mode-specific rules (e.g. the
   *  cross-controller ban) are added. Omitted = no mode-specific rules. */
  mode?: DeploymentMode;
}

/**
 * Check if a schema field is required (not optional) using the Zod schema
 * as the single source of truth. Every sidebarField key must exist in the schema.
 */
function isSchemaFieldRequired(schema: z.ZodTypeAny, fieldKey: string): boolean {
  if (!(schema instanceof z.ZodObject)) return false;
  const field = (schema.shape as Record<string, z.ZodTypeAny>)[fieldKey];
  return field ? !field.isOptional() : false;
}

/**
 * Collect per-entity validation rules from the NODE_REGISTRY.
 *
 * Pin validation uses the Zod schema as single source of truth for
 * required vs optional. Entities with custom `rules` handle their own
 * pin validation (richer messages). The generic check only runs for
 * entities without rules. REGISTRY_RULES run last for cross-cutting checks.
 */
function runEntityRules(nodes: TopologyNode[]): RuleDiagnostic[] {
  const diagnostics: RuleDiagnostic[] = [];
  for (const [kind, desc] of NODE_REGISTRY) {
    const kindNodes = nodes.filter(n => n.kind === kind);

    if (desc.rules?.length) {
      // Entity-specific rules are the authority — they produce richer messages
      // and handle both required and optional pin validation.
      for (const rule of desc.rules) {
        const results = rule.evaluate(kindNodes, nodes);
        for (const r of results) {
          diagnostics.push({
            severity: rule.severity,
            message: r.message,
            target: r.target,
            ruleId: rule.id,
          });
        }
      }
    } else {
      // Generic pin validation — uses Zod schema for required vs optional.
      const pinFields = desc.sidebarFields.filter(f => f.type === 'pin');
      for (const node of kindNodes) {
        for (const field of pinFields) {
          if (!(node as Record<string, unknown>)[field.key] && isSchemaFieldRequired(desc.schema, field.key)) {
            diagnostics.push({
              severity: 'error',
              message: `${desc.label} "${node.name || node.id}": ${field.label} not configured`,
              target: String(node.id),
              ruleId: 'pin-not-configured',
            });
          }
        }
      }
    }
  }

  // Cross-cutting rules from the registry (pump uniqueness, experimental warnings, etc.)
  for (const rule of REGISTRY_RULES) {
    const results = rule.evaluate([], nodes);
    for (const r of results) {
      diagnostics.push({
        severity: rule.severity,
        message: r.message,
        target: r.target,
        ruleId: rule.id,
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Layer 1: Topology — graph structure + entity-declared constraints
// ---------------------------------------------------------------------------

export function runTopologyRules(
  topology: SiteTopology,
  rules: TopologyRule[],
): ValidationResult {
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const routes = deriveRoutes(active);

  const diagnostics: RuleDiagnostic[] = [];

  // Entity-declared flow constraints (from NODE_REGISTRY.constraints)
  diagnostics.push(...evaluateConstraints(active, routes));

  // Entity-declared route rules (property-aware + topology-aware)
  diagnostics.push(...evaluateRouteRules(active, routes));

  // Explicit topology rules (if any remain beyond constraints)
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(active, routes, topology));
  }

  return toResult(diagnostics);
}

// ---------------------------------------------------------------------------
// Layer 2: Manifest — flat IR + board hardware constraints
// ---------------------------------------------------------------------------

export function runManifestRules(
  manifest: Manifest,
  board: BoardDef,
  rules: ManifestRule[],
  opts: ValidateOptions = {},
): ValidationResult {
  if (opts.loose) {
    const gpioRule = rules.find((r) => r.id === "gpio-budget");
    if (gpioRule) gpioRule.options = { loose: true };
  }

  const diagnostics: RuleDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(manifest, board, opts.expansionBoards));
  }

  // Collect entity-level rules from the registry
  diagnostics.push(...runEntityRules(manifest.nodes));

  return toResult(diagnostics);
}

// ---------------------------------------------------------------------------
// All layers combined
// ---------------------------------------------------------------------------

export function validateAll(
  topology: SiteTopology,
  manifest: Manifest,
  board: BoardDef,
  topologyRules: TopologyRule[],
  manifestRules: ManifestRule[],
  opts: ValidateOptions = {},
): ValidationResult {
  // Layer 1: Graph + constraints
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const routes = deriveRoutes(active);

  const topoDiags: RuleDiagnostic[] = [];
  topoDiags.push(...evaluateConstraints(active, routes));
  topoDiags.push(...evaluateRouteRules(active, routes));
  for (const rule of topologyRules) {
    topoDiags.push(...rule.evaluate(active, routes, topology));
  }

  // Layer 2: Manifest + board
  const manifestResult = runManifestRules(manifest, board, manifestRules, opts);

  // Layer 3: Escalation — automated routes promote warnings to errors
  const escalated = evaluateEscalations(topoDiags, routes, topology.automations ?? []);
  const escalatedBaseIds = new Set(
    escalated.map(d => `${d.target}:${d.ruleId.replace(':escalated', '')}`),
  );
  const filteredTopo = topoDiags.filter(
    d => !escalatedBaseIds.has(`${d.target}:${d.ruleId}`),
  );

  const allDiagnostics = [...filteredTopo, ...escalated, ...manifestResult.diagnostics];
  return toResult(allDiagnostics);
}
