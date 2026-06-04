import { Injectable, inject, signal } from '@angular/core';
import type { DashboardWidget } from '@core';
import { RealtimeService } from '../../core/services/realtime.service';
import type { TelemetryPoint } from '../../core/models/runtime';

/**
 * TelemetryStore — historical numeric series for the line widgets, fetched from
 * the `/telemetry` history endpoint (the server picks the storage tier from the
 * requested span). Kept separate from the live DashboardStore: charts read
 * history here, live tiles + badges read the shadow there.
 *
 * Runtime state group — never imports the editor services.
 */
@Injectable()
export class TelemetryStore {
  private realtime = inject(RealtimeService);
  private series = signal<Map<string, TelemetryPoint[]>>(new Map());

  /** The loaded series for a widget (empty until `load` resolves). */
  seriesFor(widget: DashboardWidget): TelemetryPoint[] {
    return this.series().get(widget.id) ?? [];
  }

  /** Load the last `hours` of history for a line widget. */
  async load(siteId: string, widget: DashboardWidget, hours = 6): Promise<void> {
    if (!widget.sensor) return;
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);
    const hist = await this.realtime.history(siteId, widget.controller, widget.sensor, from, to);
    this.series.update((m) => new Map(m).set(widget.id, hist.samples));
  }
}
