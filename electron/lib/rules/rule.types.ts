import type { TopologyGraph, Route, RuleDiagnostic, Severity } from '@far-mon/core';
import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";

export type { Severity, RuleDiagnostic } from '@far-mon/core';

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
