# Node System Refactor — Before/After and Known Limits

## Before (starting state)

| Area | State |
|------|-------|
| **Type safety** | Codegen used `Record<string, any>` everywhere; `node['pin']` string indexing |
| **Shared utilities** | `escXml` duplicated in 3 files |
| **Dispatch flags** | 4 flags in graph (`isPump`, `isValve`, `isFlowSensor`, `routeSource`); `isLevelSensor` and `isPressureSensor` missing from graph layer |
| **Graph encapsulation** | `conflicts.ts` reached through graph to `NODE_REGISTRY` for `conflictClass` |
| **Flow constraints** | Only pump, valve, endpoint declared constraints; 4 entities had none |
| **Experimental entities** | Filter + dosing pump: UI-only, no codegen, no constraints, no dashboard cards |
| **Codegen indentation** | Each entity returned 2-space-indented YAML; generators concatenated with `.join()` — implicit contract |
| **Pin validation** | Fallback checked all pins as required; entities with `rules` silently skipped fallback; optional pins errored |
| **Disabled filtering** | `activeTopology()` (flat) + `activeGraph()` (graph) — two implementations |
| **Dead code** | `EntityCodegen.dashboard` defined but never used; `activeTopology()` had zero callers |
| **Exports** | `VfdNode` not exported; `REGISTRY_RULES` defined but not wired into runner |
| **Dashboard** | No cards for pressure sensor, filter, dosing pump, VFD |
| **Validation rules** | Hardcoded pump-singleton check in runner |

## After (current state)

| Area | State |
|------|-------|
| **Type safety** | `EntityCodegen<T>` generic; all codegen uses typed node access (`.pin` not `['pin']`); `TypedDescriptor<T>` facade for narrowed access |
| **Shared utilities** | `escXml` in `schemas.ts`; `indent()`/`joinYamlItems()` in `yaml-fragment.ts` |
| **Dispatch flags** | 6 flags in graph: added `isLevelSensor`, `isPressureSensor`, `conflictClass` to `NodeAttrs` |
| **Graph encapsulation** | `conflicts.ts` reads `conflictClass` from graph attrs; no `NODE_REGISTRY` import |
| **Flow constraints** | All 10 entities have constraints or are terminal/infrastructure nodes |
| **Experimental entities** | Filter: differential pressure codegen + dashboard. Dosing pump: GPIO relay codegen + dashboard. Both still `experimental: true` |
| **Codegen indentation** | Entity codegen returns zero-indented; `joinYamlItems()` handles indent at join point — single place |
| **Pin validation** | Schema-derived via `ZodObject.isOptional()` — always runs, required/optional from Zod |
| **Disabled filtering** | `activeTopology()` deleted; `isNodeActive` predicate is single source of truth |
| **Dead code** | `EntityCodegen.dashboard` removed; `active-topology.ts` deleted |
| **Exports** | `VfdNode` exported; `REGISTRY_RULES` wired into runner; `TypedDescriptor` exported |
| **Dashboard** | Cards for all entity types: pressure gauges, filter delta, dosing relay, VFD monitoring |
| **Validation rules** | `REGISTRY_RULES` array iterated by runner; hardcoded pump-singleton removed |

## Known gaps and hard limits

### Hard limits (by design, not bugs)

| Limit | Reason |
|-------|--------|
| `experimental: true` stays on filter + dosing pump | Remove after hardware validation on real devices |
| YAML validation is ESPHome's job | We ensure correct-by-construction via zero-indent contract; `esphome compile` is the authoritative validator |
| `NodeDescriptor` is not generic | Registry stores `NodeDescriptor[]`; generics require `getTypedDescriptor<T>()` facade at call sites |
| `renderSvg` / `defaultData` still take `Record<string, any>` | Typed via facade only; making `NodeDescriptor` generic would require existential types TS doesn't support |
| Dashboard generator is imperative, not entity-driven | Removed the dead `EntityCodegen.dashboard` field; dashboard builds cards via `nodesByKind()` |
| `isPressureSensor` / `isLevelSensor` in graph but unused by route analysis | Forward infrastructure; route analysis only needs pump/valve/flowSensor |

### Known gaps (not blocking, should be tracked)

| Gap | Impact | When to fix |
|-----|--------|-------------|
| Redundant pin validation on pressure-sensor (entity rule + generic check both fire for empty pin) | Double error message for the same field | Deduplicate when adding more entity rules |
| No tests for filter/dosing codegen, REGISTRY_RULES, or new constraints | Silent regression risk on new code paths | Next test sprint |
| `evaluate-constraints.ts` still imports `NODE_REGISTRY` | Inconsistent with conflicts.ts being self-contained; constraint evaluation needs descriptor constraints which live on the registry | Refactor if constraints move to NodeAttrs |
| Dosing pump has `conflictClass: 'actuator'` but no `isPump` | Participates in conflict detection but not pump refcounting; correct semantically but may confuse contributors | Add code comment documenting the design decision |
