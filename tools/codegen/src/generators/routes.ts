import type { Manifest } from "../schema.js";

const WATCHDOG_MAP: Record<string, { value: number; define: string }> = {
  flow: { value: 0, define: "WD_FLOW" },
  level_rise: { value: 1, define: "WD_LEVEL_RISE" },
  runtime_only: { value: 2, define: "WD_RUNTIME" },
};

export function generateRoutes(m: Manifest): string {
  const tankIdx = new Map(m.tanks.map((t, i) => [t.id, i]));
  const valveIdx = new Map(m.valves.map((v, i) => [v.id, i]));
  const flowIdx = new Map(m.flow_sensors.map((f, i) => [f.id, i]));

  // Build route entries
  const routeLines = m.routes.map((r, i) => {
    const mask = r.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
    const src = tankIdx.get(r.source)!;
    const dst = r.destination ? tankIdx.get(r.destination)! : "0xFF";
    const flow = r.flow_sensor ? flowIdx.get(r.flow_sensor)! : "0xFF";
    const wd = WATCHDOG_MAP[r.watchdog].define;
    const maskBin = mask.toString(2).padStart(m.valves.length, "0");
    return `  { ${i}, 0b${maskBin}, ${src}, ${dst}, ${flow}, ${wd}, "${r.name}" },`;
  });

  // Build valve index comment
  const valveComment = m.valves
    .map((v, i) => `${i}=${v.id}(${v.name})`)
    .join("  ");
  const tankComment = m.tanks
    .map((t, i) => `${i}=${t.id}(${t.name})`)
    .join("  ");
  const flowComment = m.flow_sensors.length
    ? m.flow_sensors.map((f, i) => `${i}=${f.id}(${f.name})`).join("  ")
    : "(none)";

  // Build dispatch functions
  const openCases = m.valves
    .map((v, i) => `    case ${i}: id(${v.id}).make_call().set_command_open().perform(); break;`)
    .join("\n");
  const closeCases = m.valves
    .map((v, i) => `    case ${i}: id(${v.id}).make_call().set_command_close().perform(); break;`)
    .join("\n");
  const tankCases = m.tanks
    .map((t, i) => `    case ${i}: return id(${t.id}_level).state;`)
    .join("\n");
  const flowCases = m.flow_sensors
    .map((f, i) => `    case ${i}: return id(${f.id}).state;`)
    .join("\n");

  return `\
// =============================================================================
// Pump Controller — Route Table & Hardware Dispatch
// =============================================================================
// AUTO-GENERATED from system manifest. Do not edit by hand.
// Regenerate: npx tsx tools/codegen/src/main.ts generate system.yaml
//
// The state machine (control.yaml) is topology-agnostic — it never
// references valve/tank/flow IDs directly. All routing goes through
// the ROUTES[] table and dispatch functions defined here.
// =============================================================================

#pragma once

#include "esphome.h"

// --- Watchdog strategies ----------------------------------------------------
#define WD_FLOW        0   // Flow sensor must see pulses within timeout
#define WD_LEVEL_RISE  1   // Destination tank level must rise within window
#define WD_RUNTIME     2   // No path sensor — only max_runtime protects

// --- Route descriptor -------------------------------------------------------

struct Route {
  uint8_t     id;
  uint16_t    valve_mask;     // bit N = open valve N for this route
  uint8_t     source_tank;    // index into tanks — 0xFF = none
  uint8_t     dest_tank;      // index into tanks — 0xFF = endpoint (house/irrigation)
  uint8_t     flow_sensor;    // index into flow sensors — 0xFF = none
  uint8_t     watchdog;       // WD_FLOW, WD_LEVEL_RISE, or WD_RUNTIME
  const char* name;           // human label for OLED / logs / HA
};

// --- Component counts -------------------------------------------------------

static const int NUM_VALVES       = ${m.valves.length};
static const int NUM_TANKS        = ${m.tanks.length};
static const int NUM_FLOW_SENSORS = ${m.flow_sensors.length};
static const int NUM_ROUTES       = ${m.routes.length};

// --- Route table ------------------------------------------------------------
//
// Valve indices:  ${valveComment}
// Tank indices:   ${tankComment}
// Flow indices:   ${flowComment}

static const Route ROUTES[NUM_ROUTES] = {
  //  id   valve_mask  src  dst   flow   watchdog       name
${routeLines.join("\n")}
};

// --- Dispatch functions -----------------------------------------------------

inline void open_valve(int idx) {
  switch (idx) {
${openCases}
  }
}

inline void close_valve(int idx) {
  switch (idx) {
${closeCases}
  }
}

inline float get_tank_level(int idx) {
  switch (idx) {
${tankCases}
    default: return -1.0f;
  }
}

inline float get_flow_rate(int idx) {
  switch (idx) {
${flowCases}${flowCases ? "\n" : ""}    default: return -1.0f;
  }
}
`;
}
