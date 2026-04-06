import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";

export const uniqueIds: ManifestRule = {
  id: "unique-ids",
  name: "Component ID uniqueness",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    const allIds = [
      ...m.tanks.map((t) => t.id),
      ...m.water_sources.map((ws) => ws.id),
      ...m.valves.map((v) => v.id),
      ...m.flow_sensors.map((f) => f.id),
    ];
    const idCounts = new Map<string, number>();
    for (const id of allIds) {
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      if (count > 1) {
        diagnostics.push({
          severity: "error",
          message: `Duplicate component id: "${id}"`,
          target: id,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
