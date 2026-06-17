import type { Manifest } from "@core";
import type { BoardDef } from "@core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";

/**
 * Flags routes whose tank-full detection is misconfigured.
 *
 * Two full-detection methods exist (control.ts safety monitor):
 *   - Flow-stall: confirmed flow then ceases (any route with a flow sensor).
 *   - Level threshold: dest tank level >= dest_max_pct (needs a pump-safe level
 *     sensor; the whole runtime-level block is skipped when runtime_level_ok is
 *     false, i.e. a tank on the route isn't rated for readings during pumping).
 *
 * This rule surfaces the two ways an operator's wiring leaves those methods inert.
 */
export const fullDetectionMethods: ManifestRule = {
  id: "full-detection-methods",
  name: "Tank-full detection methods",

  evaluate(m: Manifest, _board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    for (const route of m.routes) {
      // The level method is wired (dest tank is level-monitored) but its readings
      // aren't trusted while the pump runs, so the by-level full stop never fires
      // mid-run — the dest_max_pct number the operator can set is dead during a run.
      if (route.dest_has_level && !route.runtime_level_ok) {
        diagnostics.push({
          severity: "warning",
          message: `${route.name}: destination tank level is monitored, but a sensor on this route isn't rated for readings while the pump runs, so the by-level full stop won't trigger during a run. Mark the pressure sensor pump-rated, or rely on flow-stall detection.`,
          target: route.key,
          ruleId: this.id,
          sharedNodeIds: route.destination ? [route.destination] : undefined,
        });
      }

      // No method can possibly detect "full": no flow sensor to observe a stall,
      // and no pump-safe destination level sensor. Only the max-runtime backstop
      // will stop the pump.
      const levelUsable = route.dest_has_level && route.runtime_level_ok;
      if (!route.flow_sensor && !levelUsable) {
        diagnostics.push({
          severity: "warning",
          message: `${route.name}: no flow sensor and no pump-safe destination level sensor, so nothing detects a full tank — only the max-runtime limit will stop the pump. Add a flow or level sensor, or set a duration target.`,
          target: route.key,
          ruleId: this.id,
        });
      }
    }

    return diagnostics;
  },
};
