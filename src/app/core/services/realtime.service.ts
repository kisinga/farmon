import { Injectable, inject, signal } from '@angular/core';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import type { ControllerSnapshot } from '@core';
import { BackendService } from './backend.service';
import type { ShadowRow, TelemetryHistory, StateEventRow, ControllerRow, CommandOutcomeRow, CommandLogRow } from '../models/runtime';

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
    return res.items.map((r) => toEvent(r, this.meId()));
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
        if (e.action === 'create') cb(toEvent(e.record, this.meId()));
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
    return res.items.map((r) => toCommandLog(r, this.meId()));
  }

  /** Live command inserts/updates for a site (a command lands as `sent`, then the
   *  device outcome reconciles it to done/failed). Returns an unsubscribe function. */
  subscribeCommands(siteId: string, cb: (row: CommandLogRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('commands').subscribe(
      '*',
      (e) => cb(toCommandLog(e.record, this.meId())),
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** The signed-in user's id, for the "you" attribution in the command feed. */
  private meId(): string {
    return this.pb.authStore.record?.id ?? '';
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
    return res.items.map((r) => toEvent(r, this.meId()));
  }

  /** Live transition inserts across all visible sites. */
  subscribeAllEvents(cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('state_events').subscribe('*', (e) => {
      if (e.action === 'create') cb(toEvent(e.record, this.meId()));
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
    rows.push({ controller, sensor: `route_${r.id}_state`, reported: 0, reported_text: r.state, ts, origin: r.origin, actorLabel: r.actorLabel });
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

function toEvent(r: RecordModel, meId: string): StateEventRow {
  // Resolve the initiator's NAME once (or "you" for the viewer's own manual
  // action), mirroring toCommandLog. Just the bare name — the shared formatInitiator
  // adds the "by …" / "Automation: …" prefix and the no-name fallbacks, so a route
  // transition reads the same as a node command and can't drift from the route card.
  const origin: string | undefined = r['origin'] || undefined;
  const actorId = r['actor'];
  const label = r['actor_label'];
  let display: string | undefined;
  if (actorId) {
    if (origin === 'MANUAL' && actorId === meId) display = 'you';
    else display = label || undefined;
  }
  return {
    controller: r['controller'],
    route: r['route'],
    from: r['from_state'],
    to: r['to_state'],
    reason: r['reason'],
    command_id: r['command_id'],
    ts: r['ts'],
    origin,
    actorLabel: display,
  };
}

/** Map a `commands` record to a display row, resolving the initiator. An admin
 *  action on a customer's site (issued_role 'admin', the Take-control flow) is
 *  labelled support so it's unmistakable; otherwise the viewer's own action reads
 *  "you", a co-owner's the expanded name (history fetch), unresolved "operator". */
function toCommandLog(r: RecordModel, meId: string): CommandLogRow {
  const bySupport = r['issued_role'] === 'admin';
  const issuedBy = r['issued_by'];
  const expanded = (r['expand'] as Record<string, RecordModel> | undefined)?.['issued_by'];
  const name = expanded?.['name'] || expanded?.['email'];
  let actor: string;
  if (bySupport) actor = 'Support';
  else if (issuedBy && issuedBy === meId) actor = 'you';
  else actor = name || 'operator';
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
    actor,
    bySupport,
    // Normalise PocketBase's space-separated autodate ("2026-…14 20:47:01.123Z")
    // to ISO 8601 so it parses + sorts identically to the RFC3339 transition
    // timestamps it's merged with in the activity feed (see DashboardStore.activityFor).
    ts: toIso(r['created']),
  };
}

/** PocketBase autodate ("YYYY-MM-DD HH:MM:SS.sssZ") → ISO 8601 (T-separated). The
 *  activity feed merges these with RFC3339 transition timestamps; a space-separated
 *  string is not valid ISO and parses inconsistently across engines, so normalise. */
function toIso(ts: string): string {
  return typeof ts === 'string' ? ts.replace(' ', 'T') : ts;
}
