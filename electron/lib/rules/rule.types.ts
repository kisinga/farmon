import type { Topology } from "../topology.js";
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";

export type Severity = "error" | "warning";

export interface RuleDiagnostic {
  severity: Severity;
  message: string;
  /** Node, route, or component ID this diagnostic applies to. */
  target?: string;
  /** The rule that produced this diagnostic. */
  ruleId: string;
}

/** A rule that validates the topology graph structure. */
export interface TopologyRule {
  id: string;
  name: string;
  evaluate(topology: Topology): RuleDiagnostic[];
}

/** A rule that validates the flat manifest against the board definition. */
export interface ManifestRule {
  id: string;
  name: string;
  evaluate(manifest: Manifest, board: BoardDef): RuleDiagnostic[];
}

export type ValidationRule = TopologyRule | ManifestRule;
