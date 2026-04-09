/**
 * Derives an "active" topology by filtering out disabled nodes and
 * any pipes that touch them.
 *
 * This is the single gateway for all consumers that should ignore
 * disabled entities: codegen, validation, route derivation, highlighting.
 * Canvas rendering uses the *full* topology (for cosmetic display).
 *
 * Generic over the topology shape so it works with both the shared
 * SystemTopology (Angular) and the Zod-inferred Topology (Electron).
 */

interface HasDisabled { id: string; disabled?: boolean }
interface HasPortRefs { from: string; to: string }

type TopologyLike<N extends HasDisabled, P extends HasPortRefs> = {
  nodes: N[];
  pipes: P[];
};

export function activeTopology<T extends TopologyLike<HasDisabled, HasPortRefs>>(topology: T): T {
  const disabledIds = new Set<string>();
  for (const n of topology.nodes) {
    if (n.disabled) disabledIds.add(n.id);
  }

  // Fast path: nothing disabled → return as-is (avoids allocation)
  if (disabledIds.size === 0) return topology;

  const nodes = topology.nodes.filter(n => !disabledIds.has(n.id));
  const pipes = topology.pipes.filter(p => {
    const from = p.from.split(':')[0];
    const to = p.to.split(':')[0];
    return !disabledIds.has(from) && !disabledIds.has(to);
  });

  return { ...topology, nodes, pipes };
}
