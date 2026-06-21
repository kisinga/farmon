/**
 * Auto-assign board pins to node pin-fields, deriving each field's capability
 * from the entity registry. Shared by Easy Mode (compose a fresh topology) and
 * Expert Mode ("fill pins" on a hand-drawn one).
 *
 * Relays and digital inputs share the 'digital' cap, so digital fields are given
 * relay-output pins (connector `relay*`). Pins already set on any node are
 * treated as taken so nothing is double-assigned.
 */
import { NODE_REGISTRY } from '../entity-registry';
import type { TopologyNode } from '../topology.types';
import type { BoardDef, PinCap } from '../board.types';
import { reservedPins } from '../board.types';
import { isFieldVisible } from '../pin-collect';

export interface AutoPinResult {
  /** Count of pins assigned, by capability. */
  used: Partial<Record<PinCap, number>>;
  /** Fields that wanted a pin but found none free of that capability. */
  unassigned: Array<{ nodeId: string; field: string; cap: PinCap }>;
}

export interface AutoPinOptions {
  /** Only assign to pin fields that are currently empty (default true). */
  onlyEmpty?: boolean;
  /** Policy hook: return false to skip an otherwise-eligible pin field. */
  include?: (node: TopologyNode, fieldKey: string) => boolean;
}

function freePins(board: BoardDef, cap: PinCap, relayOnly: boolean): string[] {
  const reserved = reservedPins(board);
  return board.pins
    .filter(p => p.caps.includes(cap) && !reserved.has(p.gpio) && (!relayOnly || /^relay/i.test(p.connector)))
    .map(p => p.gpio);
}

export function autoAssignPins(nodes: TopologyNode[], board: BoardDef, opts: AutoPinOptions = {}): AutoPinResult {
  const onlyEmpty = opts.onlyEmpty ?? true;
  const { include } = opts;

  const pool: Partial<Record<PinCap, string[]>> = {
    digital: freePins(board, 'digital', true),
    adc: freePins(board, 'adc', false),
    pulse_counter: freePins(board, 'pulse_counter', false),
    pwm: freePins(board, 'pwm', false),
    dac: freePins(board, 'dac', false),
  };

  // Pins already set on any node are taken — never double-assign.
  const taken = new Set<string>();
  for (const node of nodes) {
    const rec = node as unknown as Record<string, unknown>;
    for (const f of NODE_REGISTRY.get(node.kind)?.sidebarFields ?? []) {
      if (f.type === 'pin' && typeof rec[f.key] === 'string' && rec[f.key]) taken.add(rec[f.key] as string);
    }
  }
  for (const cap of Object.keys(pool) as PinCap[]) {
    pool[cap] = pool[cap]!.filter(p => !taken.has(p));
  }

  const used: Partial<Record<PinCap, number>> = {};
  const unassigned: AutoPinResult['unassigned'] = [];

  for (const node of nodes) {
    const rec = node as unknown as Record<string, unknown>;
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) continue;
    for (const f of desc.sidebarFields) {
      if (f.type !== 'pin' || !f.pinCap || !isFieldVisible(f, rec)) continue;
      if (onlyEmpty && typeof rec[f.key] === 'string' && rec[f.key]) continue;
      if (include && !include(node, f.key)) continue;
      const pin = pool[f.pinCap]?.shift();
      if (!pin) { unassigned.push({ nodeId: node.id, field: f.key, cap: f.pinCap }); continue; }
      rec[f.key] = pin;
      used[f.pinCap] = (used[f.pinCap] ?? 0) + 1;
    }
  }
  return { used, unassigned };
}
