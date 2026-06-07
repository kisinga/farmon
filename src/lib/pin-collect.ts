/**
 * Generic pin extraction from topology nodes using the entity registry.
 * Single source of truth — no manual per-kind enumeration.
 */

import { NODE_REGISTRY } from './entity-registry';
import type { TopologyNode } from './topology.types';
import type { FieldDef } from './entity-registry';

export interface PinUsage {
  pin: string;
  nodeId: string;
  /** Node kind (e.g. 'valve', 'pump') — drives entity colour for pinout callouts. */
  kind: TopologyNode['kind'];
  /** User-facing node name (e.g. "Tank 1 outlet"). Falls back to nodeId for nameless nodes. */
  nodeName: string;
  /** Entity-kind label from the descriptor (e.g. "Valve", "Flow Sensor"). */
  typeLabel: string;
  fieldKey: string;
  /** Field label from the descriptor (e.g. "Open Pin", "Close Pin"). */
  fieldLabel: string;
  /** Human-readable sentence form, e.g. 'Valve "Tank 1 outlet" Open Pin'. */
  owner: string;
  /** Display label for the relay polarity governing this pin, when the field declares a `polarityKey`. */
  polarity?: string;
}

const POLARITY_LABELS: Record<string, string> = {
  active_low: 'Active-low',
  active_high: 'Active-high',
};

/**
 * Walk every node's registered sidebar fields, collect all pin assignments.
 * Adding a new node type with pin fields requires zero changes here —
 * just register it with `type: 'pin'` in its sidebarFields.
 */
export function isFieldVisible(field: FieldDef, node: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const value = node[field.visibleWhen.key];
  if ('eq' in field.visibleWhen) return value === field.visibleWhen.eq;
  if ('in' in field.visibleWhen) return (field.visibleWhen.in as ReadonlyArray<unknown>).includes(value as string);
  if ('neq' in field.visibleWhen) return value !== field.visibleWhen.neq;
  return true;
}

export function collectPins(nodes: TopologyNode[]): PinUsage[] {
  const result: PinUsage[] = [];
  for (const node of nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) continue;
    const nodeName = node.name || node.id;
    const nodeRecord = node as Record<string, unknown>;
    for (const field of desc.sidebarFields) {
      if (field.type !== 'pin') continue;
      if (!isFieldVisible(field, nodeRecord)) continue;
      const value = nodeRecord[field.key];
      if (typeof value === 'string' && value) {
        let polarity: string | undefined;
        if (field.polarityKey) {
          const raw = nodeRecord[field.polarityKey];
          if (typeof raw === 'string') polarity = POLARITY_LABELS[raw] ?? raw;
        }
        result.push({
          pin: value,
          nodeId: node.id,
          kind: node.kind,
          nodeName,
          typeLabel: desc.label,
          fieldKey: field.key,
          fieldLabel: field.label,
          owner: `${desc.label} "${nodeName}" ${field.label}`,
          polarity,
        });
      }
    }
  }
  return result;
}
