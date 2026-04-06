import type { Topology } from "../topology.js";
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";

export type { Severity, RuleDiagnostic } from "../../../shared/validation.types.js";
import type { RuleDiagnostic } from "../../../shared/validation.types.js";

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
