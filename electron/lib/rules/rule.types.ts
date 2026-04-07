import type { TopologyGraph } from "../../../shared/graph/topology-graph.js";
import type { Route } from "../../../shared/graph/routes.js";
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";

export type { Severity, RuleDiagnostic } from "../../../shared/validation.types.js";
import type { RuleDiagnostic } from "../../../shared/validation.types.js";

/** A rule that validates the topology graph structure. */
export interface TopologyRule {
  id: string;
  name: string;
  evaluate(graph: TopologyGraph, routes: Route[]): RuleDiagnostic[];
}

/** A rule that validates the flat manifest against the board definition. */
export interface ManifestRule {
  id: string;
  name: string;
  evaluate(manifest: Manifest, board: BoardDef): RuleDiagnostic[];
}

export type ValidationRule = TopologyRule | ManifestRule;
