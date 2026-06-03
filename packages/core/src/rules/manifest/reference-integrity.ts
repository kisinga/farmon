import type { Manifest } from "@far-mon/core";
import { nodesByKind } from "@far-mon/core";
import type { BoardDef } from "@far-mon/core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

export const referenceIntegrity: ManifestRule = {
  id: "reference-integrity",
  name: "Route reference integrity",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const tankIds = new Set(nodesByKind(m.nodes, 'tank').map((t) => t['id']));
    const wsIds = new Set(nodesByKind(m.nodes, 'water_source').map((ws) => ws['id']));
    const valveIds = new Set(nodesByKind(m.nodes, 'valve').map((v) => v['id']));
    const flowIds = new Set(nodesByKind(m.nodes, 'flow_sensor').map((f) => f['id']));

    for (const route of m.routes) {
      if (route.source_type === "tank" && !tankIds.has(route.source)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source "${route.source}" not found in tanks`,
          target: route.key,
          ruleId: this.id,
        });
      }
      if (route.source_type === "water_source" && !wsIds.has(route.source)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source "${route.source}" not found in water sources`,
          target: route.key,
          ruleId: this.id,
        });
      }

      if (route.destination && !tankIds.has(route.destination)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": destination "${route.destination}" not found in tanks`,
          target: route.key,
          ruleId: this.id,
        });
      }

      for (const v of route.valves) {
        if (!valveIds.has(v)) {
          diagnostics.push({
            severity: "error",
            message: `Route "${route.name}": valve "${v}" not found`,
            target: route.key,
            ruleId: this.id,
          });
        }
      }

      if (route.flow_sensor !== undefined && !flowIds.has(route.flow_sensor)) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": flow_sensor "${route.flow_sensor}" not found`,
          target: route.key,
          ruleId: this.id,
        });
      }

      if (route.max_runtime_seconds < 10) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": max_runtime_seconds must be >= 10`,
          target: route.key,
          ruleId: this.id,
        });
      }
      if (route.max_runtime_seconds > 7200) {
        diagnostics.push({
          severity: "warning",
          message: `Route "${route.name}": max_runtime_seconds=${route.max_runtime_seconds} is very high (>2h)`,
          target: route.key,
          ruleId: this.id,
        });
      }

      if (route.source === route.destination) {
        diagnostics.push({
          severity: "error",
          message: `Route "${route.name}": source equals destination (self-loop)`,
          target: route.key,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
