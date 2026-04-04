import type { Manifest } from "./schema.js";

export interface ValidateOptions {
  /** When true, GPIO budget overruns are warnings instead of errors. */
  loose?: boolean;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

interface PinUsage {
  pin: string;
  owner: string;
}

function collectAllPins(m: Manifest): PinUsage[] {
  const pins: PinUsage[] = [];
  pins.push({ pin: m.pump.pin, owner: "pump relay" });
  for (const t of m.tanks) {
    pins.push({ pin: t.level_pin, owner: `tank "${t.id}"` });
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

// Heltec V3 board-reserved GPIOs (cannot be used by pump hardware)
const BOARD_RESERVED = new Set([
  1,  // battery ADC
  9, 10, 11,  // SPI (LoRa)
  17, 18,  // I2C (OLED + expanders)
  21,  // OLED reset
  35,  // LED
  36,  // Vext gate
  37,  // battery ADC enable
]);

// ESP32-S3 ADC-capable pins (ADC1 + ADC2)
const ADC_CAPABLE = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,  // ADC1
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,  // ADC2
]);

const MAX_NATIVE_GPIO = 17;
const MAX_VALVE_MASK_BITS = 16; // uint16_t

function gpioNum(pin: string): number {
  return parseInt(pin.replace("GPIO", ""), 10);
}

export function validate(
  m: Manifest,
  opts: ValidateOptions = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const loose = opts.loose ?? false;

  // --- Pin conflicts ---
  const allPins = collectAllPins(m);
  const seen = new Map<string, string>();
  for (const { pin, owner } of allPins) {
    const existing = seen.get(pin);
    if (existing) {
      errors.push(`Pin ${pin} used by both ${existing} and ${owner}`);
    } else {
      seen.set(pin, owner);
    }
  }

  // --- Board-reserved pin usage ---
  for (const { pin, owner } of allPins) {
    if (BOARD_RESERVED.has(gpioNum(pin))) {
      warnings.push(`${pin} used by ${owner} is board-reserved on Heltec V3`);
    }
  }

  // --- Reference integrity ---
  const tankIds = new Set(m.tanks.map((t) => t.id));
  const valveIds = new Set(m.valves.map((v) => v.id));
  const flowIds = new Set(m.flow_sensors.map((f) => f.id));

  for (const route of m.routes) {
    if (!tankIds.has(route.source)) {
      errors.push(`Route "${route.name}": source "${route.source}" not found in tanks`);
    }
    if (route.destination && !tankIds.has(route.destination)) {
      errors.push(`Route "${route.name}": destination "${route.destination}" not found in tanks`);
    }
    for (const v of route.valves) {
      if (!valveIds.has(v)) {
        errors.push(`Route "${route.name}": valve "${v}" not found`);
      }
    }
    if (route.flow_sensor && !flowIds.has(route.flow_sensor)) {
      errors.push(`Route "${route.name}": flow_sensor "${route.flow_sensor}" not found`);
    }

    // --- Watchdog consistency ---
    if (route.watchdog === "flow" && !route.flow_sensor) {
      errors.push(`Route "${route.name}": flow watchdog requires flow_sensor`);
    }
    if (route.watchdog === "level_rise" && !route.destination) {
      errors.push(`Route "${route.name}": level_rise watchdog requires destination tank`);
    }

    // --- Self-loops ---
    if (route.source === route.destination) {
      errors.push(`Route "${route.name}": source equals destination (self-loop)`);
    }
  }

  // --- Valve mask overflow ---
  if (m.valves.length > MAX_VALVE_MASK_BITS) {
    errors.push(
      `${m.valves.length} valves exceeds valve_mask capacity (uint16_t max ${MAX_VALVE_MASK_BITS}). ` +
      `Split across multiple controllers.`
    );
  }

  // --- Per-route valve count check ---
  const valveIndexMap = new Map(m.valves.map((v, i) => [v.id, i]));
  for (const route of m.routes) {
    for (const v of route.valves) {
      const idx = valveIndexMap.get(v);
      if (idx !== undefined && idx >= MAX_VALVE_MASK_BITS) {
        errors.push(
          `Route "${route.name}": valve "${v}" at index ${idx} overflows uint16_t valve_mask. ` +
          `Max ${MAX_VALVE_MASK_BITS} valves per controller.`
        );
      }
    }
  }

  // --- Unique IDs ---
  const allIds = [
    ...m.tanks.map((t) => t.id),
    ...m.valves.map((v) => v.id),
    ...m.flow_sensors.map((f) => f.id),
  ];
  const idCounts = new Map<string, number>();
  for (const id of allIds) {
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push(`Duplicate component id: "${id}"`);
    }
  }

  // --- Orphaned components ---
  const usedValves = new Set(m.routes.flatMap((r) => r.valves));
  for (const v of m.valves) {
    if (!usedValves.has(v.id)) {
      warnings.push(`Valve "${v.id}" defined but not used in any route`);
    }
  }
  const usedFlows = new Set(
    m.routes.filter((r) => r.flow_sensor).map((r) => r.flow_sensor!)
  );
  for (const f of m.flow_sensors) {
    if (!usedFlows.has(f.id)) {
      warnings.push(`Flow sensor "${f.id}" defined but not used in any route`);
    }
  }

  // --- ADC pin validity ---
  for (const tank of m.tanks) {
    const num = gpioNum(tank.level_pin);
    if (!ADC_CAPABLE.has(num)) {
      errors.push(`Tank "${tank.id}": ${tank.level_pin} is not ADC-capable`);
    }
  }

  // --- GPIO budget (strict by default) ---
  const uniquePins = new Set(allPins.map((p) => p.pin));
  if (uniquePins.size > MAX_NATIVE_GPIO) {
    const msg =
      `${uniquePins.size} GPIOs used — Heltec V3 has ~${MAX_NATIVE_GPIO} free.`;
    if (loose) {
      warnings.push(`${msg} Running in --loose mode, continuing anyway.`);
    } else {
      errors.push(
        `${msg} If using I2C expanders, re-run with --loose to bypass this check.`
      );
    }
  }

  // --- Route name uniqueness ---
  const routeNames = m.routes.map((r) => r.name);
  const nameCounts = new Map<string, number>();
  for (const name of routeNames) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      errors.push(`Duplicate route name: "${name}"`);
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}
