import type { Topology } from "../topology.js";
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";
import type { TopologyRule, ManifestRule, RuleDiagnostic } from "./rule.types.js";
import type { ValidationResult } from "../../../shared/validation.types.js";

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
  // Apply options to rules that support them
  if (opts.loose) {
    const gpioRule = rules.find((r) => r.id === "gpio-budget") as any;
    if (gpioRule) gpioRule.options = { loose: true };
  }

  const diagnostics: RuleDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.evaluate(manifest, board));
  }
  return toResult(diagnostics);
}

/** Run all rules: topology first, then manifest. */
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
