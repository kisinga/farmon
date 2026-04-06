import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";
import { NODE_REGISTRY } from "../../../shared/entity-registry.js";

export function generateHardware(m: Manifest): string {
  // Collect hardware blocks from all entities that provide them
  const switchBlocks: string[] = [];

  for (const node of m.nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc?.codegen?.hardware) continue;
    const idx = nodesByKind(m.nodes, node.kind).indexOf(node);
    const block = desc.codegen.hardware(node, idx);
    if (block) switchBlocks.push(block);
  }

  // Valve covers — still specific to valves (covers are a distinct YAML section)
  const valves = nodesByKind(m.nodes, 'valve');
  const coverBlocks = valves.map((v) => `\
  - platform: time_based
    id: ${v['id']}
    name: "${v['name']}"

    open_action:  [{switch.turn_on: ${v['id']}_open_pin}]
    close_action: [{switch.turn_on: ${v['id']}_close_pin}]
    stop_action:  [{switch.turn_off: ${v['id']}_open_pin}, {switch.turn_off: ${v['id']}_close_pin}]
    open_duration: \${valve_travel_time}
    close_duration: \${valve_travel_time}`);

  const pump = nodesByKind(m.nodes, 'pump')[0];

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

${coverBlocks.length > 0 ? `# --- Ball valves (covers) ----------------------------------------------------

cover:
${coverBlocks.join("\n\n")}` : ""}
`;
}
