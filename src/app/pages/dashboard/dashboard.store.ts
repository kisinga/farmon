import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import { SYSTEM_STATE_TOKENS, routeStateSensor, type DashboardSpec, type DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { ShadowRow, StateEventRow, ControllerRow } from '../../core/models/runtime';

/** A controller counts as online only if the server flag is set AND its last
 *  sample is fresh — covers an abrupt power loss the will message can't. */
const PRESENCE_FRESH_MS = 60_000;

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

  private unsubs: UnsubscribeFunc[] = [];
  private clock = 0;

  async init(siteId: string, spec: DashboardSpec): Promise<void> {
    this.spec.set(spec);
    this.loading.set(true);
    this.error.set(null);
    try {
      const rows = await this.realtime.latest(siteId);
      const map = new Map<string, ShadowRow>();
      for (const r of rows) map.set(`${r.controller}/${r.sensor}`, r);
      this.shadow.set(map);

      this.events.set(await this.realtime.recentEvents(siteId, 100));

      const ctrls = await this.realtime.controllers(siteId);
      this.controllers.set(new Map(ctrls.map((c) => [c.device_id, c])));

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
   *  plus the parsed last-seen timestamp (0 when unknown) for the UI. */
  presence(controller: string): { online: boolean; lastSeen: number } {
    const r = this.controllers().get(controller);
    if (!r) return { online: false, lastSeen: 0 };
    const seen = Date.parse(r.last_seen);
    const fresh = Number.isFinite(seen) && this.now() - seen < PRESENCE_FRESH_MS;
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
