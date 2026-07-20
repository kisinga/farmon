import type { EnvironmentProviders, Provider } from '@angular/core';
import { deviceProviders } from './device/device.providers';

/** Device-build swap for mode.providers.ts — see that file for how the swap works. */
export const modeProviders: (Provider | EnvironmentProviders)[] = deviceProviders;
