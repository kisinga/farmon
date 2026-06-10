import { Injectable, inject, signal } from '@angular/core';
import type { DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { TelemetryPoint } from '../../core/models/runtime';

/** Selectable chart spans, in hours. Capped at 30d — the aggregate-tier
 *  retention ceiling, so a longer span would just return empty. */
export const SPAN_PRESETS = [
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 24 * 7, label: '7d' },
  { hours: 24 * 30, label: '30d' },
] as const;

/** Default span — matches the prior hardcoded behavior. */
export const DEFAULT_SPAN_HOURS = 6;

/** localStorage key for a widget's remembered span. */
const spanKey = (widgetId: string) => `mf:span:${widgetId}`;

/**
 * TelemetryStore — historical numeric series for the line/flow widgets, fetched
 * from the `/telemetry` history endpoint (the server picks the storage tier from
 * the requested span). Kept separate from the live DashboardStore: charts read
 * history here, live tiles + badges read the shadow there.
 *
 * Each widget carries its own span (persisted in localStorage), so operators can
 * range each chart independently. Flow widgets also load their companion
 * cumulative-total series so the card can show usage over the picked window.
 *
 * Runtime state group — never imports the editor services.
 */
@Injectable()
export class TelemetryStore {
  private realtime = inject(RealtimeService);
  private series = signal<Map<string, TelemetryPoint[]>>(new Map());
  private totals = signal<Map<string, TelemetryPoint[]>>(new Map());
  private spans = signal<Map<string, number>>(new Map());
  /** Per-widget request counter: a load applies its result only if it is still
   *  the latest in flight, so rapid span switches can't land a slow stale
   *  response on top of a newer one. */
  private reqSeq = new Map<string, number>();

  /** The loaded rate series for a widget (empty until `load` resolves). */
  seriesFor(widget: DashboardWidget): TelemetryPoint[] {
    return this.series().get(widget.id) ?? [];
  }

  /** The loaded cumulative-total series for a flow widget (empty otherwise). */
  totalSeriesFor(widget: DashboardWidget): TelemetryPoint[] {
    return this.totals().get(widget.id) ?? [];
  }

  /** The widget's current span in hours — its remembered value or the default. */
  spanFor(widget: DashboardWidget): number {
    const m = this.spans().get(widget.id);
    if (m !== undefined) return m;
    const stored = Number(localStorage.getItem(spanKey(widget.id)));
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_SPAN_HOURS;
  }

  /** Change a widget's span: persist it, then reload its series. */
  async setSpan(siteId: string, widget: DashboardWidget, hours: number): Promise<void> {
    this.spans.update((m) => new Map(m).set(widget.id, hours));
    localStorage.setItem(spanKey(widget.id), String(hours));
    await this.load(siteId, widget, hours);
  }

  /** Load history for a widget at the given span (defaults to its remembered
   *  span). Flow widgets additionally load their cumulative-total series (fetched
   *  in parallel). A response is dropped if a newer load for the same widget has
   *  since started (see `reqSeq`). */
  async load(siteId: string, widget: DashboardWidget, hours = this.spanFor(widget)): Promise<void> {
    if (!widget.sensor) return;
    const token = (this.reqSeq.get(widget.id) ?? 0) + 1;
    this.reqSeq.set(widget.id, token);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);

    const wantsTotal = widget.kind === 'flow' && !!widget.totalSensor;
    const [hist, tot] = await Promise.all([
      this.realtime.history(siteId, widget.controller, widget.sensor, from, to),
      wantsTotal
        ? this.realtime.history(siteId, widget.controller, widget.totalSensor!, from, to)
        : Promise.resolve(null),
    ]);
    if (this.reqSeq.get(widget.id) !== token) return; // superseded by a newer load

    this.series.update((m) => new Map(m).set(widget.id, hist.samples));
    if (tot) this.totals.update((m) => new Map(m).set(widget.id, tot.samples));
  }
}
