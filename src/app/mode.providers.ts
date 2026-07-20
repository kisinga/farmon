import type { EnvironmentProviders, Provider } from '@angular/core';

/**
 * Build-variant providers — empty in the default (cloud) build. The `device`
 * build configuration swaps this file for `mode.providers.device.ts` (via
 * angular.json fileReplacements), which installs the on-device realtime/backend
 * implementations. Keeping the swap in a replaced FILE (not an `if` on an
 * environment flag) means the cloud bundle never references the device classes
 * or the baked topology at all — they tree-shake away completely.
 */
export const modeProviders: (Provider | EnvironmentProviders)[] = [];
