import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { switchMap, map, scan, startWith } from 'rxjs/operators';
import { ApiService } from './api.service';
import { TelemetrySubscriptionService } from './telemetry-subscription.service';
import { getFieldValue } from './telemetry-stream.types';

/** Single series for chart components (matches ChartContainerComponent input). */
export interface ChartSeriesInput {
  name: string;
  data: Array<{ ts: string; value: number }>;
}

/**
 * Composes one-off history fetch with realtime telemetry stream to produce
 * a live-updating history series for charts. Reusable for any component that
 * needs "initial range + append new points".
 */
@Injectable({ providedIn: 'root' })
export class TelemetryHistoryService {
  private readonly api = inject(ApiService);
  private readonly telemetrySubscription = inject(TelemetrySubscriptionService);

  /**
   * Emits initial history for the range [from, to], then appends new telemetry
   * points as they arrive. Points outside the range are dropped.
   */
  getHistorySeriesLive(
    eui: string,
    field: string,
    from: string,
    to: string,
    limit = 500
  ): Observable<ChartSeriesInput[]> {
    if (!eui || !field) {
      return of([{ name: field, data: [] }]);
    }
    const fromMs = from ? new Date(from).getTime() : 0;
    const toMs = to ? new Date(to).getTime() : Infinity;

    return this.api
      .getHistory(eui, field, from || undefined, to || undefined, limit)
      .pipe(
        switchMap((history) => {
          const initial: ChartSeriesInput = {
            name: field,
            data: history?.data ?? [],
          };
          return this.telemetrySubscription.stream(eui).pipe(
            map((payload) => ({
              ts: payload.ts,
              value: getFieldValue(payload, field),
            })),
            scan<{ ts: string; value: number }, ChartSeriesInput>(
              (series, point) => {
                const t = new Date(point.ts).getTime();
                if (t < fromMs || t > toMs) return series;
                const newData = [...series.data, point].sort(
                  (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
                );
                return { ...series, data: newData };
              },
              initial
            ),
            startWith(initial)
          );
        }),
        map((s) => [s])
      );
  }
}
