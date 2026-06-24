import { Injectable, inject, signal } from '@angular/core';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import type { ControllerSnapshot } from '@core';
import { BackendService } from './backend.service';
import type { ShadowRow, TelemetryHistory, StateEventRow, ControllerRow, CommandOutcomeRow, CommandLogRow, ConfigEventRow, UsageReport, UsageRun } from '../models/runtime';

/** Liveness of the PocketBase realtime SSE stream. `connecting` is the idle
 *  state before anything subscribes; the dashboard banner only reacts to
 *  `disconnected`. */
export type RealtimeConnection = 'connecting' | 'connected' | 'disconnected';

/**
 * RealtimeService — the runtime telemetry I/O gateway: shadow + history reads
 * over the `/api/farmon` endpoints, and live shadow/transition updates over
 * PocketBase realtime. It reuses BackendService's single authenticated PB
 * client. This is the only place the dashboard touches the network; the stores
 * sit on top of it. (Customer-side: it must not pull in the editor services.)
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private backend = inject(BackendService);
  private get pb() {
    return this.backend.pb;
  }

  private _connection = signal<RealtimeConnection>('connecting');
  /** Live SSE stream state, shared across all subscribers. */
  readonly connection = this._connection.asReadonly();
  private connectionWired = false;

  /** Wire the SDK's connect/disconnect hooks exactly once. The SDK auto-reconnects
   *  on its own; this only mirrors its state into a signal. Centralized here so
   *  multiple subscribers can't clobber the single `onDisconnect` slot. Called
   *  lazily on first subscribe so we never open a stream when the app is idle. */
  private wireConnection(): void {
    if (this.connectionWired) return;
    this.connectionWired = true;
    // The special PB_CONNECT topic fires on every (re)connect of the stream.
    void this.pb.realtime.subscribe('PB_CONNECT', () => this._connection.set('connected'));
    // A non-empty active-subs list means the drop was unexpected (we still want
    // those subscriptions) — surface it; an empty list is a clean teardown.
    this.pb.realtime.onDisconnect = (activeSubscriptions) => {
      this._connection.set(activeSubscriptions.length ? 'disconnected' : 'connected');
    };
  }

  /** Current shadow for a site: one controller_state doc per controller, exploded
   *  back into the per-channel rows the dashboard reads, plus the re-asserted
   *  command `outcomes` (the reliable "did my command land" channel) so a result
   *  that arrived before page load is seeded too. */
  async latest(siteId: string): Promise<{ rows: ShadowRow[]; outcomes: CommandOutcomeRow[] }> {
    const docs = await this.pb.send<{ controller: string; snapshot: string; ts: string }[]>(
      `/api/farmon/latest?site=${encodeURIComponent(siteId)}`,
      { method: 'GET' },
    );
    const rows: ShadowRow[] = [];
    const outcomes: CommandOutcomeRow[] = [];
    for (const d of docs) {
      const snap = parseSnap(d.snapshot);
      if (!snap) continue;
      rows.push(...explodeSnapshot(d.controller, snap, d.ts));
      outcomes.push(...snapOutcomes(d.controller, snap));
    }
    return { rows, outcomes };
  }

  /** Billing-grade usage for a site over a period: per-run line items (both axes),
   *  totals, and per-route continuity, read from the immutable runs ledger via the
   *  `/usage` facade. This is the authoritative source for delivered water, replacing
   *  the old client-side rate integration. Optional controller/route narrow scope. */
  usage(
    siteId: string,
    from: Date,
    to: Date,
    opts?: { controller?: string; route?: number },
  ): Promise<UsageReport> {
    const q = new URLSearchParams({
      site: siteId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (opts?.controller) q.set('controller', opts.controller);
    if (opts?.route != null) q.set('route', String(opts.route));
    return this.pb.send<UsageReport>(`/api/farmon/usage?${q.toString()}`, { method: 'GET' });
  }

  /** Numeric history for a channel; the server picks the tier from the span. */
  history(
    siteId: string,
    controller: string,
    sensor: string,
    from: Date,
    to: Date,
  ): Promise<TelemetryHistory> {
    const q = new URLSearchParams({
      site: siteId,
      controller,
      sensor,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return this.pb.send<TelemetryHistory>(`/api/farmon/telemetry?${q.toString()}`, {
      method: 'GET',
    });
  }

  /** Most-recent transitions for a site (newest first). */
  async recentEvents(siteId: string, limit = 100): Promise<StateEventRow[]> {
    const res = await this.pb.collection('state_events').getList(1, limit, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-ts',
      requestKey: `events:${siteId}`,
    });
    return res.items.map((r) => toEvent(r));
  }

  /** Most-recent completed runs for a site (newest first), read straight from the
   *  durable `runs` collection — lean (newest-N) and live-subscribable, unlike the
   *  30d `/usage` facade (which the totals widget still uses for its window). */
  async recentRuns(siteId: string, limit = 100): Promise<UsageRun[]> {
    const res = await this.pb.collection('runs').getList(1, limit, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-started_at',
      requestKey: `runs:${siteId}`,
    });
    return res.items.map((r) => toRun(r));
  }

  /** Live completed-run inserts for a site (the run record is created when the
   *  device ships it, so this fires exactly when a run lands — no clock-skew join). */
  async subscribeRuns(siteId: string, cb: (row: UsageRun) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('runs').subscribe('*', (e) => {
      if (e.action === 'create') cb(toRun(e.record));
    }, { filter: this.pb.filter('site = {:s}', { s: siteId }) });
  }

  /** Controller presence rows (online + last_seen) for a site. */
  async controllers(siteId: string): Promise<ControllerRow[]> {
    const items = await this.pb.collection('controllers').getFullList({
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      requestKey: `controllers:presence:${siteId}`,
    });
    return items.map(toController);
  }

  /** The site's configured offline timeout in seconds (0/unset → caller defaults).
   *  Drives the dashboard's presence freshness window so it matches the alert
   *  staleness threshold — one number, no drift. */
  async siteOfflineSeconds(siteId: string): Promise<number> {
    const r = await this.pb
      .collection('sites')
      .getOne(siteId, { requestKey: `site:offline:${siteId}` });
    return Number(r['offline_timeout_s']) || 0;
  }

  /** Live controller presence updates for a site. Returns an unsubscribe function. */
  subscribeControllers(siteId: string, cb: (row: ControllerRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('controllers').subscribe(
      '*',
      (e) => cb(toController(e.record)),
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** Live shadow updates for a site: one controller_state doc per controller per
   *  interval, exploded into its per-channel rows plus the snapshot's re-asserted
   *  command `outcomes`. Returns an unsubscribe function. */
  subscribeShadow(
    siteId: string,
    cb: (rows: ShadowRow[], outcomes: CommandOutcomeRow[]) => void,
  ): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('controller_state').subscribe(
      '*',
      (e) => {
        const snap = parseSnap(e.record['snapshot']);
        if (snap) cb(explodeSnapshot(e.record['controller'], snap, e.record['ts']), snapOutcomes(e.record['controller'], snap));
      },
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** Live transition inserts for a site. Returns an unsubscribe function. */
  subscribeEvents(siteId: string, cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('state_events').subscribe(
      '*',
      (e) => {
        if (e.action === 'create') cb(toEvent(e.record));
      },
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** Recent operator commands for a site (newest first) — the audit feed behind
   *  the Activity timeline. Expands `issued_by` so history rows can name the
   *  initiator. */
  async recentCommands(siteId: string, limit = 100): Promise<CommandLogRow[]> {
    const res = await this.pb.collection('commands').getList(1, limit, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-created',
      expand: 'issued_by',
      requestKey: `commands:${siteId}`,
    });
    return res.items.map((r) => toCommandLog(r));
  }

  /** Live command inserts/updates for a site (a command lands as `sent`, then the
   *  device outcome reconciles it to done/failed). Returns an unsubscribe function. */
  subscribeCommands(siteId: string, cb: (row: CommandLogRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('commands').subscribe(
      '*',
      (e) => cb(toCommandLog(e.record)),
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** Most-recent configuration changes for a site (newest first) — the third
   *  Activity source: automation create/edit/enable/disable/delete. */
  async recentConfigEvents(siteId: string, limit = 100): Promise<ConfigEventRow[]> {
    const res = await this.pb.collection('config_events').getList(1, limit, {
      filter: this.pb.filter('site = {:s}', { s: siteId }),
      sort: '-ts',
      requestKey: `config_events:${siteId}`,
    });
    return res.items.map((r) => toConfigEvent(r));
  }

  /** Live config-change inserts for a site (the log is append-only). Returns an
   *  unsubscribe function. */
  subscribeConfigEvents(siteId: string, cb: (row: ConfigEventRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('config_events').subscribe(
      '*',
      (e) => { if (e.action === 'create') cb(toConfigEvent(e.record)); },
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  // --- Cross-site reads for the global alerts center ---------------------------
  // These omit the per-site filter; PocketBase view rules already scope every
  // collection to the rows the signed-in user may see (their sites, or all for
  // an admin). The alerts store attributes each row to a site via the controller
  // map, so it needs no extra context here.

  /** All controller presence rows the user can see. */
  async allControllers(): Promise<ControllerRow[]> {
    const items = await this.pb.collection('controllers').getFullList({
      requestKey: 'controllers:all',
    });
    return items.map(toController);
  }

  /** Live controller presence updates across all visible sites. */
  subscribeAllControllers(cb: (row: ControllerRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('controllers').subscribe('*', (e) => cb(toController(e.record)));
  }

  /** Most-recent transitions across all visible sites (newest first). */
  async recentEventsAll(limit = 200): Promise<StateEventRow[]> {
    const res = await this.pb.collection('state_events').getList(1, limit, {
      sort: '-ts',
      requestKey: 'events:all',
    });
    return res.items.map((r) => toEvent(r));
  }

  /** Live transition inserts across all visible sites. */
  subscribeAllEvents(cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('state_events').subscribe('*', (e) => {
      if (e.action === 'create') cb(toEvent(e.record));
    });
  }

  /** Current tank-level shadows + command outcomes across all visible sites, from
   *  the one controller_state stream the alerts bell already taps. Levels are
   *  filtered to `*_level` so the store never holds the full shadow; outcomes ride
   *  along for the "command did not apply" warning. */
  async levelShadows(): Promise<{ levels: ShadowRow[]; outcomes: CommandOutcomeRow[] }> {
    const docs = await this.pb.collection('controller_state').getFullList({ requestKey: 'shadow:levels' });
    const levels: ShadowRow[] = [];
    const outcomes: CommandOutcomeRow[] = [];
    for (const d of docs) {
      const snap = parseSnap(d['snapshot']);
      if (!snap) continue;
      for (const r of explodeSnapshot(d['controller'], snap, d['ts'])) {
        if (r.sensor.endsWith('_level')) levels.push(r);
      }
      outcomes.push(...snapOutcomes(d['controller'], snap));
    }
    return { levels, outcomes };
  }

  /** Live tank-level shadow + command-outcome updates across all visible sites.
   *  Delivers one doc at a time: its level rows and its re-asserted outcomes. */
  subscribeLevelShadows(
    cb: (levels: ShadowRow[], outcomes: CommandOutcomeRow[]) => void,
  ): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('controller_state').subscribe('*', (e) => {
      const snap = parseSnap(e.record['snapshot']);
      if (!snap) return;
      const levels = explodeSnapshot(e.record['controller'], snap, e.record['ts'])
        .filter((r) => r.sensor.endsWith('_level'));
      cb(levels, snapOutcomes(e.record['controller'], snap));
    });
  }
}

/** A controller_state.snapshot is JSON text over the API and a parsed object over
 *  realtime — accept both. */
function parseSnap(v: unknown): ControllerSnapshot | null {
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && typeof o === 'object' ? (o as ControllerSnapshot) : null;
  } catch {
    return null;
  }
}

/** Explode one controller snapshot into the per-channel ShadowRows the widgets read
 *  (keyed `${controller}/${sensor}`), so the collapsed doc keeps the same read API. */
function explodeSnapshot(controller: string, snap: ControllerSnapshot, ts: string): ShadowRow[] {
  const rows: ShadowRow[] = [];
  const num = (sensor: string, reported: number) => rows.push({ controller, sensor, reported, reported_text: '', ts });
  const txt = (sensor: string, reported_text: string) => rows.push({ controller, sensor, reported: 0, reported_text, ts });
  for (const [s, v] of Object.entries(snap.readings ?? {})) num(s, v);
  for (const [s, v] of Object.entries(snap.text ?? {})) txt(s, v);
  if (snap.system) {
    txt('system_state', snap.system.state);
    num('queue_depth', snap.system.queue);
    num('safety_override', snap.system.safety ? 1 : 0);
  }
  for (const r of snap.routes ?? []) {
    rows.push({ controller, sensor: `route_${r.id}_state`, reported: 0, reported_text: r.state, ts, origin: r.origin, actorId: r.actor, actorLabel: r.actorLabel, live: r.live });
  }
  return rows;
}

/** Pull a snapshot's re-asserted command outcomes into per-controller rows (the
 *  reliable "did my command land" channel — see {@link CommandOutcomeRow}). */
function snapOutcomes(controller: string, snap: ControllerSnapshot): CommandOutcomeRow[] {
  return (snap.outcomes ?? []).map((o) => ({
    controller,
    command_id: o.command_id,
    result: o.result,
    reason: o.reason,
  }));
}

function toController(r: RecordModel): ControllerRow {
  return {
    device_id: r['id'], // the record id IS the device_id
    site: r['site'] ?? '',
    active: r['active'] !== false,
    online: r['online'],
    last_seen: r['last_seen'],
    firmware_version: r['firmware_version'],
  };
}

function toEvent(r: RecordModel): StateEventRow {
  // Raw facts only — the viewer-relative label (you / co-owner / Support) is
  // resolved downstream against the site owner set, so transitions and commands
  // resolve through one rule (see DashboardStore / resolveInitiator).
  return {
    controller: r['controller'],
    route: r['route'],
    from: r['from_state'],
    to: r['to_state'],
    reason: r['reason'],
    command_id: r['command_id'],
    ts: r['ts'],
    origin: r['origin'] || undefined,
    actorId: r['actor'] || undefined,
    actorName: r['actor_label'] || undefined,
  };
}

/** Map a `runs` record to a UsageRun. This is the SECOND producer of UsageRun and
 *  must stay in sync with the `/usage` facade (maji-server/internal/api/routes.go):
 *  same field names and the same delivered = end - start (metered only) rule. It
 *  additionally carries the raw initiator id (`actor`) as `actor_id` so the live
 *  feed can resolve who-ran-it viewer-relatively (the facade path doesn't emit it). */
function toRun(r: RecordModel): UsageRun {
  const metered = !!r['metered'];
  const start = Number(r['start_litres']) || 0;
  const end = Number(r['end_litres']) || 0;
  return {
    run_id: r['run_id'] ?? '',
    controller: r['controller'] ?? '',
    route: Number(r['route']) || 0,
    started_at: r['started_at'] ?? '',
    ended_at: r['ended_at'] ?? '',
    duration_s: Number(r['duration_s']) || 0,
    stop_reason: r['stop_reason'] ?? '',
    origin: r['origin'] ?? '',
    actor_label: r['actor_label'] ?? '',
    actor_id: r['actor'] || undefined,
    fault: r['fault'] ?? '',
    metered,
    // Clamp: a counter rollback / out-of-order re-assert could give end < start.
    delivered_l: metered ? Math.max(0, end - start) : null,
  };
}

/** Map a `commands` record to a display row carrying raw facts only — the issuing
 *  user id (`issued_by`) + the expanded display name. The viewer-relative label
 *  (you / co-owner / Support) is resolved downstream against the site owner set, so
 *  a node command and a route transition read the same. `expand: 'issued_by'` on the
 *  history fetch supplies the name. */
function toCommandLog(r: RecordModel): CommandLogRow {
  const expanded = (r['expand'] as Record<string, RecordModel> | undefined)?.['issued_by'];
  const name = expanded?.['name'] || expanded?.['email'];
  return {
    id: r['id'],
    controller: r['controller'],
    action: r['action'],
    routeId: r['route_id'] ?? undefined,
    nodeId: r['node_id'] || undefined,
    on: typeof r['node_on'] === 'boolean' ? r['node_on'] : undefined,
    configKey: r['config_key'] || undefined,
    status: r['status'] ?? 'sent',
    result: r['result'] || '',
    actorId: r['issued_by'] || undefined,
    actorName: name || undefined,
    // Normalise PocketBase's space-separated autodate ("2026-…14 20:47:01.123Z")
    // to ISO 8601 so it parses + sorts identically to the RFC3339 transition
    // timestamps it's merged with in the activity feed (see DashboardStore.activityFor).
    ts: toIso(r['created']),
  };
}

/** Map a `config_events` record to a display row carrying raw facts only. `actor`
 *  is the bare user id (a plain text column, not a relation — robust to superusers
 *  and to the automation being deleted); the viewer-relative label is resolved
 *  downstream against the site owner set, the same as commands and transitions. `ts`
 *  is already RFC3339 (server-stamped), so it sorts identically without normalising. */
function toConfigEvent(r: RecordModel): ConfigEventRow {
  return {
    controller: r['controller'],
    automation: r['automation'],
    name: r['name'] || '',
    change: r['change'],
    actorId: r['actor'] || undefined,
    actorName: undefined,
    ts: r['ts'],
  };
}

/** PocketBase autodate ("YYYY-MM-DD HH:MM:SS.sssZ") → ISO 8601 (T-separated). The
 *  activity feed merges these with RFC3339 transition timestamps; a space-separated
 *  string is not valid ISO and parses inconsistently across engines, so normalise. */
function toIso(ts: string): string {
  return typeof ts === 'string' ? ts.replace(' ', 'T') : ts;
}
