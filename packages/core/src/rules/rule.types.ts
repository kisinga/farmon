import type { SiteTopology, TopologyGraph, Route, RuleDiagnostic, Severity } from '@far-mon/core';
import type { Manifest } from "@far-mon/core";
import type { BoardDef, ExpansionBoardCatalog } from "@far-mon/core";

export type { Severity, RuleDiagnostic } from '@far-mon/core';

/** A rule that validates the topology graph structure. */
export interface TopologyRule {
  id: string;
  name: string;
  evaluate(graph: TopologyGraph, routes: Route[], topology?: SiteTopology): RuleDiagnostic[];
}

/** A rule that validates the flat manifest against the board definition. */
export interface ManifestRule {
  id: string;
  name: string;
  evaluate(manifest: Manifest, board: BoardDef, expansionBoards?: ExpansionBoardCatalog): RuleDiagnostic[];
  /** Optional runtime configuration passed to the rule before evaluation. */
  options?: Record<string, unknown>;
}

export type ValidationRule = TopologyRule | ManifestRule;
