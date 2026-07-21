import type { SiteFullPayload } from '../core/models/backend-api';

/**
 * Runtime site topology for the device-mode build. On the device there is no
 * `sites` collection to load from — the firmware serves `/topology.json` (the
 * codegen injects it into the local-ui asset table at bundle-generation time)
 * and the app fetches it here. Nothing is baked into the bundle, so one device
 * build serves every site.
 *
 * The served JSON is the RAW stored topology (the same shape the `sites`
 * record's `draft_topology` carries: `{schema, controllers, nodes, ...}`); the
 * dashboard runs it through parseTopology exactly as it does the PocketBase
 * payload. An `{site, topology}` envelope is also accepted for backwards
 * compatibility with early bundles. The result is normalized to the envelope
 * and cached on first load — the identity helpers below read the cache.
 */
interface DeviceTopologyEnvelope {
  site: { id: string; name: string };
  topology: SiteFullPayload['topology'];
}

let cache: DeviceTopologyEnvelope | null = null;

export function normalizeTopology(json: unknown): DeviceTopologyEnvelope {
  const j = json as Partial<DeviceTopologyEnvelope> & SiteFullPayload['topology'];
  if (j && typeof j === 'object' && 'topology' in j && j.topology) return j as DeviceTopologyEnvelope;
  // Raw topology (what codegen injects): synthesize the site identity from the
  // single controller the device serves.
  const ctrl = j?.controllers?.[0] as { id?: string; friendlyName?: string } | undefined;
  return {
    site: { id: 'local', name: ctrl?.friendlyName ?? 'Controller' },
    topology: j,
  };
}

/** The siteLoad payload the dashboard bootstraps from: GET /topology.json. */
export async function deviceSitePayload(): Promise<SiteFullPayload> {
  if (!cache) {
    const res = await fetch('/topology.json');
    if (!res.ok) throw new Error(`Device topology unavailable (${res.status}).`);
    cache = normalizeTopology(await res.json());
  }
  // The one site the device serves (the device-mode router lands on
  // `/site/local/dashboard` and siteLoad ignores the route param).
  const siteId = cache.site.id || 'local';
  return {
    site: { id: siteId, friendlyName: cache.site.name, owners: [], people: [] },
    topology: cache.topology,
  };
}

/** The fetched topology's (single) controller id — the identity snapshots are
 *  attributed to, since `/local/state` events carry no controller field. Falls
 *  back to 'controller' before siteLoad has run. */
export function deviceControllerId(): string {
  return cache?.topology?.controllers?.[0]?.id ?? 'controller';
}

/** The fetched snapshot cadence (update_interval, seconds) in milliseconds —
 *  the `/local/state` SSE stream publishes one snapshot per interval. Defaults
 *  to 10s before siteLoad has run. */
export function deviceSnapshotIntervalMs(): number {
  return (cache?.topology?.timing?.update_interval ?? 10) * 1_000;
}
