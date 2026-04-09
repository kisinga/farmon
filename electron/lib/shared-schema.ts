/**
 * Re-exports from @far-mon/core.
 * Domain schemas now live in the core package.
 */
export {
  GpioPin,
  ComponentId,
  DeviceSchema,
  TimingSchema,
  AutomationSchema,
} from '@far-mon/core';

export type { Device, Timing } from '@far-mon/core';
