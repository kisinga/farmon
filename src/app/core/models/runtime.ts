/**
 * Runtime (customer dashboard) data shapes — the read side of the event model.
 * These mirror the server's wire JSON; meaning is added in the browser via the
 * core meanings dictionary, never decoded here.
 */

/** A channel's last-known value: numeric `reported` for charts, plus the
 *  human-readable `reported_text` token for categorical channels. For a route's
 *  `route_<id>_state` row, `origin`/`actorLabel` carry who/what started the run
 *  (resolved server-side), so the dashboard can show "by Jane" / "Automation: …". */
export interface ShadowRow {
  controller: string;
  sensor: string;
  reported: number;
  reported_text: string;
  ts: string;
  origin?: string;
  /** Raw initiator user id of the route's current run (route_<id>_state rows) —
   *  resolved to a viewer-relative label against the owner set, same as the feed. */
  actorId?: string;
  /** Server-resolved display name for the actor (used for a co-owner / automation). */
  actorLabel?: string;
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

/** One command result re-asserted in a controller snapshot's `outcomes[]`. The
 *  reliable, self-healing channel for "did my command land": `result` is the
 *  device outcome token (APPLIED/QUEUED/REFUSED/…), `reason` the detail token.
 *  The dashboard correlates by `command_id`; the alerts bell attributes via
 *  `controller`. */
export interface CommandOutcomeRow {
  controller: string;
  command_id: string;
  result: string;
  reason: string;
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
  /** Who/what caused this transition — the same attribution the route snapshot
   *  carries (origin token + a resolved display label), recorded onto the event at
   *  ingest. Lets the timeline attribute a route run the way the commands ledger
   *  attributes a node action. Absent on older rows / SYSTEM transitions. */
  origin?: string;
  /** Raw initiator user id (the route run's actor). Resolved to a viewer-relative
   *  label downstream against the site's owner set (you / co-owner / Support). */
  actorId?: string;
  /** Server-resolved display name for the actor (a user's name/email, an
   *  automation's name) — used as-is for a co-owner or automation; ignored for an
   *  outsider (shown as "Support"). */
  actorName?: string;
}

/** One operator command from the `commands` audit collection, mapped for display.
 *  `status` is sent→done/failed (reconciled from the device outcome echo); `result`
 *  carries the failure/detail reason. `actorId`/`actorName` are the raw initiator
 *  (the issuing user id + resolved name); the viewer-relative label
 *  ("you" / a co-owner's name / "Support") is derived downstream against the site's
 *  owner set, so commands and route transitions resolve identically. */
export interface CommandLogRow {
  id: string;
  controller: string;
  action: string;
  routeId?: number;
  nodeId?: string;
  on?: boolean;
  configKey?: string;
  status: string;
  result: string;
  actorId?: string;
  actorName?: string;
  ts: string;
}

/** One configuration change from the append-only `config_events` log — today,
 *  automation create / edit / enable / disable / delete. The third Activity source,
 *  alongside transitions and commands. `actorId` resolves to a viewer-relative label
 *  downstream (you / co-owner / Support), the same rule as the other two. */
export interface ConfigEventRow {
  controller: string;
  automation: string;
  name: string;
  change: 'added' | 'edited' | 'enabled' | 'disabled' | 'removed';
  actorId?: string;
  actorName?: string;
  ts: string;
}

/** A unified Activity-timeline row: a device state transition, an operator command,
 *  OR a configuration change, merged into one chronological feed. `token` is a badge
 *  token the widget colours via the shared meanings dictionary ('' ⇒ no badge);
 *  `label` is the human line ("route 0" / "Opened Valve 1"); `ok===false` tints the
 *  row as a failure. */
export interface ActivityItem {
  ts: string;
  kind: 'transition' | 'command' | 'config';
  token: string;
  label: string;
  detail?: string;
  /** Resolved initiator for the chip ("you" / a name / an automation's name), the
   *  bare label without a prefix. Present for any attributed row (command or
   *  transition); absent ⇒ no chip. */
  actor?: string;
  /** How `actor` is prefixed, harmonised with the route card: 'AUTOMATION' ⇒
   *  "Automation: <actor>"; 'MANUAL'/undefined ⇒ "you" or "by <actor>". */
  origin?: string;
  /** The actor is an outsider — not the viewer and not a site co-owner, i.e. an
   *  admin who took control. `actor` reads "Support" and the chip is styled as such.
   *  Derived from the owner set, not a role flag. */
  bySupport?: boolean;
  /** Hover detail for the initiator chip — "name · email · co-owner" / the viewer's
   *  email / the Support explainer. '' or absent ⇒ no tooltip. */
  actorTitle?: string;
  ok?: boolean;
}
