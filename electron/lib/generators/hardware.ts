import type { Manifest } from "../schema.js";
import { nodesWithFlag } from "../schema.js";
import { joinYamlItems } from '@far-mon/core';
import type { CollectedCodegen } from "./collect.js";

export function generateHardware(m: Manifest, collected: CollectedCodegen): string {
  const valves = nodesWithFlag(m.nodes, 'isValve');
  const pump = nodesWithFlag(m.nodes, 'isPump')[0];

  const covers = collected.sections['cover'] ?? [];

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

${collected.switches.length > 0 ? `switch:\n${joinYamlItems(collected.switches)}` : ""}

${covers.length > 0 ? `# --- Ball valves (covers) ----------------------------------------------------

cover:
${joinYamlItems(covers)}` : ""}
`;
}
