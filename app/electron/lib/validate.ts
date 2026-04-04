import type { Manifest } from "./schema.js";
import type { BoardDef } from "./board.js";
import { reservedPins, exposedPins, pinsWithCapability } from "./board.js";

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

const MAX_VALVE_MASK_BITS = 16; // uint16_t

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

export function validate(
  m: Manifest,
  board: BoardDef,
  opts: ValidateOptions = {}
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const loose = opts.loose ?? false;

  // Derive all constraints from board definition
  const reserved = reservedPins(board);
  const exposed = exposedPins(board);
  const adcPins = pinsWithCapability(board, "adc");
  const pcntPins = pinsWithCapability(board, "pulse_counter");

  // --- Pin conflicts (duplicate usage) ---
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

  // --- Reserved pin usage ---
  for (const { pin, owner } of allPins) {
    const reason = reserved.get(pin);
    if (reason) {
      errors.push(
        `Pin ${pin} used by ${owner} is reserved for ${reason} on ${board.label}`
      );
    }
  }

  // --- Pin not exposed on board headers ---
  for (const { pin, owner } of allPins) {
    if (!exposed.has(pin) && !reserved.has(pin)) {
      warnings.push(
        `Pin ${pin} used by ${owner} is not on ${board.label} headers`
      );
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

    // Watchdog consistency
    if (route.watchdog === "flow" && !route.flow_sensor) {
      errors.push(`Route "${route.name}": flow watchdog requires flow_sensor`);
    }
    if (route.watchdog === "level_rise" && !route.destination) {
      errors.push(`Route "${route.name}": level_rise watchdog requires destination tank`);
    }

    // Self-loops
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

  const valveIndexMap = new Map(m.valves.map((v, i) => [v.id, i]));
  for (const route of m.routes) {
    for (const v of route.valves) {
      const idx = valveIndexMap.get(v);
      if (idx !== undefined && idx >= MAX_VALVE_MASK_BITS) {
        errors.push(
          `Route "${route.name}": valve "${v}" at index ${idx} overflows uint16_t valve_mask.`
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

  // --- Pin capability checks (board-driven) ---
  for (const tank of m.tanks) {
    if (!adcPins.has(tank.level_pin)) {
      errors.push(
        `Tank "${tank.id}": ${tank.level_pin} does not have ADC capability on ${board.label}`
      );
    }
  }
  for (const flow of m.flow_sensors) {
    if (!pcntPins.has(flow.pin)) {
      warnings.push(
        `Flow "${flow.id}": ${flow.pin} does not have pulse_counter capability on ${board.label}. ` +
        `Software counting may miss pulses at high flow rates.`
      );
    }
  }

  // --- GPIO budget ---
  const uniquePins = new Set(allPins.map((p) => p.pin));
  const maxPins = exposed.size;
  if (uniquePins.size > maxPins) {
    const msg = `${uniquePins.size} GPIOs used — ${board.label} has ${maxPins} exposed pins.`;
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
