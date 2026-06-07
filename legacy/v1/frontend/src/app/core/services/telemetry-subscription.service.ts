import { Injectable, inject } from '@angular/core';
import { Observable, Subject, shareReplay, catchError, of } from 'rxjs';
import { PocketBaseService } from './pocketbase.service';
import type { TelemetryPayload } from './telemetry-stream.types';

/** Raw telemetry record from PocketBase (realtime event record shape). */
interface TelemetryRecordRaw {
  id?: string;
  device_eui?: string;
  ts?: string;
  created?: string;
  data?: string | Record<string, unknown>;
  rssi?: number;
  snr?: number;
}

function parsePayload(rec: TelemetryRecordRaw): TelemetryPayload {
  const ts = rec.ts ?? rec.created ?? '';
  let data: Record<string, unknown> = {};
  try {
    if (rec.data) {
      data = typeof rec.data === 'string' ? JSON.parse(rec.data) : (rec.data as Record<string, unknown>);
    }
  } catch {
    // ignore
  }
  return {
    ts,
    data,
    rssi: rec.rssi,
    snr: rec.snr,
  };
}

/** Per-device subscription state: subject and ref count. */
interface DeviceStreamState {
  subject: Subject<TelemetryPayload>;
  unsubPb: (() => Promise<void>) | null;
  refCount: number;
}

/**
 * Provides realtime telemetry streams per device via PocketBase realtime subscriptions.
 * One subscription per device EUI (ref-counted); multiple consumers share the same stream.
 */
@Injectable({ providedIn: 'root' })
export class TelemetrySubscriptionService {
  private readonly pb = inject(PocketBaseService).pb;
  private readonly streams = new Map<string, DeviceStreamState>();

  /**
   * Returns an observable that emits the latest telemetry for the given device.
   * New subscribers receive the latest value (if any) and then all subsequent updates.
   * Subscription is ref-counted: the PocketBase subscription is created on first subscriber
   * and removed when the last subscriber unsubscribes.
   */
  stream(eui: string): Observable<TelemetryPayload> {
    if (!eui) {
      return of({ ts: '', data: {} });
    }
    let state = this.streams.get(eui);
    if (!state) {
      state = {
        subject: new Subject<TelemetryPayload>(),
        unsubPb: null,
        refCount: 0,
      };
      this.streams.set(eui, state);
    }

    return new Observable<TelemetryPayload>((subscriber) => {
      state!.refCount++;
      const sub = state!.subject.subscribe(subscriber);

      if (state!.refCount === 1) {
        const filter = this.pb.filter('device_eui = {:eui}', { eui });
        this.pb
          .collection<TelemetryRecordRaw>('telemetry')
          .subscribe(
            '*',
            (event: { action: string; record: TelemetryRecordRaw }) => {
              if (event.action === 'create' || event.action === 'update') {
                state!.subject.next(parsePayload(event.record));
              }
            },
            { filter }
          )
          .then((unsub) => {
            state!.unsubPb = unsub;
          })
          .catch((err) => {
            state!.subject.error(err);
          });
      }

      return () => {
        sub.unsubscribe();
        state!.refCount--;
        if (state!.refCount <= 0 && state!.unsubPb) {
          state!.unsubPb();
          this.streams.delete(eui);
        }
      };
    }).pipe(
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError(() => of({ ts: '', data: {} }))
    );
  }
}
