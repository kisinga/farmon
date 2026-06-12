import { Injectable, inject, signal } from '@angular/core';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { BackendService } from './backend.service';
import type { ShadowRow, TelemetryHistory, StateEventRow, ControllerRow } from '../models/runtime';

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

  /** Current shadow (last-known value per channel) for a site. */
  latest(siteId: string): Promise<ShadowRow[]> {
    return this.pb.send<ShadowRow[]>(
      `/api/farmon/latest?site=${encodeURIComponent(siteId)}`,
      { method: 'GET' },
    );
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
    return res.items.map(toEvent);
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

  /** Live shadow updates for a site. Returns an unsubscribe function. */
  subscribeShadow(siteId: string, cb: (row: ShadowRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('entity_state').subscribe(
      '*',
      (e) => cb(toShadow(e.record)),
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
    return res.items.map(toEvent);
  }

  /** Live transition inserts across all visible sites. */
  subscribeAllEvents(cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('state_events').subscribe('*', (e) => {
      if (e.action === 'create') cb(toEvent(e.record));
    });
  }

  /** Current tank-level shadows across all visible sites. Server-filtered to
   *  `*_level` channels so the alerts store never pulls the full shadow. */
  async levelShadows(): Promise<ShadowRow[]> {
    const items = await this.pb.collection('entity_state').getFullList({
      filter: this.pb.filter('sensor ~ {:s}', { s: '_level' }),
      requestKey: 'shadow:levels',
    });
    return items.map(toShadow);
  }

  /** Live tank-level shadow updates across all visible sites. */
  subscribeLevelShadows(cb: (row: ShadowRow) => void): Promise<UnsubscribeFunc> {
    this.wireConnection();
    return this.pb.collection('entity_state').subscribe(
      '*',
      (e) => cb(toShadow(e.record)),
      { filter: this.pb.filter('sensor ~ {:s}', { s: '_level' }) },
    );
  }
}

function toShadow(r: RecordModel): ShadowRow {
  return {
    controller: r['controller'],
    sensor: r['sensor'],
    reported: r['reported'],
    reported_text: r['reported_text'],
    desired: r['desired'],
    ts: r['ts'],
  };
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
  return {
    controller: r['controller'],
    route: r['route'],
    from: r['from_state'],
    to: r['to_state'],
    reason: r['reason'],
    command_id: r['command_id'],
    ts: r['ts'],
  };
}
