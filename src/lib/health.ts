/**
 * Device heap health — the runtime signal that actually bites these controllers.
 * A starved heap bootloops the device on MQTT connect (see
 * docs-content/troubleshooting.md); free heap is the binding constraint. The
 * firmware publishes free heap on its telemetry topics and the dashboard turns
 * the last-known value + online state into a single health level.
 *
 * One definition, two consumers: the MQTT generator publishes HEAP_FREE_SENSOR /
 * HEAP_MIN_SENSOR and the dashboard reads those same shadow channels — no drift.
 */

/** Telemetry `sensor` segment names for the heap diagnostics (wire + shadow).
 *  `heap_total` is the managed-heap pool size the device reports from
 *  `heap_caps_get_total_size()` — the deterministic, partition-aware denominator
 *  for the dashboard's RAM gauge (free-against-total). It's the exact counterpart
 *  to `heap_free` (= `heap_caps_get_free_size()`); only the chip knows it at
 *  runtime, so we read it from the device rather than guessing a constant. */
export const HEAP_FREE_SENSOR = 'heap_free';
export const HEAP_MIN_SENSOR = 'heap_min';
export const HEAP_TOTAL_SENSOR = 'heap_total';

/**
 * The other on-device diagnostics the firmware ships alongside heap: wifi signal
 * strength (dBm; wifi transport only), uptime (seconds), and SoC temperature
 * (°C). Same single-source contract as the heap channels — the MQTT generator
 * publishes these `sensor` names and the dashboard's controller panel reads the
 * matching shadow rows, so the two can never drift.
 */
export const WIFI_SIGNAL_SENSOR = 'wifi_signal';
export const UPTIME_SENSOR = 'uptime';
export const TEMP_SENSOR = 'esp_temp';

/**
 * Free-heap thresholds in bytes — tune here. Sized from the esp32 + TLS +
 * web_server build: a healthy controller idles ~90-110 KB free; the bootloop
 * cliff was ~1.5 KB. WARN leaves generous margin before trouble; CRIT is the
 * "act now" line. (Runtime-editable config is a deliberate non-goal for now.)
 */
export const HEAP_WARN_BYTES = 30_000;
export const HEAP_CRIT_BYTES = 12_000;

/** A controller's health, worst-last for severity ordering. */
export type HealthLevel = 'healthy' | 'warning' | 'critical' | 'offline';

/** Higher = more urgent. Used to fold many controllers into one site level. */
export const HEALTH_SEVERITY: Record<HealthLevel, number> = {
  healthy: 0,
  warning: 1,
  offline: 2,
  critical: 3,
};

/**
 * One controller's health from presence + last-known free heap.
 * `heapFree === null` (never reported — older firmware or not yet seen) means
 * heap is not judged: health rides on presence alone.
 */
export function controllerHealth(input: { online: boolean; heapFree: number | null }): HealthLevel {
  if (!input.online) return 'offline';
  if (input.heapFree === null) return 'healthy';
  if (input.heapFree <= HEAP_CRIT_BYTES) return 'critical';
  if (input.heapFree <= HEAP_WARN_BYTES) return 'warning';
  return 'healthy';
}

/** Site health = the most urgent controller level (empty site = offline). */
export function worstHealth(levels: HealthLevel[]): HealthLevel {
  if (levels.length === 0) return 'offline';
  return levels.reduce((worst, l) => (HEALTH_SEVERITY[l] > HEALTH_SEVERITY[worst] ? l : worst), 'healthy');
}
