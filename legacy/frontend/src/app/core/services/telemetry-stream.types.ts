/**
 * Normalized telemetry payload from a single device event (API or realtime).
 * Used for latest-value display and for appending points to history series.
 */
export interface TelemetryPayload {
  ts: string;
  data: Record<string, unknown>;
  rssi?: number;
  snr?: number;
}

/**
 * Single time-series point for charts.
 */
export interface TelemetryPoint {
  ts: string;
  value: number;
}

/**
 * Extracts the numeric value for a given field from a telemetry payload.
 * Handles rssi, snr, and arbitrary data fields (number or { value: number }).
 */
export function getFieldValue(payload: TelemetryPayload, field: string): number {
  if (field === 'rssi') {
    return typeof payload.rssi === 'number' ? payload.rssi : 0;
  }
  if (field === 'snr') {
    return typeof payload.snr === 'number' ? payload.snr : 0;
  }
  const v = payload.data[field];
  if (typeof v === 'number') return v;
  if (v != null && typeof v === 'object' && typeof (v as { value?: number }).value === 'number') {
    return (v as { value: number }).value;
  }
  return 0;
}
