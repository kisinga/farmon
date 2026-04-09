import type { SystemTopology } from '@far-mon/core';
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types.js";
import { NODE_REGISTRY, buildGraph, activeGraph, deriveRoutes, evaluateConstraints, evaluateEscalations, type ValidationResult } from '@far-mon/core';

export type { ValidationResult } from '@far-mon/core';

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
}

/**
 * Collect per-entity validation rules from the NODE_REGISTRY.
 * Each entity can define rules on its descriptor — these are evaluated
 * against the manifest nodes of that kind.
 */
function runEntityRules(nodes: Array<Record<string, any>>): RuleDiagnostic[] {
  const diagnostics: RuleDiagnostic[] = [];
  for (const [kind, desc] of NODE_REGISTRY) {
    const kindNodes = nodes.filter(n => n['kind'] === kind);

    // General pin check — flag empty pin fields from sidebarFields metadata.
    // Skipped for entities with their own rules (they provide richer messages).
    if (!desc.rules?.length) {
      const pinFields = desc.sidebarFields.filter(f => f.type === 'pin');
      for (const node of kindNodes) {
        for (const field of pinFields) {
          if (!node[field.key]) {
            diagnostics.push({
              severity: 'error',
              message: `${desc.label} "${node['name'] || node['id']}": ${field.label} not configured`,
              target: String(node['id']),
              ruleId: 'pin-not-configured',
            });
          }
        }
      }
      continue;
    }

    // Per-entity rules
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
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Layer 1: Topology — graph structure + entity-declared constraints
// ---------------------------------------------------------------------------

export function runTopologyRules(
  topology: SystemTopology,
  rules: TopologyRule[],
): ValidationResult {
  const graph = buildGraph(topology.nodes, topology.pipes);
  const active = activeGraph(graph);
  const routes = deriveRoutes(active);

  const diagnostics: RuleDiagnostic[] = [];

  // Entity-declared flow constraints (from NODE_REGISTRY.constraints)
  diagnostics.push(...evaluateConstraints(active, routes));

  // Explicit topology rules (if any remain beyond constraints)
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(active, routes));
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
    const gpioRule = rules.find((r) => r.id === "gpio-budget") as any;
    if (gpioRule) gpioRule.options = { loose: true };
  }

  const diagnostics: RuleDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(manifest, board));
  }

  // Collect entity-level rules from the registry
  diagnostics.push(...runEntityRules(manifest.nodes));

  return toResult(diagnostics);
}

// ---------------------------------------------------------------------------
// All layers combined
// ---------------------------------------------------------------------------

export function validateAll(
  topology: SystemTopology,
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
  for (const rule of topologyRules) {
    topoDiags.push(...rule.evaluate(active, routes));
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
