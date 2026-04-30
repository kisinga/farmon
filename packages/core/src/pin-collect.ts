/**
 * Generic pin extraction from topology nodes using the entity registry.
 * Single source of truth — no manual per-kind enumeration.
 */

import { NODE_REGISTRY } from './entity-registry';
import type { TopologyNode } from './topology.types';

export interface PinUsage {
  pin: string;
  nodeId: string;
  /** User-facing node name (e.g. "Tank 1 outlet"). Falls back to nodeId for nameless nodes. */
  nodeName: string;
  /** Entity-kind label from the descriptor (e.g. "Valve", "Flow Sensor"). */
  typeLabel: string;
  fieldKey: string;
  /** Field label from the descriptor (e.g. "Open Pin", "Close Pin"). */
  fieldLabel: string;
  /** Human-readable sentence form, e.g. 'Valve "Tank 1 outlet" Open Pin'. */
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
    const nodeName = ((node as unknown as { name?: string }).name) || node.id;
    for (const field of desc.sidebarFields) {
      if (field.type !== 'pin') continue;
      const value = (node as unknown as Record<string, unknown>)[field.key];
      if (typeof value === 'string' && value) {
        result.push({
          pin: value,
          nodeId: node.id,
          nodeName,
          typeLabel: desc.label,
          fieldKey: field.key,
          fieldLabel: field.label,
          owner: `${desc.label} "${nodeName}" ${field.label}`,
        });
      }
    }
  }
  return result;
}
