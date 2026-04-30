/**
 * Build the HA SCADA meta sidecar from a topology.
 *
 * Pure function — runs in Node or browser, no DOM required. SVG decoration
 * lives in the editor (browser-only) because it needs live X6 rendering.
 */
import type { SystemTopology } from './topology.types';
import type { HaMeta, HaMetaNode, HaMetaPipe, HaActionSpec } from './ha';
import { HA_SCHEMA_VERSION, isValidBindExpr, deriveHaEntityId } from './ha';
import { NODE_REGISTRY } from './entity-registry';

export interface BuildHaMetaOptions {
  viewBox: [number, number, number, number];
  /** ISO timestamp. Pass a fixed value in tests for deterministic output. */
  generatedAt?: string;
}

export function buildHaMeta(topology: SystemTopology, opts: BuildHaMetaOptions): HaMeta {
  const nodesById = new Map<string, { entityId: string }>();
  const nodes: Record<string, HaMetaNode> = {};
  const deviceName = topology.device.name;

  const sortedNodes = [...topology.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const n of sortedNodes) {
    const desc = NODE_REGISTRY.get(n.kind);
    if (!desc) continue;

    if (!desc.haDomain) continue;
    const entityId = deriveHaEntityId(desc.haDomain, deviceName, (n as { name: string }).name);
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
