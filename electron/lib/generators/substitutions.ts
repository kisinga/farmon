import type { Manifest } from "../schema.js";

export function generateSubstitutions(m: Manifest): string {
  const lines: string[] = [];

  lines.push(`  device_name: ${m.device.name}`);
  lines.push(`  friendly_name: ${m.device.friendly_name}`);
  lines.push(`  update_interval: ${m.timing.update_interval}`);
  lines.push(`  pin_battery_adc: GPIO1`);
  lines.push(`  battery_divider: "2.0"`);
  lines.push("");

  if (m.pump) {
    lines.push(`  # --- Pump ---`);
    lines.push(`  pin_pump_relay: ${m.pump.pin}`);
  }

  lines.push("");
  lines.push(`  # --- Valves ---`);
  for (const v of m.valves) {
    lines.push(`  pin_${v.id}_o: ${v.open_pin}`);
    lines.push(`  pin_${v.id}_c: ${v.close_pin}`);
  }

  lines.push("");
  lines.push(`  # --- Flow sensors (pin + calibration) ---`);
  for (const f of m.flow_sensors) {
    lines.push(`  pin_${f.id}: ${f.pin}`);
    lines.push(`  flow_cal_${f.id}: "${f.flow_cal}"`);
  }

  lines.push("");
  lines.push(`  # --- Tank levels ---`);
  for (const t of m.tanks) {
    lines.push(`  pin_${t.id}_level: ${t.level_pin}`);
  }

  lines.push("");
  lines.push(`  # --- Timing ---`);
  lines.push(`  valve_travel_time: "${m.timing.valve_travel_time}"`);
  lines.push(`  flow_watchdog_seconds: "${m.timing.flow_watchdog_seconds}"`);
  lines.push(`  flow_confirm_seconds: "${m.timing.flow_confirm_seconds}"`);
  lines.push(`  api_watchdog_seconds: "${m.timing.api_watchdog_seconds}"`);

  return `substitutions:\n${lines.join("\n")}\n`;
}
