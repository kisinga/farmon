import type { Manifest } from "../../schema.js";
import { NODE_REGISTRY } from '@far-mon/core';

export interface PinUsage {
  pin: string;
  owner: string;
  /** Node ID for targeting diagnostics. */
  nodeId: string;
}

/** Collect all GPIO pins used in the manifest with their owners. */
export function collectAllPins(m: Manifest): PinUsage[] {
  const pins: PinUsage[] = [];
  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node['kind']);
    if (!desc) continue;
    for (const field of desc.sidebarFields) {
      if (field.type !== 'pin') continue;
      const value = node[field.key];
      if (typeof value === 'string' && value) {
        pins.push({
          pin: value,
          nodeId: String(node['id']),
          owner: `${desc.label.toLowerCase()} "${node['id']}" ${field.label.toLowerCase()}`,
        });
      }
    }
  }
  return pins;
}
