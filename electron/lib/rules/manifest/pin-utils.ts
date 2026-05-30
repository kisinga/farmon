import type { Manifest } from "../../schema.js";
import { NODE_REGISTRY } from '@far-mon/core';

export interface PinUsage {
  pin: string;
  /** Human-readable sentence form, e.g. 'Valve "Tank 1 outlet" Open Pin'. */
  owner: string;
  /** Node ID for targeting diagnostics. */
  nodeId: string;
  /** User-facing node name. Falls back to nodeId for nameless nodes. */
  nodeName: string;
  /** Entity-kind label from the descriptor (e.g. "Valve"). */
  typeLabel: string;
  /** Field label from the descriptor (e.g. "Open Pin"). */
  fieldLabel: string;
}

/** Collect all GPIO pins used in the manifest with their owners. */
export function collectAllPins(m: Manifest): PinUsage[] {
  const pins: PinUsage[] = [];
  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) continue;
    // Skip remote-imported nodes — their pins belong to the owning controller
    if (node.remoteHaEntityId) continue;
    const nodeId = String(node.id);
    const nodeName = (typeof node.name === 'string' && node.name) ? node.name : nodeId;
    for (const field of desc.sidebarFields) {
      if (field.type !== 'pin') continue;
      const value = node[field.key];
      if (typeof value === 'string' && value) {
        pins.push({
          pin: value,
          nodeId,
          nodeName,
          typeLabel: desc.label,
          fieldLabel: field.label,
          owner: `${desc.label} "${nodeName}" ${field.label}`,
        });
      }
    }
  }
  return pins;
}
