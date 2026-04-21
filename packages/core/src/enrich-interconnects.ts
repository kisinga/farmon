/**
 * Inject connection metadata (`_connectionLabel`, `_connectionDir`) into
 * interconnect nodes so `interconnect.renderSvg` can display the name of the
 * system on the other side of the link.
 *
 * Pure function, no DOM — same logic runs in editor (per-system) and in docs
 * (per-system and composite).
 */
import type { SystemTopology, TopologyNode } from "./topology.types";
import type { LinkData } from "./site.types";

export interface InterconnectContext {
  /** All systems in the site, keyed by systemId. Used to resolve remote friendly names. */
  systems: ReadonlyMap<string, { topology: Pick<SystemTopology, "device"> }>;
  /** All inter-system links across the site. */
  links: ReadonlyArray<LinkData>;
}

/**
 * Enrich interconnect nodes in a per-system topology. Matches the link's
 * `fromNode/toNode` against plain node IDs (no `systemId/` prefix).
 */
export function enrichPerSystemInterconnects(
  topology: SystemTopology,
  systemId: string,
  ctx: InterconnectContext,
): SystemTopology {
  const labels = buildPerSystemLabelMap(systemId, ctx);
  if (labels.size === 0) return topology;
  return {
    ...topology,
    nodes: topology.nodes.map(n => applyLabel(n, n.id, labels)),
  };
}

/**
 * Enrich interconnect nodes in a composite topology. Node IDs are expected to
 * be `systemId/nodeId` form (as built by `buildCompositeTopology`).
 */
export function enrichCompositeInterconnects(
  topology: SystemTopology,
  ctx: InterconnectContext,
): SystemTopology {
  const labels = buildCompositeLabelMap(ctx);
  if (labels.size === 0) return topology;
  return {
    ...topology,
    nodes: topology.nodes.map(n => applyLabel(n, n.id, labels)),
  };
}

// --- helpers ---

type LabelInfo = { label: string; dir: "out" | "in" };

function applyLabel(node: TopologyNode, key: string, labels: Map<string, LabelInfo>): TopologyNode {
  if (node.kind !== "interconnect") return node;
  const info = labels.get(key);
  if (!info) return node;
  return { ...node, _connectionLabel: info.label, _connectionDir: info.dir } as TopologyNode;
}

function friendlyName(systems: InterconnectContext["systems"], id: string): string {
  return systems.get(id)?.topology.device.friendly_name ?? id;
}

function buildPerSystemLabelMap(systemId: string, ctx: InterconnectContext): Map<string, LabelInfo> {
  const out = new Map<string, LabelInfo>();
  for (const link of ctx.links) {
    if (link.fromSystem === systemId) {
      out.set(link.fromNode, { label: friendlyName(ctx.systems, link.toSystem), dir: "out" });
    }
    if (link.toSystem === systemId) {
      out.set(link.toNode, { label: friendlyName(ctx.systems, link.fromSystem), dir: "in" });
    }
  }
  return out;
}

function buildCompositeLabelMap(ctx: InterconnectContext): Map<string, LabelInfo> {
  const out = new Map<string, LabelInfo>();
  for (const link of ctx.links) {
    out.set(`${link.fromSystem}/${link.fromNode}`, {
      label: friendlyName(ctx.systems, link.toSystem),
      dir: "out",
    });
    out.set(`${link.toSystem}/${link.toNode}`, {
      label: friendlyName(ctx.systems, link.fromSystem),
      dir: "in",
    });
  }
  return out;
}
