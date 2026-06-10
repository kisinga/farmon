/**
 * Runtime (customer dashboard) data shapes — the read side of the event model.
 * These mirror the server's wire JSON; meaning is added in the browser via the
 * core meanings dictionary, never decoded here.
 */

/** A channel's last-known value: numeric `reported` for charts, plus the
 *  human-readable `reported_text` token for categorical channels. */
export interface ShadowRow {
  controller: string;
  sensor: string;
  reported: number;
  reported_text: string;
  desired: number;
  ts: string;
}

/** One history sample. The raw tier carries `value`; rollup tiers carry avg/min/max. */
export interface TelemetryPoint {
  ts: string;
  value?: number;
  avg?: number;
  min?: number;
  max?: number;
}

export interface TelemetryHistory {
  tier: string;
  samples: TelemetryPoint[];
}

/** A controller's presence row from the `controllers` collection. `online` is
 *  set server-side on every ingest and cleared by the retained will message;
 *  `last_seen` is the freshness backstop (an abrupt power loss can leave
 *  `online` true until the broker keepalive lapses). `device_id` == the wire
 *  `{ctrl}` segment == a widget/spec `controller`. */
export interface ControllerRow {
  device_id: string;
  /** Owning site id — needed to attribute cross-site alerts and resolve
   *  per-site thresholds. Empty when read from a site-scoped query. */
  site: string;
  /** false == deregistered/decommissioned (cannot connect to the broker). */
  active: boolean;
  online: boolean;
  last_seen: string;
  firmware_version: string;
}

/** One transition from the append-only `state_events` log (DB `from_state`/
 *  `to_state` are surfaced as `from`/`to`, matching the wire StateEvent). */
export interface StateEventRow {
  controller: string;
  route: number;
  from: string;
  to: string;
  reason: string;
  command_id: string;
  ts: string;
}
