import { Injectable, OnDestroy, effect, inject, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { SYSTEM_STATE_TOKENS, routeStateSensor, type DashboardSpec, type DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { ShadowRow, StateEventRow, ControllerRow } from '../../core/models/runtime';
import { resolveOfflineMs } from '../../core/models/alerts';

/**
 * DashboardStore — the customer dashboard's "current state": the chart spec, the
 * live shadow (last-known value per channel), and the recent transition log.
 * It seeds from the shadow + recent events, then subscribes for live updates.
 * Provided per dashboard page so it tears its subscriptions down on leave.
 *
 * Runtime state group — never imports the editor services.
 */
@Injectable()
export class DashboardStore implements OnDestroy {
  private realtime = inject(RealtimeService);

  /** Live SSE stream state, surfaced for the global reconnect banner. */
  readonly connection = this.realtime.connection;

  readonly spec = signal<DashboardSpec>({ widgets: [], controllers: [] });
  /** Keyed by `${controller}/${sensor}` (== a widget's id). */
  readonly shadow = signal<Map<string, ShadowRow>>(new Map());
  readonly events = signal<StateEventRow[]>([]);
  /** Presence rows keyed by controller id (== device_id). */
  readonly controllers = signal<Map<string, ControllerRow>>(new Map());
  /** Ticks every 15s so the freshness check (and "last seen Xm") re-evaluates. */
  readonly now = signal(Date.now());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Presence freshness window (ms) = the site's `offline_timeout_s`, the SAME
   *  threshold the alert bell + email sweep use, so the dashboard never disagrees
   *  with them. Resolved from the site record in init(); the default until then. */
  private offlineMs = resolveOfflineMs(null);

  private unsubs: UnsubscribeFunc[] = [];
  private clock = 0;
  private siteId = '';

  constructor() {
    // The SDK auto-reconnects after a dropped stream; when it does, re-pull the
    // shadow/events/controllers so the gap that opened while offline is filled.
    // Skip the first connect — init()'s own fetch already covered it.
    let prev = this.realtime.connection();
    effect(() => {
      const c = this.realtime.connection();
      if (c === 'connected' && prev === 'disconnected' && this.siteId) {
        void this.resync(this.siteId).catch(() => {});
      }
      prev = c;
    });
  }

  /** Pull the current shadow, recent transitions, and presence for a site. Runs
   *  on init and again on every realtime reconnect to close the offline gap. */
  private async resync(siteId: string): Promise<void> {
    const rows = await this.realtime.latest(siteId);
    const map = new Map<string, ShadowRow>();
    for (const r of rows) map.set(`${r.controller}/${r.sensor}`, r);
    this.shadow.set(map);

    this.events.set(await this.realtime.recentEvents(siteId, 100));

    const ctrls = await this.realtime.controllers(siteId);
    this.controllers.set(new Map(ctrls.map((c) => [c.device_id, c])));
  }

  async init(siteId: string, spec: DashboardSpec): Promise<void> {
    this.siteId = siteId;
    this.spec.set(spec);
    this.loading.set(true);
    this.error.set(null);
    try {
      // Best-effort: a failed threshold read just keeps the default window.
      try {
        this.offlineMs = resolveOfflineMs(await this.realtime.siteOfflineSeconds(siteId));
      } catch { /* keep default */ }

      await this.resync(siteId);

      this.unsubs.push(
        await this.realtime.subscribeShadow(siteId, (row) => {
          this.shadow.update((m) => new Map(m).set(`${row.controller}/${row.sensor}`, row));
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeEvents(siteId, (row) => {
          this.events.update((list) => [row, ...list].slice(0, 200));
        }),
      );
      this.unsubs.push(
        await this.realtime.subscribeControllers(siteId, (row) => {
          this.controllers.update((m) => new Map(m).set(row.device_id, row));
        }),
      );

      this.clock = window.setInterval(() => this.now.set(Date.now()), 15_000);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Live presence for a controller: server `online` AND a fresh `last_seen`,
   *  plus the parsed last-seen timestamp (0 when unknown) for the UI. The `online`
   *  flag (reliable now the broker flips it on disconnect) gives a fast offline on a
   *  real drop; the freshness window catches a connected-but-silent device and uses
   *  the same `offline_timeout_s` the alerts do, so the views never disagree. */
  presence(controller: string): { online: boolean; lastSeen: number } {
    const r = this.controllers().get(controller);
    if (!r) return { online: false, lastSeen: 0 };
    const seen = Date.parse(r.last_seen);
    const fresh = Number.isFinite(seen) && this.now() - seen < this.offlineMs;
    return { online: !!r.online && fresh, lastSeen: Number.isFinite(seen) ? seen : 0 };
  }

  /** The shadow row a widget reads (its id is `${controller}/${sensor}`). */
  rowFor(widget: DashboardWidget): ShadowRow | undefined {
    return widget.sensor ? this.shadow().get(widget.id) : undefined;
  }

  /** A shadow row by explicit controller + sensor (e.g. a flow widget's total). */
  row(controller: string, sensor?: string): ShadowRow | undefined {
    return sensor ? this.shadow().get(`${controller}/${sensor}`) : undefined;
  }

  /** Transitions for one controller, newest first (the timeline widget). */
  eventsFor(controller: string): StateEventRow[] {
    return this.events().filter((e) => e.controller === controller);
  }

  /** A route's current state. The `token` comes from the self-healing telemetry
   *  shadow (`route_<id>_state`, re-asserted every interval) so a dropped one-shot
   *  transition event can never strand the card; the `reason`/`ts` ride the newest
   *  matching transition event (best-effort fault/stop detail). `events()` is
   *  newest-first; OUTCOME-only tokens (QUEUED/REFUSED/…) are skipped so a refusal
   *  never masquerades as a state. Undefined ⇒ neither source has anything yet. */
  routeState(controller: string, routeId: number): { token: string; reason: string; ts: string } | undefined {
    const token = this.shadow().get(`${controller}/${routeStateSensor(routeId)}`)?.reported_text ?? '';
    for (const e of this.events()) {
      if (e.controller !== controller || e.route !== routeId) continue;
      if (!SYSTEM_STATE_TOKENS.some((t) => t === e.to)) continue;
      return { token: token || e.to, reason: e.reason, ts: e.ts };
    }
    return token ? { token, reason: '', ts: '' } : undefined;
  }

  ngOnDestroy(): void {
    for (const u of this.unsubs) void u();
    this.unsubs = [];
    if (this.clock) { clearInterval(this.clock); this.clock = 0; }
  }
}
