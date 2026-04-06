import type { Manifest } from "../../schema.js";

export interface PinUsage {
  pin: string;
  owner: string;
  /** Node ID for targeting diagnostics. */
  nodeId: string;
}

/** Collect all GPIO pins used in the manifest with their owners. */
export function collectAllPins(m: Manifest): PinUsage[] {
  const pins: PinUsage[] = [];
  if (m.pump) {
    pins.push({ pin: m.pump.pin, owner: "pump relay", nodeId: "pump" });
  }
  for (const t of m.tanks) {
    if (t.level_pin) {
      pins.push({ pin: t.level_pin, owner: `tank "${t.id}"`, nodeId: t.id });
    }
  }
  for (const ws of m.water_sources) {
    if (ws.pressure_pin) {
      pins.push({ pin: ws.pressure_pin, owner: `water source "${ws.id}"`, nodeId: ws.id });
    }
  }
  for (const v of m.valves) {
    pins.push({ pin: v.open_pin, owner: `valve "${v.id}" open`, nodeId: v.id });
    pins.push({ pin: v.close_pin, owner: `valve "${v.id}" close`, nodeId: v.id });
  }
  for (const f of m.flow_sensors) {
    pins.push({ pin: f.pin, owner: `flow "${f.id}"`, nodeId: f.id });
  }
  return pins;
}
