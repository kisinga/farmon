/**
 * Entity state → CSS class bucket mapping.
 */
import type { StateBucket } from './schema';

/** Map a hass entity state string to a coarse bucket. Mirror of core/ha.ts. */
export function stateBucket(state: string | undefined): StateBucket {
  if (state == null) return 'unknown';
  const s = state.toLowerCase();
  if (s === 'unavailable') return 'unavailable';
  if (s === 'unknown' || s === 'none') return 'unknown';
  if (s === 'on' || s === 'open' || s === 'opening' || s === 'home' || s === 'active' || s === 'heat' || s === 'cool') return 'on';
  if (s === 'off' || s === 'closed' || s === 'closing' || s === 'away' || s === 'idle' || s === 'standby') return 'off';
  if (s === 'problem' || s === 'fault' || s === 'error') return 'fault';
  const n = Number(s);
  if (Number.isFinite(n)) return 'on';
  return 'unknown';
}

export const STATE_CLASSES: readonly `state-${StateBucket}`[] = [
  'state-on', 'state-off', 'state-unavailable', 'state-fault', 'state-unknown',
] as const;

/** Apply the correct `state-*` class to a node group, removing others. */
export function applyStateClass(el: Element, bucket: StateBucket): void {
  for (const cls of STATE_CLASSES) el.classList.remove(cls);
  el.classList.add(`state-${bucket}`);
}
