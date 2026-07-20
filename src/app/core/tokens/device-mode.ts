import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * True in the device-mode build (the dashboard served from the controller's own
 * flash, talking to its `/local/*` endpoints). Components read this to hide
 * cloud-only surfaces (history charts, usage, activity feed, docs, setup) that
 * have no backing endpoint on the device. Provided from the build-time
 * environment so the flag is a compile-time constant per build variant.
 */
export const DEVICE_MODE = new InjectionToken<boolean>('DEVICE_MODE', {
  providedIn: 'root',
  factory: () => environment.deviceMode,
});
