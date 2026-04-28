# I/O Providers — Next Steps

Immediate follow-up work after the I/O provider infrastructure refactor.
Ordered by dependency — each step unblocks the next.

---

## Step 1: Schema + Persistence for `io_providers`

**Why first**: Every subsequent step needs providers to be declarable and persistable.

### Changes

**`packages/core/src/schemas.ts`** — add `IoProviderDefSchema`:
```typescript
export const IoProviderDefSchema = z.object({
  id: ComponentId,
  type: z.string().min(1),            // 'analog_mux', 'modbus_dio', etc.
  config: z.record(z.unknown()),       // driver-specific (validated by driver)
});
```

Add to `DeviceSchema`:
```typescript
io_providers: z.array(IoProviderDefSchema).default([]),
```

**`packages/core/src/topology.types.ts`** — add to `SystemTopology.device`:
```typescript
io_providers?: IoProviderDef[];
```

**`packages/core/src/site.types.ts`** — add to `StoredTopology`:
```typescript
io_providers?: IoProviderDef[];
```

**`src/app/core/services/workspace.service.ts`** — persist `io_providers` in save payload (alongside `uart_buses`):
```typescript
uart_buses: topology.device.uart_buses,
io_providers: topology.device.io_providers,  // add
```

**`electron/ipc-handlers.ts`** + **`electron/store.ts`** — round-trip `io_providers` through IPC and storage.

---

## Step 2: Analog MUX Driver (CD74HC4067 / 74HC4051)

**Why second**: Cheapest hardware ($0.50), ESPHome native support, proves the full provider pipeline end-to-end.

### New file: `packages/core/src/io-providers/analog-mux-driver.ts`

```typescript
interface MuxConfig {
  platform: 'cd74hc4067';   // or 'cd74hc4051' (same ESPHome component)
  com_pin: string;           // ADC pin routed through MUX (e.g., "GPIO36")
  sel_pins: string[];        // 3 pins for 8ch, 4 for 16ch
  channels: number;          // 8 or 16
}
```

Factory: `createAnalogMuxDriver(config, resolvePin) → IoProviderDriver`

**enumerate()**: Returns channels `CH0`–`CH7` (or `CH15`) with `caps: ['adc']`.

**resolve("mux1:CH3", { purpose: 'adc' })**:
```typescript
{ platform: 'cd74hc4067', config: 'number: 3\n  sensor: mux1_adc\n  cd74hc4067_id: mux1' }
```

**consumedPins()**: Returns `[config.com_pin, ...config.sel_pins]` — these become reserved on the board.

### Add `prerequisites()` to IoProviderDriver

Extend the interface:
```typescript
interface IoProviderDriver {
  enumerate(): IoChannel[];
  resolve(channelId: string, usage: ChannelUsage): ResolvedChannel;
  consumedPins?(): string[];
  prerequisites?(): string;  // NEW — ESPHome YAML blocks needed before entity codegen
}
```

MUX driver prerequisites:
```yaml
cd74hc4067:
  - id: mux1
    pin_s0: <resolved sel_pins[0]>
    pin_s1: <resolved sel_pins[1]>
    pin_s2: <resolved sel_pins[2]>

sensor:
  - platform: adc
    id: mux1_adc
    pin: <resolved com_pin>
    attenuation: 12db
    update_interval: never
```

### Emit prerequisites in device-yaml.ts

After UART buses section (~line 161):
```typescript
const providers = m.device.io_providers ?? [];
for (const provDef of providers) {
  const driver = getProviderDriver(provDef.type);
  if (driver?.prerequisites) {
    lines.push(driver.prerequisites());
    lines.push('');
  }
}
```

### Update `buildResolveChannel()`

Accept `io_providers`:
```typescript
export function buildResolveChannel(
  board: BoardDef,
  providers?: Array<{ id: string; driver: IoProviderDriver }>,
): (channelId: string, usage: ChannelUsage) => ResolvedChannel {
  const boardDrv = createBoardDriver(board);
  const providerMap = new Map(providers?.map(p => [p.id, p.driver]) ?? []);

  return (channelId, usage) => {
    const colonIdx = channelId.indexOf(':');
    if (colonIdx > 0) {
      const providerId = channelId.slice(0, colonIdx);
      const channel = channelId.slice(colonIdx + 1);
      const driver = providerMap.get(providerId);
      if (!driver) throw new Error(`Unknown I/O provider: ${providerId}`);
      return driver.resolve(channel, usage);
    }
    return boardDrv.resolve(channelId, usage);
  };
}
```

### Update `collect.ts`

Build provider driver instances and pass to `buildResolveChannel`:
```typescript
const providerDrivers = (m.device.io_providers ?? []).map(def => ({
  id: def.id,
  driver: createProviderDriver(def, board),  // factory dispatch by def.type
}));
const ctx: CodegenContext = {
  resolveChannel: buildResolveChannel(board, providerDrivers),
};
```

### Driver registry

Introduce `packages/core/src/io-providers/registry.ts`:
```typescript
const FACTORIES = new Map<string, (def: IoProviderDef, board: BoardDef) => IoProviderDriver>();
FACTORIES.set('analog_mux', (def, board) => createAnalogMuxDriver(def.config as MuxConfig, ...));

export function createProviderDriver(def: IoProviderDef, board: BoardDef): IoProviderDriver {
  const factory = FACTORIES.get(def.type);
  if (!factory) throw new Error(`Unknown provider type: ${def.type}`);
  return factory(def, board);
}
```

### Validation

- **reserved-pins rule**: Check `consumedPins()` from each provider. MUX's com_pin and sel_pins must not be assigned to entities.
- **board-capacity rule**: MUX channels don't count against board ADC pool.
- **pin-capabilities**: MUX channels have `adc` only — `pulse_counter` on a MUX channel = error.

### Test

Add example config `defaults/configs/kc868-mux-controller.yaml`:
```yaml
device:
  name: kc868-mux
  board: kc868-a16
  io_providers:
    - id: mux1
      type: analog_mux
      config:
        platform: cd74hc4067
        com_pin: GPIO36
        sel_pins: [OUT14, OUT15, OUT16]
        channels: 8
nodes:
  - kind: tank
    id: tank1
    level_pin: mux1:CH0
  - kind: tank
    id: tank2
    level_pin: mux1:CH1
  # ... up to 8 tanks on one ADC pin
```

Codegen test: verify generated YAML has `cd74hc4067:` component block, `sensor: mux1_adc` base ADC, and tank sensors with `platform: cd74hc4067`.

---

## Step 3: UI — I/O Provider Configuration

**Why third**: Users need to declare providers before they can assign channels.

### Config tab: I/O Providers card

Add a new card in `config-tab.component.ts` between "Target Board" and "Timing":

```html
<!-- I/O Expansion Modules -->
<div class="card bg-base-100 shadow-sm border border-base-200">
  <div class="card-body gap-4">
    <div class="flex items-center justify-between">
      <h2 class="card-title text-base">I/O Expansion</h2>
      <button class="btn btn-sm btn-primary" (click)="addProvider()">+ Add Module</button>
    </div>

    @for (prov of t.device.io_providers ?? []; track prov.id) {
      <div class="border border-base-200 rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="font-mono text-sm font-bold">{{ prov.id }}</span>
          <div class="flex gap-2">
            <span class="badge badge-sm">{{ prov.type }}</span>
            <button class="btn btn-ghost btn-xs text-error" (click)="removeProvider(prov.id)">Remove</button>
          </div>
        </div>
        <!-- Type-specific config fields rendered dynamically -->
        @switch (prov.type) {
          @case ('analog_mux') {
            <div class="grid grid-cols-2 gap-2 text-sm">
              <label>ADC Pin <input class="input input-xs input-bordered" [ngModel]="prov.config['com_pin']" ... /></label>
              <label>Select Pins <input class="input input-xs input-bordered" [ngModel]="prov.config['sel_pins']" ... /></label>
              <label>Channels <input type="number" class="input input-xs input-bordered" [ngModel]="prov.config['channels']" ... /></label>
            </div>
          }
          @case ('modbus_dio') {
            <div class="grid grid-cols-2 gap-2 text-sm">
              <label>UART Bus <select ...>@for bus of uart_buses</select></label>
              <label>Modbus Address <input type="number" ... /></label>
            </div>
          }
          @case ('modbus_adc') { ... similar ... }
        }
      </div>
    }

    @empty {
      <p class="text-sm text-base-content/50">
        No expansion modules configured. Add a module to extend your board's I/O.
      </p>
    }
  </div>
</div>
```

### "Add Module" dialog

A simple dropdown to select module type + auto-generate ID:

| Type | Display Name | Fields |
|------|-------------|--------|
| `analog_mux` | Analog Multiplexer (CD74HC4067) | com_pin (ADC pin picker), sel_pins (multi-pin picker), channels (8 or 16) |
| `modbus_dio` | Modbus Digital I/O (RS485) | bus (UART bus selector), modbus_address (1-247) |
| `modbus_adc` | Modbus Analog Input (RS485) | bus (UART bus selector), modbus_address (1-247), channels (8) |

---

## Step 4: UI — Grouped Pin Selector

**Why fourth**: With providers declared, the pin dropdown needs to show their channels.

### Extend `availablePins()` in SystemEditorService

```typescript
availablePins(cap?: PinCap): (PinDef & { usedBy?: string; provider?: string; providerLabel?: string })[] {
  const result = [];

  // Board pins (existing)
  for (const p of this.boardPins()) {
    if (this.reservedPins().has(p.gpio)) continue;
    if (cap && !p.caps.includes(cap)) continue;
    result.push({ ...p, usedBy: this.usedPins().get(p.gpio), provider: 'board' });
  }

  // Provider channels
  for (const provDef of this.topology()?.device.io_providers ?? []) {
    const driver = createProviderDriver(provDef, this.board()!);
    for (const ch of driver.enumerate()) {
      if (cap && !ch.caps.includes(cap)) continue;
      result.push({
        gpio: ch.fqid,
        connector: ch.fqid,
        edge: 'bottom' as const,
        caps: ch.caps,
        usedBy: this.usedPins().get(ch.fqid),
        provider: provDef.id,
        providerLabel: `${provDef.id} (${provDef.type})`,
      });
    }
  }

  return result;
}
```

### Grouped dropdown in topology-sidebar

```html
<select ...>
  <option value="">-- select --</option>
  <!-- Board pins -->
  <optgroup label="Board">
    @for (pin of boardPinsFiltered; track pin.gpio) {
      <option [value]="pin.gpio" [disabled]="!!pin.usedBy">
        {{ pin.gpio }} [{{ pin.caps.join(', ') }}]{{ pin.usedBy ? ' (' + pin.usedBy + ')' : '' }}
      </option>
    }
  </optgroup>
  <!-- Provider channels -->
  @for (group of providerGroups; track group.id) {
    <optgroup [label]="group.label">
      @for (pin of group.channels; track pin.gpio) {
        <option [value]="pin.gpio" [disabled]="!!pin.usedBy">
          {{ pin.label }} [{{ pin.caps.join(', ') }}]{{ pin.usedBy ? ' (' + pin.usedBy + ')' : '' }}
        </option>
      }
    </optgroup>
  }
</select>
```

### Reserved pins from providers

Update `reservedPins` computed to include provider-consumed pins:
```typescript
readonly reservedPins = computed(() => {
  const reserved = reservedPins(this.board()!);
  // Add pins consumed by I/O providers
  for (const provDef of this.topology()?.device.io_providers ?? []) {
    const driver = createProviderDriver(provDef, this.board()!);
    for (const pin of driver.consumedPins?.() ?? []) {
      reserved.set(pin, `${provDef.type} (${provDef.id})`);
    }
  }
  return reserved;
});
```

### GPIO budget update

The config tab's "Exposed Pins / Reserved / Available" stats should account for provider-consumed pins and show provider-added channels:

```
Exposed: 39  |  Reserved: 9 (+3 MUX)  |  Board Available: 27  |  Expansion: +8 ADC (mux1)
```

---

## Step 5: Modbus DIO Driver (Waveshare IO 8CH)

### New file: `packages/core/src/io-providers/modbus-dio-driver.ts`

```typescript
interface ModbusDioConfig {
  bus: string;              // UART bus ID
  modbus_address: number;   // 1-247
  outputs: number;          // 8 (default)
  inputs: number;           // 8 (default)
}
```

**enumerate()**: Returns `DO1`–`DO8` with `caps: ['digital']` + `DI1`–`DI8` with `caps: ['digital']`.

**resolve("io_exp1:DO3", { purpose: 'digital_out' })**:
```typescript
{ platform: 'modbus_controller', config: 'modbus_controller_id: io_exp1_modbus\n  address: 0x0002\n  register_type: coil\n  bitmask: 1' }
```

**prerequisites()**:
```yaml
modbus_controller:
  - id: io_exp1_modbus
    address: 2
    modbus_id: uart_modbus_modbus
    update_interval: 1s
```

### Safety: Software interlock for valves

When a valve's pins resolve to `modbus_controller` platform, the valve entity
codegen must detect this and replace hardware `interlock` with software equivalent.

Two options:

**Option A**: Valve codegen checks `ResolvedChannel.platform`:
```typescript
const ch = ctx.resolveChannel(node.open_pin, { purpose: 'digital_out', inverted: true });
const needsSoftwareInterlock = ch.platform !== 'gpio';
```

**Option B**: `ResolvedChannel` includes a `features` field:
```typescript
interface ResolvedChannel {
  platform: string;
  config: string;
  supports?: { interlock?: boolean; restoreMode?: boolean };
}
```

Option B is cleaner — entity codegen doesn't need to know platform names. But it's more
complex. **Recommend Option A for now** — simple, explicit, only one entity (valve) needs it.

---

## Step 6: Modbus ADC Driver (Waveshare Analog Input 8CH)

### New file: `packages/core/src/io-providers/modbus-adc-driver.ts`

```typescript
interface ModbusAdcConfig {
  bus: string;
  modbus_address: number;
  channels: number;         // 8
  value_type: string;       // 'U_WORD' (12-bit)
}
```

**resolve("adc_exp1:AI2", { purpose: 'adc' })**:
```typescript
{
  platform: 'modbus_controller',
  config: 'modbus_controller_id: adc_exp1_modbus\n  address: 0x0002\n  register_type: input\n  value_type: U_WORD'
}
```

No safety concerns — sensors only. All ESPHome sensor attributes (filters, on_value, etc.) work.

---

## Step 7: Modbus Flow Meter

Two approaches depending on hardware:

### A. Standalone Modbus flow meter (device-level entity, like VFD)

For meters that report L/min directly over Modbus (ABB, Danfoss, etc.). Create a new entity:

**`packages/core/src/entities/modbus-flow-sensor.ts`**

- `isFlowSensor: true` (plugs into routes.h dispatch)
- Schema: `{ bus, modbus_address, flow_register, total_register, flow_cal }`
- No pin — zero GPIO usage
- Codegen: `platform: modbus_controller` sensor with same `on_value` safety lambda as pulse flow sensor

### B. Low-frequency pulse counting via Modbus DIO

For cheap pulse sensors connected to Waveshare DIO module inputs. This is a software
pulse counter:

- Poll DI channel via `modbus_controller` binary_sensor
- Count edges in C++ lambda (global counter variable)
- Convert count rate to L/min
- Feed into the same flow dispatch

More complex, lower accuracy. Suitable only for large-pipe meters (<25 Hz output).

**Recommend A first** — clean, well-scoped, follows existing VFD pattern.

---

## Summary: Dependency Order

```
Step 1: Schema + persistence          ← foundation, no driver needed
    │
    ├── Step 2: Analog MUX driver     ← proves pipeline, cheapest hardware
    │       │
    │       └── Step 3: UI config     ← declare providers in config tab
    │               │
    │               └── Step 4: UI    ← grouped pin selector with optgroup
    │                     pin sel
    │
    ├── Step 5: Modbus DIO driver     ← needs software interlock (valve safety)
    │
    ├── Step 6: Modbus ADC driver     ← straightforward, no safety concerns
    │
    └── Step 7: Modbus flow meter     ← new entity or DIO polling
```

Steps 2-4 form a natural PR (MUX end-to-end). Steps 5-6 are independent PRs.
Step 7 can ship independently of the provider system (standalone entity like VFD).

---

## Cost Impact (KC868-A16)

| After Step | Valves | Tanks | Flow | Added Cost |
|------------|--------|-------|------|------------|
| Base KC868 | 7+pump | 4 | 3 | — |
| +Step 2 (MUX) | 7+pump | **8-16** | 3 | +$0.50-1 |
| +Step 5 (DIO) | **11+pump** | 4 | 3 | +$30 |
| +Step 6 (ADC) | 7+pump | **12** | 3 | +$32 |
| +Step 7 (Modbus flow) | 7+pump | 4 | **unlimited** | +$50-100/meter |
| All combined | **11+pump** | **16** | **unlimited** | +$113-163 |
