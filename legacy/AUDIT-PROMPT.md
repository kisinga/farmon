# Architecture Audit Prompt

Use this prompt with an LLM (Claude, GPT-4, etc.) to audit the MajiFlow codegen and entity system. Feed it this prompt, then provide the files it asks for.

---

## Prompt

You are a senior software architect auditing a code generation system called MajiFlow. It generates ESPHome firmware (YAML + C++) for water management controllers from a visual topology editor.

### System overview

The user draws a topology (tanks, valves, pumps, flow sensors connected by pipes). The system:
1. Validates the topology (Zod schemas, entity rules, flow constraints)
2. Derives routes (all valid source-to-destination water paths via graph traversal)
3. Detects conflicts (shared sensors between routes)
4. Generates ESPHome firmware: a C++ route table/state machine (`routes.h`), YAML configuration files (`sensors.yaml`, `hardware.yaml`, `control.yaml`, device YAML)

### Architecture layers

```
Topology (user input)
  -> Zod validation (topology-schema.ts, entity schemas)
  -> Graph construction (topology-graph.ts)
  -> Route derivation (graph/routes.ts)
  -> Conflict detection (graph/conflicts.ts)
  -> Manifest (topology-to-manifest.ts)
  -> Code generation (electron/lib/generators/*.ts)
  -> ESPHome YAML + C++ output
```

### Key types

**`NodeDescriptor`** -- each entity kind registers one. Contains:
- Graph role: `role` ('terminal' | 'passthrough'), `routeSource`
- Dispatch flags: `isPump`, `isValve`, `isFlowSensor`, `isLevelSensor`, `conflictClass`
- Codegen hooks: `sensors()`, `hardware()`, `substitutions()`, `globals()`, `extraComponents()`
- Validation: `rules[]`, `constraints[]`
- UI: `renderSvg()`, `sidebarFields`, `color`, `size`

**`EntityCodegen`** hooks:
- `sensors(node, idx) -> string` -- YAML for `sensor:` section
- `hardware(node, idx) -> string` -- YAML for `switch:` section
- `globals(node) -> string` -- C++ globals
- `substitutions(node) -> string[]` -- device YAML substitutions
- `extraComponents(node, idx) -> Record<string, string>` -- keyed by ESPHome section name (number, cover, button, binary_sensor, etc.)

**Section ownership**: `hardware.ts` generator owns `cover` from extraComponents; `sensors.ts` generator owns everything else.

**`ManifestNode`** = `Record<string, any> & { kind: string; id: string }` -- intentionally loose for generator flexibility.

**`Route` (manifest)**: `{ valves[], flow_sensor, needs_pump, source_type, destination, max_runtime_seconds, ... }`

**State machine contract**: The generated C++ state machine references ESPHome components by ID convention:
- `pump_relay` -- the pump switch (GPIO or Modbus, doesn't matter)
- `{valve_id}` -- valve cover
- `{valve_id}_open_pin` / `{valve_id}_close_pin` -- valve switches
- `{flow_id}` -- flow sensor
- `{tank_id}_level` -- tank level sensor

### Entity files (10 total)

Each in `packages/core/src/entities/`:
`tank.ts`, `pump.ts`, `valve.ts`, `endpoint.ts`, `flow-sensor.ts`, `water-source.ts`, `pressure-sensor.ts`, `filter.ts`, `dosing-pump.ts`, `vfd.ts`

Each exports a Zod schema, a TypeScript type, and a `NodeDescriptor` with dispatch flags and codegen.

### Generator files

Each in `electron/lib/generators/`:
- `routes.ts` (401 lines) -- generates `routes.h`: C++ route table, slot management, dispatch functions, queue
- `control.ts` (350 lines) -- generates `control.yaml`: state machine, API services, safety watchdog
- `device-yaml.ts` (293 lines) -- generates device YAML: substitutions, packages, boot sequence, OLED
- `sensors.ts` (218 lines) -- generates `sensors.yaml`: sensor/number/text_sensor/binary_sensor/globals sections
- `hardware.ts` (54 lines) -- generates `hardware.yaml`: switch/cover sections

### What to audit

Please review the following dimensions. For each, identify specific issues with file paths and line numbers.

**1. Correctness**
- Do the dispatch flags correctly propagate through graph -> manifest -> generators?
- Are there entity-specific assumptions still hard-coded in generators that would break for a new entity using the same flags?
- Does the `extraComponents` section ownership (hardware.ts owns 'cover', sensors.ts owns everything else) have edge cases?
- Is the `pump_relay` ID convention enforced or just assumed?
- Can two entities of the same kind exist in a topology? What breaks?

**2. Consistency**
- Are the component ID naming conventions documented and enforced, or just convention?
- Do all codegen hooks receive the same context? (e.g., `extraComponents` gets `(node, idx)` but `globals` gets `(node)` -- is this inconsistent?)
- Is `ManifestNode` as `Record<string, any>` a liability? What type safety is lost?

**3. Completeness**
- What ESPHome component types are not covered by any codegen hook?
- Are there entities with codegen that reference globals/IDs from other entities without declaring a dependency?
- Does the validation layer catch all cases where codegen would produce invalid ESPHome YAML?

**4. Extensibility**
- Adding a new entity: which files must be touched? Are there undocumented steps?
- Adding a new ESPHome section (e.g., `select:`, `climate:`): what changes?
- What happens if an entity needs to emit components in the device YAML (not sensors.yaml or hardware.yaml)?
- What if two entities need to coordinate (e.g., a VFD pump + a separate Modbus power meter on the same bus)?

**5. Safety**
- The state machine in `control.ts` and `routes.ts` is safety-critical. What assumptions does it make about entity codegen output?
- If an entity's `hardware()` hook produces invalid YAML, does anything catch it before ESPHome compilation?
- What happens if a route has no flow sensor (route.valid = false) -- does it silently disappear or error?

**6. Generated output quality**
- Is the generated YAML/C++ human-readable and debuggable?
- Are there unnecessary duplications in the generated output?
- Do the generated C++ dispatch functions scale (switch-case over indices)?

### How to proceed

Ask me to provide the full contents of specific files you need to review. Start with the files most relevant to your findings. Don't try to review everything -- focus on the highest-risk areas first.
