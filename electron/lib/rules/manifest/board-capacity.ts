import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { pinsWithCapability } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { NODE_REGISTRY } from '@far-mon/core';
import type { PinCap } from '@far-mon/core';

/**
 * Board pin-pool capacity — checks per-capability pin pools.
 *
 * Boards like the KC868-A16 have segregated pin pools: 16 relay outputs,
 * 4 ADC inputs, 3 pulse counter pins. The generic gpio-budget rule counts
 * total pins, but this rule catches over-subscription of individual pools.
 */
export const boardCapacity: ManifestRule = {
  id: "board-capacity",
  name: "Board pin pool capacity",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    // Count demanded pins by required capability (from entity sidebar field pinCap)
    const demandByCapability = new Map<PinCap, number>();
    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node['kind']);
      if (!desc) continue;
      for (const field of desc.sidebarFields) {
        if (field.type !== 'pin' || !field.pinCap) continue;
        const pin = node[field.key];
        if (typeof pin === 'string' && pin && !pin.includes(':')) {
          // Only count board pins — provider channels are managed by their provider
          demandByCapability.set(field.pinCap, (demandByCapability.get(field.pinCap) ?? 0) + 1);
        }
      }
    }

    // Check each capability pool
    for (const [cap, demand] of demandByCapability) {
      const available = pinsWithCapability(board, cap);
      if (demand > available.size) {
        const pinList = [...available].join(', ');
        diagnostics.push({
          severity: 'error',
          message: `${demand} pins require ${cap} capability, but ${board.label} only has ${available.size} (${pinList}).`,
          ruleId: this.id,
        });
      }
    }

    // Secondary check: count relay/output expander pin usage.
    // Valve open/close pins and pump relay pins have no pinCap set on their sidebar fields,
    // so the generic per-cap check above misses output pin over-subscription.
    if (board.expanders && board.expanders.length > 0) {
      const outputPins = new Set(
        board.pins.filter(p => p.expander && p.caps.includes('digital') && /^OUT\d+$/i.test(p.gpio)).map(p => p.gpio),
      );
      if (outputPins.size > 0) {
        let outputDemand = 0;
        for (const node of m.nodes) {
          const desc = NODE_REGISTRY.get(node['kind']);
          if (!desc) continue;
          for (const field of desc.sidebarFields) {
            if (field.type !== 'pin') continue;
            const pin = node[field.key];
            if (typeof pin === 'string' && outputPins.has(pin)) {
              outputDemand++;
            }
          }
        }
        if (outputDemand > outputPins.size) {
          diagnostics.push({
            severity: 'error',
            message: `${outputDemand} relay output pins used, but ${board.label} only has ${outputPins.size} (OUT1-OUT${outputPins.size}).`,
            ruleId: this.id,
          });
        }
      }
    }

    return diagnostics;
  },
};
