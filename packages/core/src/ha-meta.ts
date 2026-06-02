/**
 * Build the HA SCADA meta sidecar from a topology.
 *
 * Pure function — runs in Node or browser, no DOM required. SVG decoration
 * lives in the editor (browser-only) because it needs live X6 rendering.
 */
import type { SiteTopology, TopologyNode } from './topology.types';
import type { Device } from './manifest.types';
import type { HaMeta, HaMetaNode, HaMetaPipe, HaActionSpec } from './ha';
import { HA_SCHEMA_VERSION, isValidBindExpr } from './ha';
import { NODE_REGISTRY } from './entity-registry';

export interface BuildHaMetaOptions {
  viewBox: [number, number, number, number];
  /** ISO timestamp. Pass a fixed value in tests for deterministic output. */
  generatedAt?: string;
}

export function buildHaMeta(topology: SiteTopology, device: Device, opts: BuildHaMetaOptions): HaMeta {
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
    .filter(n => connected.has(n.id) && !((n as Record<string, unknown>)['disabled']))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const n of sortedNodes) {
    const desc = NODE_REGISTRY.get(n.kind);
    if (!desc) continue;

    if (!desc.haDomain) continue;
    // Prefer the descriptor's declared HA entity_ids — single source of truth
    // shared with firmware emit. If the descriptor has no codegen mapping or
    // returns no canonical id (e.g. a tank without level monitoring, or a
    // water_source without a pressure pin), the node has no HA representation
    // and the meta entry is dropped — the SCADA card renders it label-only.
    const declared = desc.codegen?.haEntityIds?.(n, device);
    const entityId = pickCanonicalEntityId(declared, desc.haDomain);
    if (!entityId) continue;
    nodesById.set(n.id, { entityId });

    const binds = resolveBinds(desc.defaultBinds, { binds: (n as Record<string, unknown>)['binds'] as Record<string, string> | undefined });
    const actions = resolveActions(desc.defaultHaActions, (n as Record<string, unknown>)['haActions'] as HaActionSpec[] | undefined);

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
  declared: Partial<Record<import('./entity-registry').HaEntityKey, string>> | undefined,
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
