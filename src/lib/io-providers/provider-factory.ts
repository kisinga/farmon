/**
 * Provider factory — single source of truth for instantiating IoProviderDriver
 * from an IoProviderDef. Used by both codegen (collect.ts) and UI
 * (SystemEditorService) to avoid duplicating driver creation logic.
 *
 * Expansion-board definitions are injected via an `ExpansionBoardCatalog`
 * (sourced from the DB-backed board catalog) rather than a hardcoded map, so
 * the set of available expansion boards is data, not code.
 *
 * Dispatch precedence: a `def.type` is resolved against the data-driven
 * `expansionBoards` catalog FIRST, then against the builtin types below.
 * Builtin names (see BUILTIN_PROVIDER_TYPES) are therefore reserved — a catalog
 * entry may not reuse one, and `createProviderDriver` throws if it does.
 */

import type { IoProviderDriver } from '../io-provider.types';
import type { IoProviderDef } from '../topology.types';
import type { ExpansionBoardCatalog } from '../board.types';
import { createModbusControllerDriver } from './modbus-controller-driver';
import { createExpansionBoardDriver } from './expansion-board-driver';

/** Reserved provider types handled in code; catalog keys must not collide. */
const BUILTIN_PROVIDER_TYPES = ['modbus_controller'] as const;

export function createProviderDriver(
  def: IoProviderDef,
  expansionBoards: ExpansionBoardCatalog,
): IoProviderDriver {
  const expansionDef = expansionBoards[def.type];
  if (expansionDef) {
    if ((BUILTIN_PROVIDER_TYPES as readonly string[]).includes(def.type)) {
      throw new Error(
        `Expansion board catalog reuses reserved builtin provider type "${def.type}"`,
      );
    }
    return createExpansionBoardDriver(expansionDef, def.config);
  }

  switch (def.type) {
    case 'modbus_controller':
      return createModbusControllerDriver(def.config);
    default:
      throw new Error(`Unknown I/O provider type: "${def.type}"`);
  }
}

/** A constructed provider driver plus the identity needed to key/label it. */
export interface ProviderDriverEntry {
  id: string;
  type: string;
  driver: IoProviderDriver;
}

/**
 * Build the driver set for a controller's `io_providers` — the ONE place both
 * codegen (collect.ts) and UI (SystemEditorService) turn defs into drivers, so
 * they cannot drift. Throws on an unknown type (correct by construction);
 * callers that want resilience should surface the error, not swallow it.
 *
 * Note: the board driver is not included here — codegen adds it inside
 * `buildResolveChannel`, the UI prepends its own labeled board entry.
 */
export function buildProviderDrivers(
  ioProviders: IoProviderDef[],
  expansionBoards: ExpansionBoardCatalog,
): ProviderDriverEntry[] {
  return ioProviders.map((def) => ({
    id: def.id,
    type: def.type,
    driver: createProviderDriver(def, expansionBoards),
  }));
}
