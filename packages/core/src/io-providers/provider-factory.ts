/**
 * Provider factory — single source of truth for instantiating IoProviderDriver
 * from an IoProviderDef. Used by both codegen (collect.ts) and UI
 * (SystemEditorService) to avoid duplicating driver creation logic.
 */

import type { IoProviderDriver } from '../io-provider.types';
import type { IoProviderDef } from '../topology.types';
import { createModbusControllerDriver } from './modbus-controller-driver';
import { createExpansionBoardDriver } from './expansion-board-driver';
import { BUILTIN_EXPANSION_BOARDS } from './expansion-board-defs';

export function createProviderDriver(def: IoProviderDef): IoProviderDriver {
  const expansionDef = BUILTIN_EXPANSION_BOARDS[def.type];
  if (expansionDef) {
    return createExpansionBoardDriver(expansionDef, def.config as { bus: string; address: number });
  }

  switch (def.type) {
    case 'modbus_controller':
      return createModbusControllerDriver(def.config as { bus: string; address: number });
    default:
      throw new Error(`Unknown I/O provider type: "${def.type}"`);
  }
}
