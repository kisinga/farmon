import type { Manifest } from "../../schema.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import type { BoardDef } from "../../board.js";

export const automationRouteRef: ManifestRule = {
  id: "automation-route-ref",
  name: "Automation route references",

  evaluate(manifest: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];
    const routeKeys = new Set(manifest.routes.map(r => r.key));
    const seenIds = new Set<string>();

    for (const auto of manifest.automations) {
      // Incomplete automation (draft state — name or route not yet filled in)
      if (!auto.name) {
        diagnostics.push({
          ruleId: "automation-route-ref",
          severity: "warning",
          message: `Automation "${auto.id}" has no name`,
          target: auto.id,
        });
      }
      if (!auto.route_key) {
        diagnostics.push({
          ruleId: "automation-route-ref",
          severity: "warning",
          message: `Automation "${auto.id}" has no route assigned`,
          target: auto.id,
        });
        continue; // skip further checks — route-dependent
      }

      // Duplicate ID check
      if (seenIds.has(auto.id)) {
        diagnostics.push({
          ruleId: "automation-route-ref",
          severity: "error",
          message: `Duplicate automation ID "${auto.id}"`,
          target: auto.id,
        });
      }
      seenIds.add(auto.id);

      // Route reference check (should already be filtered by manifest derivation,
      // but catch any that slip through)
      if (!routeKeys.has(auto.route_key)) {
        diagnostics.push({
          ruleId: "automation-route-ref",
          severity: "error",
          message: `Automation "${auto.name}" references unknown route "${auto.route_key}"`,
          target: auto.id,
        });
      }

      // Validate time trigger format
      if (auto.trigger.type === "time") {
        const match = auto.trigger.at.match(/^(\d{2}):(\d{2})$/);
        if (!match) {
          diagnostics.push({
            ruleId: "automation-route-ref",
            severity: "error",
            message: `Automation "${auto.name}" has invalid time format "${auto.trigger.at}" (expected HH:MM)`,
            target: auto.id,
          });
        } else {
          const h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          if (h > 23 || m > 59) {
            diagnostics.push({
              ruleId: "automation-route-ref",
              severity: "error",
              message: `Automation "${auto.name}" has out-of-range time "${auto.trigger.at}"`,
              target: auto.id,
            });
          }
        }
      }

      // Warn if automated route has no firmware-level source conservation
      // (only meaningful when the source tank has an associated level source —
      // either a level_sensor or a pressure_sensor)
      const route = manifest.routes[auto.route_index];
      if (route && route.source_type === 'tank' && route.source_min_pct === 0) {
        const srcNode = manifest.nodes.find(n => n.id === route.source);
        if (srcNode && srcNode['level_source']) {
          diagnostics.push({
            ruleId: "automation-route-ref",
            severity: "warning",
            message: `Automation "${auto.name}": route has no source_min_level — firmware won't prevent source tank from draining empty`,
            target: auto.route_key,
          });
        }
      }
    }

    return diagnostics;
  },
};
