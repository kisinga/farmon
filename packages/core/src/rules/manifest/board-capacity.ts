import type { Manifest } from "@far-mon/core";
import type { BoardDef } from "@far-mon/core";
import { pinsWithCapability } from "@far-mon/core";
import type { ManifestRule, RuleDiagnostic } from "../rule.types";
import { NODE_REGISTRY, isFieldVisible } from '@far-mon/core';
import type { PinCap } from '@far-mon/core';
import type { ExpansionBoardCatalog } from '@far-mon/core';

/**
 * Board pin-pool capacity — checks per-capability pin pools.
 *
 * Boards like the KC868-A16 have segregated pin pools: 16 relay outputs,
 * 4 ADC inputs, 3 pulse counter pins. Expansion boards add more channels.
 * This rule counts demand vs supply across board + expansion channels.
 */
export const boardCapacity: ManifestRule = {
  id: "board-capacity",
  name: "Board pin pool capacity",

  evaluate(m: Manifest, board: BoardDef, expansionBoards: ExpansionBoardCatalog = {}): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    // Count demanded pins by required capability (from visible entity sidebar fields)
    const demandByCapability = new Map<PinCap, number>();
    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) continue;
      for (const field of desc.sidebarFields) {
        if (field.type !== 'pin' || !field.pinCap) continue;
        if (!isFieldVisible(field, node as Record<string, unknown>)) continue;
        const pin = (node as Record<string, unknown>)[field.key];
        if (typeof pin === 'string' && pin) {
          demandByCapability.set(field.pinCap, (demandByCapability.get(field.pinCap) ?? 0) + 1);
        }
      }
    }

    // Count supply from board-native pins
    const supplyByCapability = new Map<PinCap, number>();
    for (const cap of demandByCapability.keys()) {
      supplyByCapability.set(cap, pinsWithCapability(board, cap).size);
    }

    // Count supply from expansion boards (I/O providers whose type is a known board model)
    for (const prov of m.device.io_providers ?? []) {
      const boardDef = expansionBoards[prov.type];
      if (!boardDef) continue;
      for (const ch of boardDef.channels) {
        for (const cap of ch.caps) {
          supplyByCapability.set(cap, (supplyByCapability.get(cap) ?? 0) + 1);
        }
      }
    }

    // Check each capability pool
    for (const [cap, demand] of demandByCapability) {
      const supply = supplyByCapability.get(cap) ?? 0;
      if (demand > supply) {
        diagnostics.push({
          severity: 'error',
          message: `${demand} pins require ${cap} capability, but only ${supply} available.`,
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
          const desc = NODE_REGISTRY.get(node.kind);
          if (!desc) continue;
          for (const field of desc.sidebarFields) {
            if (field.type !== 'pin') continue;
            const pin = (node as Record<string, unknown>)[field.key];
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
