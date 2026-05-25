import type { Manifest } from "../../schema.js";
import type { BoardDef } from "../../board.js";
import { pinsWithCapability } from "../../board.js";
import type { ManifestRule, RuleDiagnostic } from "../rule.types.js";
import { NODE_REGISTRY } from '@far-mon/core';
import type { PinCap } from '@far-mon/core';

export const pinCapabilities: ManifestRule = {
  id: "pin-capabilities",
  name: "Pin capability checks",

  evaluate(m: Manifest, board: BoardDef): RuleDiagnostic[] {
    const diagnostics: RuleDiagnostic[] = [];

    // Cache capability lookups
    const capCache = new Map<PinCap, Set<string>>();
    const getPins = (cap: PinCap) => {
      if (!capCache.has(cap)) capCache.set(cap, pinsWithCapability(board, cap));
      return capCache.get(cap)!;
    };

    // Check every node's pin fields against required capabilities
    for (const node of m.nodes) {
      const desc = NODE_REGISTRY.get(node.kind);
      if (!desc) continue;

      for (const field of desc.sidebarFields) {
        if (field.type !== 'pin' || !field.pinCap) continue;
        const pin = node[field.key];
        if (typeof pin !== 'string' || !pin) continue;

        // Provider channels (e.g., mux1:CH3) are validated by their provider, not the board
        if (pin.includes(':')) continue;

        const validPins = getPins(field.pinCap);
        if (!validPins.has(pin)) {
          // Expander pins (PCF8574 etc.) physically cannot do pulse counting — hard error.
          // Native GPIO pins without pulse_counter in caps may still work — warning.
          const pinDef = board.pins.find(p => p.gpio === pin);
          const isExpanderPin = !!pinDef?.expander;
          const severity = (field.pinCap === 'pulse_counter' && !isExpanderPin) ? 'warning' : 'error';
          const detail = isExpanderPin && field.pinCap === 'pulse_counter'
            ? ` (I2C expander ${pinDef!.expander} cannot do hardware pulse counting — use a native GPIO pin)`
            : '';
          diagnostics.push({
            severity,
            message: `${desc.label} "${node.id}": ${pin} does not have ${field.pinCap} capability on ${board.label}${detail}`,
            target: String(node.id),
            ruleId: this.id,
          });
        }
      }
    }

    return diagnostics;
  },
};
