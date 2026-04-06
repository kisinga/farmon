import type { Topology } from "../../topology.js";
import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";

/**
 * Water sources without a pressure sensor can't monitor incoming supply pressure.
 * This is a soft requirement for monitoring mains/borehole pressure.
 */
export const waterSourcePressureWarning: TopologyRule = {
  id: "water-source-pressure-warning",
  name: "Water source without pressure sensor",

  evaluate(topology: Topology): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    for (const node of topology.nodes) {
      if (node.kind === "water_source" && !node.pressure_pin) {
        diagnostics.push({
          severity: "warning",
          message: `Water source "${node.id}": no pressure sensor configured. ` +
            `Incoming supply pressure will not be monitored.`,
          target: node.id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
