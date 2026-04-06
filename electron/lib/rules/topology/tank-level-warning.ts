import type { Topology } from "../../topology.js";
import type { TopologyRule, RuleDiagnostic } from "../rule.types.js";

/**
 * Tanks without a level sensor (level_pin) cannot participate in
 * automated refill logic or pre-flight level checks.
 * This is a soft requirement for automation.
 */
export const tankLevelWarning: TopologyRule = {
  id: "tank-level-warning",
  name: "Tank without level sensor",

  evaluate(topology: Topology): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    for (const node of topology.nodes) {
      if (node.kind === "tank" && !node.level_pin) {
        diagnostics.push({
          severity: "warning",
          message: `Tank "${node.id}": no level sensor configured. ` +
            `Pre-flight level checks and automated refill will not be available for this tank.`,
          target: node.id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
