# MajiFlow — Adding Boards and Entities

## Adding a new board

### 1. Create the board directory

```
defaults/boards/{board-id}/
  board.yaml    # board definition
  board.svg     # visual representation (can be a placeholder)
```

### 2. Write `board.yaml`

Use the existing boards as reference:
- `defaults/boards/heltec-v3/board.yaml` — direct GPIO, WiFi, OLED, battery
- `defaults/boards/kc868-a16/board.yaml` — I2C expanders, Ethernet, no display
- `defaults/boards/sonoff-basicr4/board.yaml` — minimal ESP32-C3, single relay, WiFi only

Required sections:

```yaml
schema: 5
model: my_board        # underscore-separated identifier
label: My Board Name   # human-readable
svg: board.svg

mcu:
  variant: esp32       # esp32, esp32s3, etc.
  flash_size: 4MB
  framework: arduino   # or esp-idf

peripherals:
  # All optional. Include only what the board has:
  # oled, lora, battery, led, vext, ethernet

buses:
  i2c:
    sda: GPIO4
    scl: GPIO5
    frequency: 400kHz

# Optional: I2C GPIO expanders
expanders:
  - id: pcf8574_out_1
    platform: pcf8574
    address: 0x24

pins:
  # Native GPIO pins
  - { gpio: GPIO36, connector: adc1, edge: bottom, caps: [digital, adc] }
  # Expander pins (reference expander id and port number)
  - { gpio: OUT1, expander: pcf8574_out_1, number: 0, connector: relay_k1, edge: right, caps: [digital] }
```

**Pin capabilities**: `digital`, `adc`, `pwm`, `pulse_counter`, `i2c`, `uart`, `dac`

**Pin naming**: native pins use `GPIO{n}`, expander pins use any uppercase+digit format (`OUT1`, `IN16`, `P0`, etc.).

### 3. Board discovery

Boards in `defaults/boards/` are automatically copied to the user store on app startup. No registration code needed.

### 4. What the system handles automatically

- Board-package generator emits correct networking (WiFi or Ethernet), expander declarations, bus config, peripheral-specific outputs (OLED fonts, battery monitoring, LED)
- Pin validation checks capabilities against the board definition
- Pin conflict detection works across both GPIO and expander pins
- Reserved pins (buses, ethernet, peripherals) are excluded from user assignment

---

## Adding a new entity type

### 1. Create the entity file

```
packages/core/src/entities/{entity-name}.ts
```

Each entity is self-describing. A single file contains everything: Zod schema, UI rendering, sidebar fields, codegen templates, and validation rules.

### 2. Define the schema

```typescript
import { z } from 'zod';
import { GpioPin, ComponentId, PortSchema, PositionSchema } from '../schemas';

export const MyEntitySchema = z.object({
  kind: z.literal('my_entity'),
  id: ComponentId,
  name: z.string().min(1),
  pin: GpioPin,                    // or omit if no GPIO needed
  disabled: z.boolean().optional(),
  ports: z.array(PortSchema).min(1),
  position: PositionSchema,
});
```

### 3. Define the descriptor

```typescript
import type { NodeDescriptor } from '../entity-registry';

export const myEntityDescriptor: NodeDescriptor = {
  kind: 'my_entity',
  label: 'My Entity',
  color: '#hex',
  size: { width: 50, height: 36 },
  role: 'passthrough',           // or 'terminal'
  category: 'sensor',           // source, actuator, sensor, destination, infrastructure
  schema: MyEntitySchema,
  defaultPorts: [
    { id: 'inlet', label: 'Inlet', direction: 'inlet' },
    { id: 'outlet', label: 'Outlet', direction: 'outlet' },
  ],
  defaultData: (n) => ({ name: `My Entity ${n}`, pin: '' }),
  renderSvg: (data) => `<svg>...</svg>`,
  sidebarFields: [
    { key: 'pin', label: 'Pin', type: 'pin', placeholder: 'GPIO19', pinCap: 'adc' },
  ],

  // Optional: codegen for ESPHome YAML generation
  codegen: {
    sensors: (node, idx, ctx) => { /* return YAML string */ },
    hardware: (node, idx, ctx) => { /* return YAML string */ },
    substitutions: (node) => [],
  },
};
```

### 4. Register in the entity registry

In `packages/core/src/entity-registry.ts`:

```typescript
import { myEntityDescriptor } from './entities/my-entity';

export const ALL_DESCRIPTORS: readonly NodeDescriptor[] = [
  // ... existing entities
  myEntityDescriptor,
];
```

### 5. Export from index

In `packages/core/src/index.ts`, add the type export if needed.

### 6. Codegen with pin resolution

When writing codegen that uses pins, use the `ctx` parameter:

```typescript
hardware: (node, _idx, ctx) => {
  const pin = ctx?.resolvePin(node['pin'], { inverted: true })
    ?? `number: ${node['pin']}\n      inverted: true`;
  return `\
  - platform: gpio
    pin:
      ${pin}
    id: my_component
    ...`;
},
```

This generates correct YAML for both GPIO and expander pins.

### 7. Use shared IDs

If your entity creates components referenced by generators (routes.ts, control.ts), add ID functions to `codegen-ids.ts`:

```typescript
export const myEntityComponentId = (node: { id: string }) => `${node.id}_component`;
```

Then import and use in both the entity codegen and the generator.

---

## Key files reference

| File | Purpose |
|------|---------|
| `packages/core/src/codegen-ids.ts` | Shared component IDs + pin resolution |
| `packages/core/src/entity-registry.ts` | Entity descriptor interface, registry |
| `packages/core/src/schemas.ts` | Shared Zod primitives (GpioPin, ComponentId) |
| `packages/core/src/board.types.ts` | Board definition types (PinDef, ExpanderDef, EthernetDef) |
| `electron/lib/board.ts` | Board Zod schema + loading |
| `electron/lib/generators/collect.ts` | Single-pass codegen collector |
| `electron/lib/generators/board-package.ts` | Board-specific ESPHome config |
| `electron/lib/generators/hardware.ts` | Actuator YAML (switches, covers) |
| `electron/lib/generators/sensors.ts` | Sensor YAML + state exposure |
| `electron/lib/rules/` | Validation rules |
