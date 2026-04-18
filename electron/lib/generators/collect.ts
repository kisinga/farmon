import type { Manifest } from "../schema.js";
import type { BoardDef } from "../board.js";
import { nodesByKind, NODE_REGISTRY, buildResolveChannel, createProviderDriver } from '@far-mon/core';
import type { CodegenContext } from '@far-mon/core';

// ---------------------------------------------------------------------------
// Collected codegen output — organized by ESPHome YAML section
// ---------------------------------------------------------------------------

export interface CollectedCodegen {
  switches: string[];
  sensors: string[];
  globals: string[];
  substitutions: Record<string, string>;
  /** Catch-all sections: cover, number, binary_sensor, button, text_sensor, etc. */
  sections: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Single-pass collector
// ---------------------------------------------------------------------------

export function collectEntityCodegen(m: Manifest, board: BoardDef): CollectedCodegen {
  const providers = (m.device.io_providers ?? []).map(def => ({
    id: def.id,
    driver: createProviderDriver(def),
  }));

  const ctx: CodegenContext = {
    resolveChannel: buildResolveChannel(board, providers),
  };

  const result: CollectedCodegen = {
    switches: [],
    sensors: [],
    globals: [],
    substitutions: {},
    sections: {},
  };

  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc?.codegen) continue;
    const idx = nodesByKind(m.nodes, node.kind).indexOf(node);

    // Hardware (switch: section)
    if (desc.codegen.hardware) {
      const block = desc.codegen.hardware(node, idx, ctx);
      if (block) result.switches.push(block);
    }

    // Sensors (sensor: section)
    if (desc.codegen.sensors) {
      const block = desc.codegen.sensors(node, idx, ctx);
      if (block) result.sensors.push(block);
    }

    // Globals
    if (desc.codegen.globals) {
      const block = desc.codegen.globals(node);
      if (block) result.globals.push(block);
    }

    // Substitutions (non-pin)
    if (desc.codegen.substitutions) {
      for (const line of desc.codegen.substitutions(node)) {
        const [key, ...rest] = line.split(': ');
        if (key) result.substitutions[key.trim()] = rest.join(': ').trim();
      }
    }

    // Extra components (cover, number, binary_sensor, button, etc.)
    if (desc.codegen.extraComponents) {
      const sections = desc.codegen.extraComponents(node, idx, ctx);
      for (const [section, block] of Object.entries(sections)) {
        if (block) (result.sections[section] ??= []).push(block);
      }
    }
  }

  return result;
}
