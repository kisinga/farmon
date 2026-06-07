import type { Manifest } from '@core';
import type { BoardDef, ExpansionBoardCatalog } from '@core';
import { nodesByKind, NODE_REGISTRY, buildResolveChannel, buildProviderDrivers } from '@core';
import type { CodegenContext } from '@core';
import type { GenerationMetadata } from "../backends/types";


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
  /** Top-level ESPHome infrastructure sections from provider drivers. */
  infrastructure: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Single-pass collector
// ---------------------------------------------------------------------------

export function collectEntityCodegen(
  m: Manifest,
  board: BoardDef,
  expansionBoards: ExpansionBoardCatalog,
  metadata: GenerationMetadata,
): CollectedCodegen {
  const providers = buildProviderDrivers(m.device.io_providers ?? [], expansionBoards);

  const ctx: CodegenContext = {
    resolveChannel: buildResolveChannel(board, providers),
  };

  // Cross-controller proxies are generic by node id (see coordination.ts), so the
  // proxy emitters take only the node.

  const result: CollectedCodegen = {
    switches: [],
    sensors: [],
    globals: [],
    substitutions: {},
    sections: {},
    infrastructure: {},
  };

  // Collect infrastructure YAML from all providers
  for (const { driver } of providers) {
    const infra = driver.infrastructureYaml?.() ?? [];
    for (const { section, yaml } of infra) {
      (result.infrastructure[section] ??= []).push(yaml);
    }
  }

  // Determine the controller this manifest belongs to.
  // topologyToManifestForController sets controllerId; test fixtures that
  // create Manifest directly may not have it, so fall back to friendly_name.
  const controllerId = m.controllerId ?? m.device.friendly_name;

  // --- Imported nodes: proxy generation only, no local hardware ---
  for (const node of m.imports) {
    const desc = NODE_REGISTRY.get(node.kind);
    const proxies = desc?.codegen?.remoteProxy?.(node);
    if (proxies) {
      for (const proxy of proxies) {
        (result.sections[proxy.section] ??= []).push(proxy.yaml);
      }
    }
  }

  // --- Local nodes: hardware, sensors, substitutions, extras ---
  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);

    // Remote proxy for local nodes with remote HA entity (e.g. tank with remote level source).
    if (node.remoteHaEntityId) {
      const proxies = desc?.codegen?.remoteProxy?.(node);
      if (proxies) {
        for (const proxy of proxies) {
          (result.sections[proxy.section] ??= []).push(proxy.yaml);
        }
      }
      continue;
    }

    // Skip hardware for nodes anchored to other controllers that have no
    // remote HA entity (e.g. a remote water_source without a pressure pin).
    // Backward compat: nodes without anchorId (pre-split test fixtures)
    // are treated as belonging to this controller.
    if (node.anchorId && node.anchorId !== controllerId) continue;

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
