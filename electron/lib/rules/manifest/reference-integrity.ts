import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const referenceIntegrity: ManifestRule = {
  id: "reference-integrity",
  name: "Route reference integrity",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const tankIds = new Set(m.tanks.map((t) => t.id));
    const wsIds = new Set(m.water_sources.map((ws) => ws.id));
    const valveIds = new Set(m.valves.map((v) => v.id));
    const flowIds = new Set(m.flow_sensors.map((f) => f.id));

    for (const route of m.routes) {
      // Source must exist in tanks or water_sources
      if (route.source_type === "tank" && !tankIds.has(route.source)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source "${route.source}" not found in tanks`,
          target: route.name,
          ruleId: this.id,
        });
      }
      if (route.source_type === "water_source" && !wsIds.has(route.source)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source "${route.source}" not found in water sources`,
          target: route.name,
          ruleId: this.id,
        });
      }

      if (route.destination && !tankIds.has(route.destination)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": destination "${route.destination}" not found in tanks`,
          target: route.name,
          ruleId: this.id,
        });
      }

      for (const v of route.valves) {
        if (!valveIds.has(v)) {
          diagnostics.push({
            severity: "error",
            message: `Route "${route.name}": valve "${v}" not found`,
            target: route.name,
            ruleId: this.id,
          });
        }
      }

      if (!flowIds.has(route.flow_sensor)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": flow_sensor "${route.flow_sensor}" not found`,
          target: route.name,
          ruleId: this.id,
        });
      }

      if (route.max_runtime_seconds < 10) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": max_runtime_seconds must be >= 10`,
          target: route.name,
          ruleId: this.id,
        });
      }
      if (route.max_runtime_seconds > 7200) {
        diagnostics.push({
          severity: "warning",
          message: `Route "${route.name}": max_runtime_seconds=${route.max_runtime_seconds} is very high (>2h)`,
          target: route.name,
          ruleId: this.id,
        });
      }

      if (route.source === route.destination) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source equals destination (self-loop)`,
          target: route.name,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
