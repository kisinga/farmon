import type { Topology } from "../topology.js";
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types.js";
import type { ValidationResult } from "../../../shared/validation.types.js";
import { NODE_REGISTRY } from "../../../shared/entity-registry.js";

export type { ValidationResult } from "../../../shared/validation.types.js";

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

/** Run topology-level rules against the graph structure. */
export function runTopologyRules(
  topology: Topology,
  rules: TopologyRule[],
): ValidationResult {
  const diagnostics: RuleDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(topology));
  }
  return toResult(diagnostics);
}

/** Run manifest-level rules against the flat IR + board. */
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

/** Run all rules: topology first, then manifest + entity rules. */
export function validateAll(
  topology: Topology,
  manifest: Manifest,
  board: BoardDef,
  topologyRules: TopologyRule[],
  manifestRules: ManifestRule[],
  opts: ValidateOptions = {},
): ValidationResult {
  const topologyResult = runTopologyRules(topology, topologyRules);
  const manifestResult = runManifestRules(manifest, board, manifestRules, opts);

  const allDiagnostics = [...topologyResult.diagnostics, ...manifestResult.diagnostics];
  return toResult(allDiagnostics);
}
