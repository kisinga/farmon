import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import type { DashboardSpec, DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { ShadowRow, StateEventRow } from '../../core/models/runtime';

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
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private unsubs: UnsubscribeFunc[] = [];

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
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
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

  ngOnDestroy(): void {
    for (const u of this.unsubs) void u();
    this.unsubs = [];
  }
}
