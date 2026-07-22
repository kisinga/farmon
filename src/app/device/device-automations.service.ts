import { Injectable, inject } from '@angular/core';
import type { UnsubscribeFunc } from 'pocketbase';
import {
  parseTopology, listAutomatableRoutes, topologyToManifestForController, routeSetVersion,
  serializeAutomationSet, decodeAutomationSet,
  type AutomatableRoute, type NewAutomationRow, type WireAutomation,
} from '@core';
import { BackendService } from '../core/services/backend.service';
import { DeviceBackendService } from './device-backend.service';
import { AutomationsService, type AutomationRecord } from '../pages/automations/automations.service';

/** Mint a PocketBase-style row id (15 chars) — the wire echoes it back as the
 *  automation's identity, so device-created rows need one in the same shape.
 *  `crypto.getRandomValues` works in the device's insecure http context. */
function mintRowId(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(15));
  return [...b].map((x) => abc[x % 36]).join('');
}

/** Automation names don't fit the wire record (20 fixed bytes), so they live in
 *  this localStorage map, id → name. The device serves exactly one site, so one
 *  flat map is enough. */
const NAMES_KEY = 'mf:automations:names';

function readNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as Record<string, string>; }
  catch { return {}; }
}

/** The on-device automation id → name map — also read by DeviceRealtimeService to
 *  label automation actors in the Activity feed. */
export { readNames };

function writeName(id: string, name: string): void {
  try {
    const m = readNames();
    if (name) m[id] = name; else delete m[id];
    localStorage.setItem(NAMES_KEY, JSON.stringify(m));
  } catch { /* private mode / SSR — names are cosmetic, the row still saves */ }
}

/** The route-table context every read/write resolves against: the device's baked
 *  topology gives the automatable routes (route_index ↔ route_key) and the
 *  route_set_version the firmware baked into its apply gate — the same topology
 *  the codegen injected as /topology.json, so the version matches by construction. */
interface AutomationContext {
  routes: AutomatableRoute[];
  controllerId: string;
  version: number;
}

/**
 * DeviceAutomationsService — the device-mode stand-in for AutomationsService,
 * backed by the controller's own `/local/automations` endpoint instead of the
 * `automations` PocketBase collection. A read is GET blob → decodeAutomationSet →
 * rows (route_index resolved to route_key/controller against the baked topology);
 * a write is read → apply the mutation → encode → POST (the device persists the
 * whole set atomically and refuses a stale route_set_version with a 400, which
 * DeviceBackendService words readably).
 *
 * `subscribe` is a no-op: the manager re-lists after every save, and the device
 * has no per-row realtime feed to ride.
 */
@Injectable()
export class DeviceAutomationsService extends AutomationsService {
  private deviceBackend = inject(BackendService) as DeviceBackendService;
  private ctx: AutomationContext | null = null;

  private async context(): Promise<AutomationContext> {
    if (!this.ctx) {
      const { topology } = await this.deviceBackend.siteLoad('local');
      const topo = parseTopology(topology);
      // One controller per device image — deviceControllerId() makes the same call.
      const controllerId = topo.controllers[0]?.id ?? 'controller';
      this.ctx = {
        routes: listAutomatableRoutes(topo),
        controllerId,
        version: routeSetVersion(topologyToManifestForController(topo, controllerId)),
      };
    }
    return this.ctx;
  }

  override async list(siteId: string): Promise<AutomationRecord[]> {
    const [ctx, blob] = await Promise.all([this.context(), this.deviceBackend.fetchAutomations()]);
    const decoded = decodeAutomationSet(blob);
    const names = readNames();
    return decoded.rows.map((r) => {
      const route = ctx.routes.find((x) => x.routeIndex === r.route_index);
      return {
        ...r,
        site: siteId,
        controller: route?.controllerId ?? ctx.controllerId,
        // An unresolvable route_index keeps route_key '' — the manager flags the
        // row "Route removed" and pauses it, same as a cloud row whose route went.
        route_key: route?.routeKey ?? '',
        name: names[r.id] ?? '',
        route_set_version: decoded.route_set_version,
      };
    });
  }

  override async create(row: NewAutomationRow): Promise<AutomationRecord> {
    const record: AutomationRecord = { ...row, id: mintRowId() };
    writeName(record.id, row.name);
    await this.push([...(await this.list(row.site)), record]);
    return record;
  }

  override async update(id: string, patch: Partial<NewAutomationRow>): Promise<AutomationRecord> {
    const rows = await this.list('local');
    const existing = rows.find((r) => r.id === id);
    if (!existing) throw new Error('Automation not found on the device.');
    const updated: AutomationRecord = { ...existing, ...patch, id };
    if (patch.name !== undefined) writeName(id, patch.name);
    await this.push(rows.map((r) => (r.id === id ? updated : r)));
    return updated;
  }

  override async remove(id: string): Promise<void> {
    const rows = await this.list('local');
    writeName(id, '');
    await this.push(rows.filter((r) => r.id !== id));
  }

  /** Encode the whole set and POST it — the device's apply is all-or-nothing,
   *  gated on the baked route_set_version. */
  private async push(rows: AutomationRecord[]): Promise<void> {
    const ctx = await this.context();
    const wires: WireAutomation[] = rows.map((r) => ({
      id: r.id,
      enabled: r.enabled,
      trigger_type: r.trigger_type === 'level' ? 1 : 0,
      days_mask: r.days_mask,
      level_threshold_pct: r.level_threshold_pct,
      route_index: r.route_index,
      time_min: r.time_min,
      override_mask: r.override_mask,
      ov_source_min_pct: r.ov_source_min_pct,
      ov_dest_max_pct: r.ov_dest_max_pct,
      ov_max_runtime_min: r.ov_max_runtime_min,
      ov_target_duration_s: r.ov_target_duration_s,
      ov_target_volume_l: r.ov_target_volume_l,
    }));
    await this.deviceBackend.sendAutomations(serializeAutomationSet(ctx.version, wires));
  }

  /** No per-row realtime on the device — the manager re-lists after each save. */
  override subscribe(_siteId: string, _cb: () => void): Promise<UnsubscribeFunc> {
    return Promise.resolve(async () => {});
  }
}
