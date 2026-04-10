import type { Manifest } from "../schema.js";
import { nodesByKind, nodesWithFlag } from "../schema.js";
import { NODE_REGISTRY } from '@far-mon/core';

export function generateHardware(m: Manifest): string {
  // Collect hardware blocks from all entities that provide them
  const switchBlocks: string[] = [];
  const extraSections: Record<string, string[]> = {};

  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc?.codegen) continue;
    const idx = nodesByKind(m.nodes, node.kind).indexOf(node);
    if (desc.codegen.hardware) {
      const block = desc.codegen.hardware(node, idx);
      if (block) switchBlocks.push(block);
    }
    if (desc.codegen.extraComponents) {
      const sections = desc.codegen.extraComponents(node, idx);
      // hardware.ts owns only 'cover' — all other sections go to sensors.ts
      for (const [section, block] of Object.entries(sections)) {
        if (section === 'cover' && block) (extraSections[section] ??= []).push(block);
      }
    }
  }

  const valves = nodesWithFlag(m.nodes, 'isValve');
  const pump = nodesWithFlag(m.nodes, 'isPump')[0];

  return `\
# =============================================================================
# MajiFlow — Hardware Layer
# =============================================================================
# AUTO-GENERATED from system manifest. Do not edit by hand.
#
# Physical actuators only. No state logic, no sensor readings.
#
# Components:
${pump ? "#   - 1x pump relay (guarded: only energizes in RUNNING state)\n" : ""}\
#   - ${valves.length}x motorized ball valves (2-pin each, hardware interlocked)
# =============================================================================

${switchBlocks.length > 0 ? `switch:\n${switchBlocks.join("\n\n")}` : ""}

${(extraSections['cover'] ?? []).length > 0 ? `# --- Ball valves (covers) ----------------------------------------------------

cover:
${(extraSections['cover']).join("\n\n")}` : ""}
${Object.entries(extraSections)
    .filter(([k]) => k !== 'cover')
    .map(([section, blocks]) => `\n${section}:\n${blocks.join("\n\n")}`)
    .join("\n")}
`;
}
