import type { Manifest } from "../schema.js";

export function generateRoutes(m: Manifest): string {
  const tankIdx = new Map(m.tanks.map((t, i) => [t.id, i]));
  const valveIdx = new Map(m.valves.map((v, i) => [v.id, i]));
  const flowIdx = new Map(m.flow_sensors.map((f, i) => [f.id, i]));

  const wsIdx = new Map(m.water_sources.map((ws, i) => [ws.id, i]));

  // Build route entries
  const routeLines = m.routes.map((r, i) => {
    const mask = r.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
    const srcTank = r.source_type === "tank" ? tankIdx.get(r.source)! : "0xFF";
    const srcWs = r.source_type === "water_source" ? wsIdx.get(r.source)! : "0xFF";
    const dst = r.destination ? tankIdx.get(r.destination)! : "0xFF";
    const flow = flowIdx.get(r.flow_sensor)!;
    const maskBin = mask.toString(2).padStart(m.valves.length, "0");
    return `  { ${i}, 0b${maskBin}, ${srcTank}, ${srcWs}, ${dst}, ${flow}, ${r.max_runtime_seconds}, "${r.name}" },`;
  });

  // Build valve index comment
  const valveComment = m.valves
    .map((v, i) => `${i}=${v.id}(${v.name})`)
    .join("  ");
  const tankComment = m.tanks
    .map((t, i) => `${i}=${t.id}(${t.name})`)
    .join("  ");
  const wsComment = m.water_sources
    .map((ws, i) => `${i}=${ws.id}(${ws.name})`)
    .join("  ");
  const flowComment = m.flow_sensors
    .map((f, i) => `${i}=${f.id}(${f.name})`)
    .join("  ");

  // Build dispatch functions
  const openCases = m.valves
    .map((v, i) => `    case ${i}: id(${v.id}).make_call().set_command_open().perform(); break;`)
    .join("\n");
  const closeCases = m.valves
    .map((v, i) => `    case ${i}: id(${v.id}).make_call().set_command_close().perform(); break;`)
    .join("\n");
  const tankCases = m.tanks
    .map((t, i) => {
      if (!t.level_pin) return `    case ${i}: return -1.0f; // ${t.id}: no level sensor`;
      return `    case ${i}: return id(${t.id}_level).state;`;
    })
    .join("\n");
  const flowCases = m.flow_sensors
    .map((f, i) => `    case ${i}: return id(${f.id}).state;`)
    .join("\n");

  return `\
// =============================================================================
// MajiFlow — Route Table, Hardware Dispatch & Shared Enums
// =============================================================================
// AUTO-GENERATED from system manifest. Do not edit by hand.
//
// The state machine (control.yaml) is topology-agnostic — it never
// references valve/tank/flow IDs directly. All routing goes through
// the ROUTES[] table and dispatch functions defined here.
//
// Every route has a flow sensor. The safety monitor uses flow-based
// watchdog unconditionally — no watchdog strategy dispatch needed.
// =============================================================================

#pragma once

#include "esphome.h"

// --- Route descriptor -------------------------------------------------------

struct Route {
  uint8_t     id;
  uint16_t    valve_mask;      // bit N = open valve N for this route
  uint8_t     source_tank;     // index into tanks — 0xFF = water source (no level)
  uint8_t     source_ws;       // index into water sources — 0xFF = tank source
  uint8_t     dest_tank;       // index into tanks — 0xFF = endpoint (house/irrigation)
  uint8_t     flow_sensor;     // index into flow sensors (always valid)
  uint16_t    max_runtime_s;   // per-route max runtime in seconds
  const char* name;            // human label for OLED / logs / HA
};

// --- Component counts -------------------------------------------------------

static const int NUM_VALVES        = ${m.valves.length};
static const int NUM_TANKS         = ${m.tanks.length};
static const int NUM_WATER_SOURCES = ${m.water_sources.length};
static const int NUM_FLOW_SENSORS  = ${m.flow_sensors.length};
static const int NUM_ROUTES        = ${m.routes.length};

// --- Fault codes (used by safety monitor → do_fault) -------------------------
static const int FAULT_NONE        = 0;
static const int FAULT_NO_FLOW     = 1;
static const int FAULT_MAX_RUNTIME = 2;
static const int FAULT_API_LOST    = 3;

// --- Stop reasons (persists across runs for HA display) ----------------------
static const int STOP_NONE         = 0;
static const int STOP_MANUAL       = 1;
static const int STOP_TANK_FULL    = 2;
static const int STOP_NO_FLOW      = 3;  // = FAULT_NO_FLOW + 2
static const int STOP_MAX_RUNTIME  = 4;  // = FAULT_MAX_RUNTIME + 2
static const int STOP_API_LOST     = 5;  // = FAULT_API_LOST + 2

// Converts fault_code to stop_reason: stop_reason = fault_code + FAULT_TO_STOP_OFFSET
static const int FAULT_TO_STOP_OFFSET = 2;

// --- Route table ------------------------------------------------------------
//
// Valve indices:   ${valveComment}
// Tank indices:    ${tankComment}
// WSource indices: ${wsComment}
// Flow indices:    ${flowComment}

static const Route ROUTES[NUM_ROUTES] = {
  //  id   valve_mask  src_tank  src_ws  dst   flow  max_rt  name
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
${flowCases}
    default: return -1.0f;
  }
}
`;
}
