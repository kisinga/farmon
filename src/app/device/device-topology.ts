import type { SiteFullPayload } from '../core/models/backend-api';
import data from './device-topology.json';

/**
 * Baked site topology for the device-mode build. On the device there is no
 * `sites` collection to load from — the topology ships inside the bundle as a
 * generated JSON module (scripts/emit-device-topology.mjs; per-site codegen
 * will regenerate it before each device build). Imported statically, so it is
 * tree-shaken out of the cloud build together with the device services.
 *
 * The topology value keeps the raw stored shape (the same JSON the `sites`
 * record's `draft_topology` carries); the dashboard runs it through
 * parseTopology exactly as it does the PocketBase payload.
 */
interface DeviceTopologyFile {
  site: { id: string; name: string };
  topology: SiteFullPayload['topology'];
}

const file = data as DeviceTopologyFile;

/** The one site the device serves (fixed 'local'; the device-mode router lands
 *  on `/site/local/dashboard` and siteLoad ignores the route param). */
const siteId = file.site.id || 'local';

/** The siteLoad payload the dashboard bootstraps from, built from the baked file. */
export function deviceSitePayload(): SiteFullPayload {
  return {
    site: { id: siteId, friendlyName: file.site.name, owners: [], people: [] },
    topology: file.topology,
  };
}

/** The baked topology's (single) controller id — the identity snapshots are
 *  attributed to, since `/local/state` events carry no controller field. */
export function deviceControllerId(): string {
  return file.topology?.controllers?.[0]?.id ?? 'controller';
}

/** The baked snapshot cadence (update_interval, seconds) in milliseconds — the
 *  `/local/state` SSE stream publishes one snapshot per interval. */
export function deviceSnapshotIntervalMs(): number {
  return (file.topology?.timing?.update_interval ?? 10) * 1_000;
}
