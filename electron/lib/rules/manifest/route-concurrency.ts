import type { Manifest, Route } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { parseRouteKey } from '@far-mon/core';

export const routeConcurrency: ManifestRule = {
  id: "route-concurrency",
  name: "Route concurrency conflicts",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const nodeName = new Map(m.nodes.map(n => [n['id'] as string, (n['name'] as string) || n['id']]));
    const destOf = (r: Route) => parseRouteKey(r.key).destination;

    // Group routes by flow sensor
    const byFlowSensor = new Map<string, Route[]>();
    for (const route of m.routes) {
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
