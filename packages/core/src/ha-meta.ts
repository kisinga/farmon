/**
 * Build the HA SCADA meta sidecar from a topology.
 *
 * Pure function — runs in Node or browser, no DOM required. SVG decoration
 * lives in the editor (browser-only) because it needs live X6 rendering.
 */
import type { SystemTopology } from './topology.types';
import type { HaMeta, HaMetaNode, HaMetaPipe, HaActionSpec } from './ha';
import { HA_SCHEMA_VERSION, isValidBindExpr } from './ha';
import { NODE_REGISTRY } from './entity-registry';

export interface BuildHaMetaOptions {
  viewBox: [number, number, number, number];
  /** ISO timestamp. Pass a fixed value in tests for deterministic output. */
  generatedAt?: string;
}

export function buildHaMeta(topology: SystemTopology, opts: BuildHaMetaOptions): HaMeta {
  const nodesById = new Map<string, { entityId: string }>();
  const nodes: Record<string, HaMetaNode> = {};

  // Only iterate nodes that survive the manifest filter — pipe-connected and
  // not disabled. Disconnected nodes don't produce firmware entities, so
  // emitting meta entries for them creates phantom HA entity_ids.
  const connected = new Set<string>();
  for (const pipe of topology.pipes) {
    connected.add(pipe.from.split(':')[0]);
    connected.add(pipe.to.split(':')[0]);
  }

  const sortedNodes = [...topology.nodes]
    .filter(n => connected.has(n.id) && !(n as { disabled?: boolean }).disabled)
    .sort((a, b) => a.id.localeCompare(b.id));

  // Build pipe-adjacency once for cross-reference lookups (tank → downstream
  // level_sensor). Mirrors topology-to-manifest's tank-level association.
  const downstream = new Map<string, string[]>();
  for (const p of topology.pipes) {
    const fromId = p.from.split(':')[0];
    const toId = p.to.split(':')[0];
    if (!fromId || !toId) continue;
    const list = downstream.get(fromId) ?? [];
    list.push(toId);
    downstream.set(fromId, list);
  }
  const nodeKindById = new Map<string, { node: { id: string; kind: string }; }>();
  for (const n of topology.nodes) nodeKindById.set(n.id, { node: n as { id: string; kind: string } });

  for (const n of sortedNodes) {
    const desc = NODE_REGISTRY.get(n.kind);
    if (!desc) continue;

    if (!desc.haDomain) continue;
    // Prefer the descriptor's declared HA entity_ids — single source of truth
    // shared with firmware emit. If the descriptor has no codegen mapping or
    // returns no canonical id (e.g. a tank, or a water_source without a
    // pressure pin), try a cross-reference resolver. If that also yields
    // nothing, the node has no HA representation and the meta entry is
    // dropped — the SCADA card renders it label-only.
    const declared = desc.codegen?.haEntityIds?.(n, topology.device);
    const entityId = pickCanonicalEntityId(declared, desc.haDomain)
      ?? resolveCrossReference(n as { id: string; kind: string }, downstream, topology, nodeKindById);
    if (!entityId) continue;
    nodesById.set(n.id, { entityId });

    const binds = resolveBinds(desc.defaultBinds, n as { binds?: Record<string, string> });
    const actions = resolveActions(desc.defaultHaActions, (n as { haActions?: HaActionSpec[] }).haActions);

    nodes[n.id] = {
      kind: n.kind,
      entityId,
      ...(binds ? { binds } : {}),
      ...(actions && actions.length ? { actions } : {}),
    };
  }

  const pipes: Record<string, HaMetaPipe> = {};
  const sortedPipes = [...topology.pipes].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sortedPipes) {
    const fromNode = p.from.split(':')[0] ?? '';
    const toNode = p.to.split(':')[0] ?? '';
    const fromEntity = nodesById.get(fromNode)?.entityId;
    const toEntity = nodesById.get(toNode)?.entityId;
    const flowWhen = fromEntity ? `fromEntity.state == 'on'` : undefined;
    if (fromEntity || toEntity) {
      pipes[p.id] = {
        ...(fromEntity ? { fromEntity } : {}),
        ...(toEntity ? { toEntity } : {}),
        ...(flowWhen ? { flowWhen } : {}),
      };
    }
  }

  const meta: HaMeta = {
    schemaVersion: HA_SCHEMA_VERSION,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    viewBox: opts.viewBox,
    labelTiers: { primary: 400, secondary: 800 },
    nodes,
    pipes,
  };
  assertSlotBindSymmetry(meta);
  return meta;
}

/**
 * Pick the canonical entity from a descriptor's declared `haEntityIds`. The
 * canonical entity is the one whose domain matches `desc.haDomain`. If
 * multiple entries share the domain, the first non-undefined wins (this only
 * happens for descriptors with multiple same-domain sub-entities; in practice
 * the canonical one is always the first declared).
 */
function pickCanonicalEntityId(
  declared: Record<string, string | undefined> | undefined,
  haDomain: string,
): string | undefined {
  if (!declared) return undefined;
  for (const id of Object.values(declared)) {
    if (id?.startsWith(`${haDomain}.`)) return id;
  }
  return undefined;
}

/**
 * Resolve a node's HA entity_id by following a cross-reference to a related
 * node that owns the firmware emit. Currently implements:
 *
 *   - tank → downstream level_sensor's `level` entity. The tank itself has no
 *     codegen; its level reading comes from the connected level_sensor.
 *
 * Returns undefined when no cross-reference applies — the meta entry is then
 * dropped and the SCADA card renders the node label-only.
 */
function resolveCrossReference(
  node: { id: string; kind: string },
  downstream: Map<string, string[]>,
  topology: SystemTopology,
  nodeKindById: Map<string, { node: { id: string; kind: string } }>,
): string | undefined {
  if (node.kind === 'tank') {
    for (const neighborId of downstream.get(node.id) ?? []) {
      const neighbor = nodeKindById.get(neighborId)?.node;
      if (!neighbor || neighbor.kind !== 'level_sensor') continue;
      const desc = NODE_REGISTRY.get(neighbor.kind);
      const declared = desc?.codegen?.haEntityIds?.(neighbor as { id: string; kind: string; name: string }, topology.device);
      const id = declared?.['level'];
      if (id) return id;
    }
  }
  return undefined;
}

function resolveBinds(
  defaults: Record<string, string> | undefined,
  node: { binds?: Record<string, string> },
): Record<string, string> | undefined {
  const merged = { ...(defaults ?? {}), ...(node.binds ?? {}) };
  for (const [slot, expr] of Object.entries(merged)) {
    if (!isValidBindExpr(expr)) {
      throw new Error(`Invalid bind expression for slot "${slot}": "${expr}"`);
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function resolveActions(
  defaults: HaActionSpec[] | undefined,
  override: HaActionSpec[] | undefined,
): HaActionSpec[] | undefined {
  if (override && override.length) return override;
  return defaults;
}

/**
 * Ensure every slot referenced in a `binds` map has a corresponding declared
 * slot on its descriptor. Slot declarations drive SVG emission; drift means
 * the card has nowhere to write the resolved value.
 */
function assertSlotBindSymmetry(meta: HaMeta): void {
  for (const [nodeId, node] of Object.entries(meta.nodes)) {
    if (!node.binds) continue;
    const desc = NODE_REGISTRY.get(node.kind);
    const declaredSlots = new Set<string>(['label', ...Object.keys(desc?.slots ?? {})]);
    for (const slot of Object.keys(node.binds)) {
      if (!declaredSlots.has(slot)) {
        throw new Error(
          `Node "${nodeId}" binds slot "${slot}" but kind "${node.kind}" does not declare it. ` +
          `Either add "${slot}" to the descriptor's slots or remove the binding.`,
        );
      }
    }
  }
}
