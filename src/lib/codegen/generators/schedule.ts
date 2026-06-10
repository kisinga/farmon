import type { Manifest } from '@core';
import {
  findRouteAutomationSensor, pressureSensorLevelId,
  validAutomations, automationEnableSwitchId, yamlString,
} from '@core';

/** ESPHome day token (MON..SUN) from a day name ("Monday"/"mon" → "MON"). */
const DAY3 = (d: string) => d.toUpperCase().slice(0, 3);

/** True when the device has at least one enabled, valid schedule automation. */
export function hasSchedule(m: Manifest): boolean {
  return validAutomations(m).length > 0;
}

/** True when a TIME automation exists — meaning schedule.yaml declares the
 *  `time: sntp` component (id: sntp_time). mqtt.ts emits its own only when this
 *  is false, so there is exactly one sntp_time (no package merge to rely on). */
export function hasTimeSchedule(m: Manifest): boolean {
  return validAutomations(m).some((a) => a.trigger.type === 'time');
}

/**
 * Generate the on-device schedule package — the firmware replacement for the old
 * Home Assistant schedule automations. Triggers fire on the ESP32 itself and call
 * try_route_start(); the state machine still decides whether the start is safe,
 * so no external scheduler is required.
 *
 *  - time triggers  → an ESPHome `time:` (SNTP) `on_time:` entry, with the
 *    weekday filter when it's a subset of the week. Fires only once time is trusted
 *    (a real SNTP sync), never on the flash-seeded boot estimate (see time-sync.ts).
 *  - level triggers → an edge-detecting `interval:` that starts the route when
 *    the source tank rises above the route's Source Min Level, re-arming when it
 *    falls back below.
 *
 * Returns null when there are no enabled, valid automations.
 *
 * Known simplifications vs the old HA automations (intentional, not silent): the
 * HA `for_minutes` debounce and per-trigger weekday filter on *level* triggers
 * are not applied on-device yet; time triggers keep their weekday filter.
 *
 * Each baked automation also gets a persistent template switch (id from
 * automationEnableSwitchId) that GATES its trigger, so an operator can pause /
 * resume it at runtime from the dashboard (over MQTT, action `automation_set`)
 * without a rebuild. restore_mode RESTORE_DEFAULT_ON: enabled on first flash
 * (design intent), then restores the last runtime value across reboot/OTA — a
 * pause stays paused. Pausing gates FUTURE triggers only; a running route is
 * unaffected.
 */
export function generateSchedule(m: Manifest): string | null {
  const valid = validAutomations(m);
  const timeAutos = valid.filter((a) => a.trigger.type === 'time');
  const levelAutos = valid.filter((a) => a.trigger.type === 'level');
  if (timeAutos.length === 0 && levelAutos.length === 0) return null;

  const out: string[] = [
    '# =============================================================================',
    '# MajiFlow — On-device Schedule',
    '# =============================================================================',
    '# AUTO-GENERATED. Replaces Home Assistant schedule automations: triggers fire on',
    '# the ESP32 and call try_route_start(); the state machine decides whether the',
    '# start is safe. No external scheduler required.',
    '#',
    '# Each automation has an enable switch that gates its trigger; the dashboard',
    '# flips it over MQTT (action automation_set) to pause/resume without a rebuild.',
    '# =============================================================================',
    '',
  ];

  // Per-automation enable switch (persists across reboot; merges with the
  // switch: block in control.yaml). Default ON = the design-time enabled state
  // these baked automations already carry.
  out.push('switch:');
  for (const a of valid) {
    out.push(`  # ${a.name} — gates the trigger for route ${a.route_index} [${a.route_name}]`);
    out.push('  - platform: template');
    out.push(`    name: ${yamlString(`Schedule: ${a.name}`)}`);
    out.push(`    id: ${automationEnableSwitchId(a.id)}`);
    out.push('    optimistic: true');
    out.push('    restore_mode: RESTORE_DEFAULT_ON');
  }
  out.push('');

  if (timeAutos.length > 0) {
    out.push('time:');
    out.push('  - platform: sntp');
    out.push('    id: sntp_time');
    // A real SNTP sync is the only thing that marks time trusted; the flash-seeded
    // boot estimate (time-sync.h) does not, so schedules never fire on a guess.
    out.push('    on_time_sync:');
    out.push('      - then:');
    out.push("          - lambda: 'id(time_trusted) = true;'");
    out.push('    on_time:');
    for (const a of timeAutos) {
      if (a.trigger.type !== 'time') continue; // type narrowing
      const [hh, mm] = a.trigger.at.split(':');
      out.push(`      # ${a.name} — route ${a.route_index} [${a.route_name}]`);
      out.push('      - seconds: 0');
      out.push(`        minutes: ${Number(mm)}`);
      out.push(`        hours: ${Number(hh)}`);
      if (a.days_of_week.length > 0 && a.days_of_week.length < 7) {
        out.push(`        days_of_week: [${a.days_of_week.map(DAY3).join(', ')}]`);
      }
      out.push('        then:');
      out.push(`          - lambda: 'if (id(time_trusted) && id(${automationEnableSwitchId(a.id)}).state) try_route_start(${a.route_index}, "");'`);
    }
    out.push('');
  }

  if (levelAutos.length > 0) {
    const nodeById = new Map(m.nodes.map((n) => [n.id, n]));
    const body: string[] = [];
    levelAutos.forEach((a, i) => {
      const route = m.routes[a.route_index];
      const found = findRouteAutomationSensor(route, nodeById);
      if (!found) {
        throw new Error(
          `Schedule "${a.name}": a level trigger needs a source tank with a level sensor before the first valve/pump on route "${route.name}".`,
        );
      }
      if (!route.source_min_pct) {
        throw new Error(
          `Schedule "${a.name}": a level trigger needs route "${route.name}" to have a Source Min Level (> 0) — it fires when the tank rises above it.`,
        );
      }
      const levelId = pressureSensorLevelId({ id: found.sensorId });
      const sw = automationEnableSwitchId(a.id);
      const thr = route.source_min_pct;
      body.push(`// ${a.name}: start route ${a.route_index} [${a.route_name}] when ${levelId} rises above ${thr}% (gated by ${sw})`);
      body.push('{');
      body.push(`  static bool armed_${i} = true;`);
      body.push(`  float v = id(${levelId}).state;`);
      body.push('  if (!std::isnan(v)) {');
      body.push(`    if (v > ${thr}.0f) {`);
      // Fire only when enabled, but disarm on high REGARDLESS — so resuming a
      // paused schedule never retroactively starts for a crossing that happened
      // while it was paused; it waits for a fresh rise above the threshold.
      body.push(`      if (armed_${i} && id(${sw}).state) try_route_start(${a.route_index}, "");`);
      body.push(`      armed_${i} = false;`);
      body.push(`    } else armed_${i} = true;`);
      body.push('  }');
      body.push('}');
    });
    out.push('interval:');
    out.push('  - interval: 5s');
    out.push('    then:');
    out.push('      - lambda: |-');
    for (const line of body) out.push('          ' + line);
    out.push('');
  }

  return out.join('\n') + '\n';
}
