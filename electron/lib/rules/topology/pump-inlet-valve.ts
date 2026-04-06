import type { Topology } from "../../topology.js";
import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";
import { deriveRouteSequences } from "../trace-route-sequence.js";

/**
 * For every pump inlet path, at least one valve must exist.
 * This ensures the inlet side can be isolated for maintenance and safety.
 * Order on the inlet side does not matter.
 */
export const pumpInletValve: TopologyRule = {
  id: "pump-inlet-valve",
  name: "Valve required on pump inlet",

  evaluate(topology: Topology): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    const sequences = deriveRouteSequences(topology);

    for (const seq of sequences) {
      if (!seq.crossesPump) continue;

      // Look at nodes before the pump (inlet side), excluding source and pump itself
      const inletNodes = seq.nodeSequence.slice(1, seq.pumpIndex);

      const hasValve = inletNodes.some((id) => nodes.get(id)?.kind === "valve");

      if (!hasValve) {
        const routeKey = `${seq.source}>${seq.destination}`;
        diagnostics.push({
          severity: "error",
          message: `Route "${routeKey}": no valve on pump inlet side. ` +
            `An isolation valve is required before the pump for safety and maintenance.`,
          target: routeKey,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
