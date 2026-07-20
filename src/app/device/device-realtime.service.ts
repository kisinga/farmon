import { Injectable, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import type { ControllerSnapshot } from '@core';
import { RealtimeService, explodeSnapshot, snapOutcomes, type RealtimeConnection } from '../core/services/realtime.service';
import type { ShadowRow, CommandOutcomeRow, ControllerRow, StateEventRow, CommandLogRow, ConfigEventRow, UsageRun } from '../core/models/runtime';
import { deviceControllerId, deviceSnapshotIntervalMs } from './device-topology';

/** How long `latest()` waits for the first SSE snapshot before resolving empty.
 *  Derived from the baked snapshot cadence (update_interval runs up to 60s — a
 *  fixed 8s would paint an all-zero shadow for up to a minute): two intervals
 *  (one just-missed + one full wait), floored at 8s, capped at 130s. This only
 *  bounds a dead link; a live stream resolves on its first event. */
const FIRST_SNAPSHOT_TIMEOUT_MS = Math.min(Math.max(deviceSnapshotIntervalMs() * 2, 8_000), 130_000);
/** Reconnect backoff: starts at 1s, doubles to this ceiling. */
const RECONNECT_MAX_MS = 30_000;

/**
 * DeviceRealtimeService — the device-mode stand-in for RealtimeService, backed by
 * the controller's own `/local/state` SSE stream instead of PocketBase. Each event
 * is a full ControllerSnapshot (the exact shape the cloud feed carries), exploded
 * through the SAME projection (explodeSnapshot / snapOutcomes) so the dashboard
 * store and every widget downstream read device data identically.
 *
 * The stream reconnects with exponential backoff; the `connection` signal mirrors
 * its state, so DashboardStore's reconnect-resync effect refills the shadow on a
 * drop exactly as it does for the cloud feed. Reads that have no device endpoint
 * (history, usage, events, command audit) resolve empty — the dashboard hides
 * those surfaces in device mode (see DEVICE_MODE).
 */
@Injectable()
export class DeviceRealtimeService extends RealtimeService {
  private readonly _conn = signal<RealtimeConnection>('connecting');
  override readonly connection = this._conn.asReadonly();

  private es: EventSource | null = null;
  private backoffMs = 1_000;

  private lastRows: ShadowRow[] = [];
  private lastOutcomes: CommandOutcomeRow[] = [];
  private lastMsgAt = 0;
  private firmwareVersion = '';
  private gotSnapshot: () => void = () => {};
  private readonly firstSnapshot: Promise<void>;

  private shadowCbs = new Set<(rows: ShadowRow[], outcomes: CommandOutcomeRow[]) => void>();
  private presenceCbs = new Set<(row: ControllerRow) => void>();

  constructor() {
    super();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    this.firstSnapshot = new Promise((resolve) => {
      this.gotSnapshot = () => {
        clearTimeout(timeout);
        resolve();
      };
      timeout = setTimeout(resolve, FIRST_SNAPSHOT_TIMEOUT_MS);
    });
    // SSR safety: there is no EventSource off-browser; stay 'connecting' there.
    if (typeof EventSource !== 'undefined') this.connect();
  }

  // --- The live stream --------------------------------------------------------

  private connect(): void {
    this.es = new EventSource('/local/state');
    this.es.onopen = () => {
      this.backoffMs = 1_000;
      this._conn.set('connected');
      this.pushPresence();
    };
    this.es.onmessage = (e) => this.ingest(e.data as string);
    this.es.onerror = () => {
      // Own the reconnect (the native retry gives no backoff control): close,
      // surface the drop, retry with exponential backoff.
      this.es?.close();
      this.es = null;
      if (this._conn() !== 'disconnected') {
        this._conn.set('disconnected');
        this.pushPresence();
      }
      window.setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_MS);
    };
  }

  /** One SSE event → the cached shadow + a fan-out to shadow subscribers. The
   *  snapshot carries no controller identity (the device serves only itself), so
   *  rows are attributed to the baked topology's controller. */
  private ingest(data: string): void {
    let snap: ControllerSnapshot;
    try {
      snap = JSON.parse(data) as ControllerSnapshot;
    } catch {
      return; // a malformed event is dropped; the next interval re-asserts everything
    }
    const controller = deviceControllerId();
    const ts = new Date(snap.ts > 0 ? snap.ts * 1000 : Date.now()).toISOString();
    this.lastRows = explodeSnapshot(controller, snap, ts);
    this.lastOutcomes = snapOutcomes(controller, snap);
    this.firmwareVersion = snap.text?.['fw_version'] ?? '';
    this.lastMsgAt = Date.now();
    this.gotSnapshot();
    for (const cb of this.shadowCbs) cb(this.lastRows, this.lastOutcomes);
  }

  private presenceRow(): ControllerRow {
    return {
      device_id: deviceControllerId(),
      site: 'local',
      active: true,
      online: this._conn() === 'connected',
      last_seen: new Date(this.lastMsgAt || Date.now()).toISOString(),
      firmware_version: this.firmwareVersion,
    };
  }

  private pushPresence(): void {
    const row = this.presenceRow();
    for (const cb of this.presenceCbs) cb(row);
  }

  // --- RealtimeService surface (device-backed) --------------------------------

  /** The latest snapshot's rows. Waits for the first event so the dashboard's
   *  initial resync seeds a full shadow instead of an empty one. */
  override async latest(_siteId: string): Promise<{ rows: ShadowRow[]; outcomes: CommandOutcomeRow[] }> {
    await this.firstSnapshot;
    return { rows: this.lastRows, outcomes: this.lastOutcomes };
  }

  override subscribeShadow(
    _siteId: string,
    cb: (rows: ShadowRow[], outcomes: CommandOutcomeRow[]) => void,
  ): Promise<UnsubscribeFunc> {
    this.shadowCbs.add(cb);
    return Promise.resolve(async () => { this.shadowCbs.delete(cb); });
  }

  override async controllers(_siteId: string): Promise<ControllerRow[]> {
    return [this.presenceRow()];
  }

  override subscribeControllers(_siteId: string, cb: (row: ControllerRow) => void): Promise<UnsubscribeFunc> {
    this.presenceCbs.add(cb);
    return Promise.resolve(async () => { this.presenceCbs.delete(cb); });
  }

  /** No `sites` record on the device — 0 lets the caller fall back to its
   *  default presence window. */
  override async siteOfflineSeconds(_siteId: string): Promise<number> {
    return 0;
  }

  // --- Cloud-only reads: no device endpoint, resolve empty ---------------------

  /** The device keeps no transition log; route state reads from the self-healing
   *  shadow rows (route_<id>_state), which the snapshot re-asserts every interval. */
  override async recentEvents(_siteId: string, _limit = 100): Promise<StateEventRow[]> {
    return [];
  }

  override subscribeEvents(_siteId: string, _cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    return Promise.resolve(async () => {});
  }

  override async recentCommands(_siteId: string, _limit = 100): Promise<CommandLogRow[]> {
    return [];
  }

  override subscribeCommands(_siteId: string, _cb: (row: CommandLogRow) => void): Promise<UnsubscribeFunc> {
    return Promise.resolve(async () => {});
  }

  override async recentConfigEvents(_siteId: string, _limit = 100): Promise<ConfigEventRow[]> {
    return [];
  }

  override subscribeConfigEvents(_siteId: string, _cb: (row: ConfigEventRow) => void): Promise<UnsubscribeFunc> {
    return Promise.resolve(async () => {});
  }

  override async recentRuns(_siteId: string, _limit = 100): Promise<UsageRun[]> {
    return [];
  }

  override subscribeRuns(_siteId: string, _cb: (row: UsageRun) => void): Promise<UnsubscribeFunc> {
    return Promise.resolve(async () => {});
  }
}
