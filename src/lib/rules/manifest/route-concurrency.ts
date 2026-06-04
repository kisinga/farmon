import type { Manifest, ManifestRoute as Route } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { parseRouteKey } from '@core';

export const routeConcurrency: ManifestRule = {
  id: "route-concurrency",
  name: "Route concurrency conflicts",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const nodeName = new Map(m.nodes.map(n => [n.id, n.name || n.id]));
    const destOf = (r: Route) => parseRouteKey(r.key).destination;

    // Group routes by flow sensor
    const byFlowSensor = new Map<string, Route[]>();
    for (const route of m.routes) {
      if (!route.flow_sensor) continue;
      const list = byFlowSensor.get(route.flow_sensor) ?? [];
      list.push(route);
      byFlowSensor.set(route.flow_sensor, list);
    }

    // Shared sensor + different destination = ambiguous reading, must queue
    for (const [sensorId, routes] of byFlowSensor) {
      if (routes.length < 2) continue;
      for (const route of routes) {
        const conflicting = routes.filter(r => r !== route && destOf(r) !== destOf(route));
        if (conflicting.length === 0) continue;
        diagnostics.push({
          severity: "info",
          message: `Queues with ${conflicting.map(r => r.name).join(", ")} (shared sensor ${nodeName.get(sensorId) ?? sensorId}, different destination)`,
          target: route.key,
          ruleId: this.id,
          sharedNodeIds: [sensorId],
        });
      }
    }

    return diagnostics;
  },
};
