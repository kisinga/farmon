import type { Manifest } from '@core';
import { routeSetVersion } from '@core';

/**
 * Runtime automation engine — the firmware replacement for the baked schedule.
 *
 * The device holds a RAM table of automations filled from a retained MQTT message
 * (maji_automations.apply_set, called from the mqtt on_message subscriber) and a generic
 * 5s evaluator (id(autos).tick) that fires their triggers through id(control).start_route
 * — so the SAME route state machine still decides whether each start is safe. Editing an
 * automation is a server-side data change, no reflash.
 *
 * The struct table, retained-set validation, and the trigger decision (time once-per-day,
 * level edge arm/disarm) live in the vendored maji_automations external component
 * (firmware/components/maji_automations) — a pure, host-tested kernel + a thin shell. This
 * generator only emits the config (the route_set_version the device gates against, and the
 * control engine it fires into) plus the 5s tick interval.
 *
 *  - Route identity is by route_index + route_set_version: the device refuses any set whose
 *    version doesn't match its baked route table (fail-safe — an index could otherwise
 *    point at the wrong route after a topology change). The version is config below.
 *  - Time triggers gate on time_trusted (a real SNTP sync), level triggers on the route's
 *    source tank — the tick lambda passes the clock + trust flag; the component reads levels
 *    from id(control).
 */

/** YAML package — the `maji_automations:` config + the 5s evaluator interval. The table,
 *  validation, and trigger logic live in the vendored component; the mqtt on_message
 *  subscriber (mqtt.yaml) fills it via id(autos).apply_set. */
export function generateAutomationEngineConfig(m: Manifest): string {
  return `# =============================================================================
# MajiFlow — Runtime Automation Engine
# =============================================================================
# AUTO-GENERATED. A RAM table of automations, filled from a retained MQTT message and
# evaluated every 5s. The table + validation + trigger logic live in the vendored
# maji_automations external component; triggers fire through id(control).start_route, so
# the route state machine still gates safety. Editing automations is a server data change
# — no reflash. The route_set_version below is what a delivered set must match.
# =============================================================================

maji_automations:
  id: autos
  control_id: control
  route_set_version: ${routeSetVersion(m)}

interval:
  - interval: 5s
    then:
      # Generic evaluator. The component reads tank levels from id(control); the lambda
      # passes the SNTP clock + trust flag and nudges an immediate snapshot when a trigger
      # fires on-device (no operator command to fast-path it). publish_snapshot is
      # mode:single and this runs at most once per 5s, so it self-rate-limits.
      - lambda: 'if (id(autos).tick(id(sntp_time).now(), id(time_trusted))) id(publish_snapshot).execute();'
`;
}
