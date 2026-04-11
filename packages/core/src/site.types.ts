/**
 * Site types — a composition layer that groups multiple systems
 * on a single canvas with inter-system links.
 *
 * Sites are purely for visualization and reasoning about the whole
 * water network. Each system remains independent (own config, board,
 * codegen, validation). HA handles orchestration between devices.
 */

// ---------------------------------------------------------------------------
// Site document
// ---------------------------------------------------------------------------

export interface Site {
  schema: 1;
  name: string;
  friendly_name: string;
  systems: SystemPlacement[];
  links: SiteLink[];
}

// ---------------------------------------------------------------------------
// System placement — a reference to an existing system config
// ---------------------------------------------------------------------------

export interface SystemPlacement {
  /** Name of the system config (references store/configs/{config}.yaml). */
  config: string;
  /** Position of the system group on the site canvas. */
  position: { x: number; y: number };
  /** SHA-256 checksum of the system topology at last site save. */
  checksum: string;
}

// ---------------------------------------------------------------------------
// Inter-system links
// ---------------------------------------------------------------------------

export interface SiteLink {
  id: string;
  /** Source port: "configName/nodeId:portId" */
  from: string;
  /** Target port: "configName/nodeId:portId" */
  to: string;
  /** Optional annotation (e.g., "50m PVC run"). */
  label?: string;
}

// ---------------------------------------------------------------------------
// Store list entry
// ---------------------------------------------------------------------------

export interface SiteListEntry {
  name: string;
  friendlyName: string;
  systemCount: number;
  linkCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a site link port reference: "configName/nodeId:portId"
 * Returns the config name, node ID, and port ID.
 */
export function parseSiteLinkRef(ref: string): { config: string; nodeId: string; portId: string } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) throw new Error(`Invalid site link ref: ${ref} (missing /)`);
  const config = ref.slice(0, slashIdx);
  const rest = ref.slice(slashIdx + 1);
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) throw new Error(`Invalid site link ref: ${ref} (missing :)`);
  return {
    config,
    nodeId: rest.slice(0, colonIdx),
    portId: rest.slice(colonIdx + 1),
  };
}

/** Build a site link port reference from parts. */
export function siteLinkRef(config: string, nodeId: string, portId: string): string {
  return `${config}/${nodeId}:${portId}`;
}
