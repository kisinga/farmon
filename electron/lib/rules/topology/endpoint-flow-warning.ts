import type { Topology } from "../../topology.js";
import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";
import { deriveRouteSequences } from "../trace-route-sequence.js";

/**
 * Endpoints without a flow sensor in their route won't have flow tracking.
 * These endpoints may not get codegen stubs for usage monitoring.
 */
export const endpointFlowWarning: TopologyRule = {
  id: "endpoint-flow-warning",
  name: "Endpoint without flow sensor",

  evaluate(topology: Topology): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const nodes = new Map(topology.nodes.map((n) => [n.id, n]));
    const sequences = deriveRouteSequences(topology);

    // Collect endpoints that have at least one route with a flow sensor
    const endpointsWithFlow = new Set<string>();

    for (const seq of sequences) {
      if (seq.destKind !== "endpoint") continue;
      const hasFlow = seq.nodeSequence.some((id) => nodes.get(id)?.kind === "flow_sensor");
      if (hasFlow) endpointsWithFlow.add(seq.destination);
    }

    // Warn about endpoints that appear as route destinations but have no flow sensor
    const endpoints = topology.nodes.filter((n) => n.kind === "endpoint");
    const endpointsInRoutes = new Set(
      sequences.filter((s) => s.destKind === "endpoint").map((s) => s.destination)
    );

    for (const ep of endpoints) {
      if (endpointsInRoutes.has(ep.id) && !endpointsWithFlow.has(ep.id)) {
        diagnostics.push({
          severity: "warning",
          message: `Endpoint "${ep.id}": no flow sensor in any route to this endpoint. ` +
            `Water usage will not be tracked.`,
          target: ep.id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
