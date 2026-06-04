import { Injectable, inject } from '@angular/core';
import type { RecordModel, UnsubscribeFunc } from 'pocketbase';
import { BackendService } from './backend.service';
import type { ShadowRow, TelemetryHistory, StateEventRow } from '../models/runtime';

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
    });
    return res.items.map(toEvent);
  }

  /** Live shadow updates for a site. Returns an unsubscribe function. */
  subscribeShadow(siteId: string, cb: (row: ShadowRow) => void): Promise<UnsubscribeFunc> {
    return this.pb.collection('entity_state').subscribe(
      '*',
      (e) => cb(toShadow(e.record)),
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
    );
  }

  /** Live transition inserts for a site. Returns an unsubscribe function. */
  subscribeEvents(siteId: string, cb: (row: StateEventRow) => void): Promise<UnsubscribeFunc> {
    return this.pb.collection('state_events').subscribe(
      '*',
      (e) => {
        if (e.action === 'create') cb(toEvent(e.record));
      },
      { filter: this.pb.filter('site = {:s}', { s: siteId }) },
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
