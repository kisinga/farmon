import type { EnvironmentProviders, Provider } from '@angular/core';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { BackendService } from '../core/services/backend.service';
import { RealtimeService } from '../core/services/realtime.service';
import { AutomationsService } from '../pages/automations/automations.service';
import { DeviceBackendService } from './device-backend.service';
import { DeviceRealtimeService } from './device-realtime.service';
import { DeviceAutomationsService } from './device-automations.service';

/**
 * The device-mode seam: swap the dashboard's only two network surfaces for the
 * on-device implementations. Reads flow through DeviceRealtimeService (the
 * `/local/state` SSE stream, projected through the same explodeSnapshot path the
 * PocketBase feed uses); writes flow through DeviceBackendService (`/local/command`
 * fetch + the baked topology); automations flow through DeviceAutomationsService
 * (`/local/automations` wire blob). Everything downstream — DashboardStore, the
 * command lifecycle, every widget — is untouched.
 *
 * HashLocationStrategy: the controller serves the app from flash and only knows
 * `/` — a deep-link refresh on a path URL (e.g. /site/local/dashboard) would 404.
 * Hash URLs keep the route client-side, so refresh/deep-link always hits `/`.
 * Registered here (after provideRouter in app.config.ts, so it wins) so the cloud
 * build keeps PathLocationStrategy untouched.
 *
 * Referenced only from the device build's app config, so both classes tree-shake
 * out of the cloud build.
 */
export const deviceProviders: (Provider | EnvironmentProviders)[] = [
  { provide: LocationStrategy, useClass: HashLocationStrategy },
  { provide: RealtimeService, useClass: DeviceRealtimeService },
  { provide: BackendService, useClass: DeviceBackendService },
  { provide: AutomationsService, useClass: DeviceAutomationsService },
];
