import type { EnvironmentProviders, Provider } from '@angular/core';
import { provideEchartsCore } from 'ngx-echarts';

/**
 * Build-variant providers — the `device` build configuration swaps this file for
 * `mode.providers.device.ts` (via angular.json fileReplacements), which installs
 * the on-device realtime/backend implementations. Keeping the swap in a replaced
 * FILE (not an `if` on an environment flag) means the cloud bundle never
 * references the device classes or the baked topology at all — they tree-shake
 * away completely.
 *
 * ECharts lives here (not app.config.ts) because the lazy `import('echarts')`
 * chunk is ~1.1 MB: with the provider in the cloud-only file, the device build
 * never references echarts and the chunk is never emitted — critical for the
 * on-device flash budget (device mode renders no charts).
 */
export const modeProviders: (Provider | EnvironmentProviders)[] = [
  provideEchartsCore({ echarts: () => import('echarts') }),
];
