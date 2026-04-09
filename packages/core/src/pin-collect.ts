/**
 * Generic pin extraction from topology nodes using the entity registry.
 * Single source of truth — no manual per-kind enumeration.
 */

import { NODE_REGISTRY } from './entity-registry';
import type { TopologyNode } from './topology.types';

export interface PinUsage {
  pin: string;
  nodeId: string;
  fieldKey: string;
  /** Human-readable owner, e.g. 'valve "valve1" open pin' */
  owner: string;
}

/**
 * Walk every node's registered sidebar fields, collect all pin assignments.
 * Adding a new node type with pin fields requires zero changes here —
 * just register it with `type: 'pin'` in its sidebarFields.
 */
export function collectPins(nodes: TopologyNode[]): PinUsage[] {
  const result: PinUsage[] = [];
  for (const node of nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) continue;
    for (const field of desc.sidebarFields) {
      if (field.type !== 'pin') continue;
      const value = (node as unknown as Record<string, unknown>)[field.key];
      if (typeof value === 'string' && value) {
        result.push({
          pin: value,
          nodeId: node.id,
          fieldKey: field.key,
          owner: `${desc.label.toLowerCase()} "${node.id}" ${field.label.toLowerCase()}`,
        });
      }
    }
  }
  return result;
}
