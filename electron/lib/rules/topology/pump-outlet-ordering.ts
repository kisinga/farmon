import type { Topology, TopologyNode } from "../../topology.js";
import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";
import { deriveRouteSequences } from "../trace-route-sequence.js";

/**
 * For every pump outlet path, valve(s) must appear before flow sensor(s).
 * This ensures the isolation valve is upstream of the measurement point.
 */
export const pumpOutletOrdering: TopologyRule = {
  id: "pump-outlet-ordering",
  name: "Valve before flow sensor on pump outlet",

  evaluate(topology: Topology): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    const sequences = deriveRouteSequences(topology);

    for (const seq of sequences) {
      if (!seq.crossesPump) continue;

      // Look at nodes after the pump (outlet side)
      const outletNodes = seq.nodeSequence.slice(seq.pumpIndex + 1);

      let firstValveIdx = -1;
      let firstFlowIdx = -1;

      for (let i = 0; i < outletNodes.length; i++) {
        const node = nodes.get(outletNodes[i]);
        if (!node) continue;
        if (node.kind === "valve" && firstValveIdx === -1) firstValveIdx = i;
        if (node.kind === "flow_sensor" && firstFlowIdx === -1) firstFlowIdx = i;
      }

      // If both exist, valve must come first
      if (firstValveIdx >= 0 && firstFlowIdx >= 0 && firstFlowIdx < firstValveIdx) {
        const routeKey = `${seq.source}>${seq.destination}`;
        diagnostics.push({
          severity: "error",
          message: `Route "${routeKey}": flow sensor appears before valve on pump outlet side. ` +
            `Valve must be placed before flow sensor for proper isolation.`,
          target: routeKey,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
