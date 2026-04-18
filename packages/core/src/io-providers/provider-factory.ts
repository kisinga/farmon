/**
 * Provider factory — single source of truth for instantiating IoProviderDriver
 * from an IoProviderDef. Used by both codegen (collect.ts) and UI
 * (SystemEditorService) to avoid duplicating driver creation logic.
 */

import type { IoProviderDriver } from '../io-provider.types';
import type { IoProviderDef } from '../topology.types';
import { createModbusControllerDriver } from './modbus-controller-driver';

export function createProviderDriver(def: IoProviderDef): IoProviderDriver {
  switch (def.type) {
    case 'modbus_controller':
      return createModbusControllerDriver(def.config as { bus: string; address: number });
    default:
      throw new Error(`Unknown I/O provider type: "${def.type}"`);
  }
}
