import type { Manifest } from "../../schema.js";

export interface PinUsage {
  pin: string;
  owner: string;
}

/** Collect all GPIO pins used in the manifest with their owners. */
export function collectAllPins(m: Manifest): PinUsage[] {
  const pins: PinUsage[] = [];
  pins.push({ pin: m.pump.pin, owner: "pump relay" });
  for (const t of m.tanks) {
    if (t.level_pin) {
      pins.push({ pin: t.level_pin, owner: `tank "${t.id}"` });
    }
  }
  for (const ws of m.water_sources) {
    if (ws.pressure_pin) {
      pins.push({ pin: ws.pressure_pin, owner: `water source "${ws.id}"` });
    }
  }
  for (const v of m.valves) {
    pins.push({ pin: v.open_pin, owner: `valve "${v.id}" open` });
    pins.push({ pin: v.close_pin, owner: `valve "${v.id}" close` });
  }
  for (const f of m.flow_sensors) {
    pins.push({ pin: f.pin, owner: `flow "${f.id}"` });
  }
  return pins;
}
