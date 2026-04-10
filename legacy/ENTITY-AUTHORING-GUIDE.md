# Entity Authoring Guide

How to add a new entity kind to MajiFlow. A VFD inverter (`entities/vfd.ts`) is the reference implementation for non-GPIO entities.

## Adding a new entity: 2-file process

### 1. Create the entity file

Create `packages/core/src/entities/my-entity.ts`. Every entity file has the same structure:

```
Schema (Zod)        - validates topology input
Type                - TypeScript type inferred from schema
Descriptor          - everything the system needs: UI, codegen, flags
```

**Required descriptor fields:**

| Field | Purpose |
|-------|---------|
| `kind` | Unique string identifier (must match schema's `z.literal(...)`) |
| `label` | Human-readable name for UI |
| `color` | Hex color for canvas rendering |
| `size` | `{ width, height }` in canvas pixels |
| `role` | `'terminal'` (route endpoint) or `'passthrough'` (mid-route) |
| `schema` | Zod schema — source of truth for validation |
| `defaultPorts` | Port definitions for new nodes |
| `defaultData` | Factory for fresh node data |
| `renderSvg` | SVG string for canvas rendering |
| `sidebarFields` | Form field definitions for the property panel |

**Dispatch flags (optional but important):**

| Flag | Set when... | What it does |
|------|-------------|--------------|
| `isPump: true` | Entity acts as a pump | Participates in `pump_ref_count()`, `needs_pump` on routes |
| `isValve: true` | Entity acts as a valve | Included in route `valve_mask`, dispatch functions |
| `isFlowSensor: true` | Entity reads flow rate | Required for valid routes, flow dispatch |
| `isLevelSensor: true` | Entity reads level (0-100%) | Included in level dispatch, OLED display |
| `conflictClass: 'sensor'` | Shared readings are ambiguous | Routes sharing this node are queued (blocking conflict) |
| `conflictClass: 'actuator'` | Shared access is refcountable | Routes sharing this node run concurrently |

If no flags are set, the entity is passive (like endpoint or filter) — it appears in the topology and routes but doesn't participate in the state machine.

**Codegen hooks (optional):**

| Hook | Output file | Purpose |
|------|-------------|---------|
| `sensors(node, idx)` | `sensors.yaml` | ADC, pulse counter, Modbus sensors |
| `hardware(node, idx)` | `hardware.yaml` | Switches, relays, Modbus controllers |
| `substitutions(node)` | Device YAML substitutions block | Pin assignments, calibration values |
| `globals(node)` | `control.yaml` globals | C++ global variables |

### 2. Register in entity-registry.ts

```ts
import { myEntityDescriptor } from './entities/my-entity';

export const ALL_DESCRIPTORS: readonly NodeDescriptor[] = [
  // ... existing entries ...
  myEntityDescriptor,
];
```

### 3. (Optional) Add to topology.types.ts

For TypeScript type narrowing with `getNodesByKind()`:

```ts
import type { MyEntityNode } from './entities/my-entity';

export type TopologyNode =
  | TankNode | PumpNode | ... 
  | MyEntityNode;
```

## Component ID conventions

The state machine references ESPHome components by ID. These conventions must be followed for the dispatch functions to work:

| Dispatch role | Expected component ID | Component type |
|---------------|----------------------|----------------|
| Pump (`isPump`) | `pump_relay` | `switch` (on/off) |
| Valve (`isValve`) | `{id}` | `cover` (open/close/stop) |
| Valve switches | `{id}_open_pin`, `{id}_close_pin` | `switch` (internal) |
| Flow sensor (`isFlowSensor`) | `{id}` | `sensor` (L/min) |
| Level sensor (`isLevelSensor`) | `{id}_level` | `sensor` (0-100%) |

A VFD inverter sets `isPump: true` and emits a Modbus switch with `id: pump_relay` — the state machine calls `.turn_on()` / `.turn_off()` on it identically to a GPIO relay.

## UART buses for Modbus/RS485 devices

Declare UART buses in the topology's `device` section:

```yaml
device:
  name: pump-controller
  friendly_name: "Pump Controller"
  board: heltec-v3
  uart_buses:
    - id: uart_modbus
      tx_pin: GPIO17
      rx_pin: GPIO18
      de_pin: GPIO19
      baud_rate: 9600
```

The device YAML generator emits `uart:` and `modbus:` components automatically. Entity codegen references the bus via `{bus_id}_modbus` as the `modbus_controller_id`.

## Custom ESPHome packages

For components that don't need to interact with the state machine (extra sensors, displays, notifications), use standard ESPHome packages:

1. Write standard ESPHome YAML (e.g., `custom/power-monitor.yaml`)
2. Add it to the device YAML's `packages:` section manually, or use ESPHome's `!include` in a custom package

The generated component IDs above are stable — custom YAML can safely reference them in lambdas and automations.

## Example: VFD entity walkthrough

See `packages/core/src/entities/vfd.ts` for a complete non-GPIO entity:

- **Schema**: `bus` (references a UART bus), `modbus_address`, register addresses
- **Flags**: `isPump: true, conflictClass: 'actuator'`
- **Codegen hardware**: Emits a `modbus_controller` switch with `id: pump_relay`
- **Codegen sensors**: Conditionally emits power, frequency, and fault sensors based on which registers are configured
- **No pin substitutions**: Bus config is device-level, not per-entity

The VFD required zero changes to the graph layer or generators — the `isPump` flag told the system everything it needed.
