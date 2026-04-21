import type { Manifest, ManifestNode } from "../schema.js";
import { nodesByKind, nodesWithFlag } from "../schema.js";
import { valveCoverId, valveTravelMsId, levelSensorLevelId, flowSensorId } from '@far-mon/core';

/** Parse an ESPHome duration string like "15s" or "2000ms" to milliseconds. */
export function parseDurationMs(s: string): number {
  const ms = s.match(/^(\d+)\s*ms$/);
  if (ms) return parseInt(ms[1], 10);
  const sec = s.match(/^(\d+)\s*s$/);
  if (sec) return parseInt(sec[1], 10) * 1000;
  return 15000; // fallback
}

export function generateRoutes(m: Manifest): string {
  const tanks = nodesByKind(m.nodes, 'tank');
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const valves = nodesWithFlag(m.nodes, 'isValve');
  const flowSensors = nodesWithFlag(m.nodes, 'isFlowSensor');
  const waterSources = nodesByKind(m.nodes, 'water_source');

  const tankIdx = new Map(tanks.map((t, i) => [t['id'], i]));
  const valveIdx = new Map(valves.map((v, i) => [v['id'], i]));
  const flowIdx = new Map(flowSensors.map((f, i) => [f['id'], i]));
  const wsIdx = new Map(waterSources.map((ws, i) => [ws['id'], i]));

  // Timing constants
  const valveTravelMs = m.timing.valve_travel_time * 1000;

  // Compute conflict masks — routes conflict when they share a flow sensor
  // but go to different destinations (ambiguous readings).
  // Same sensor + same destination = safe to run concurrently.
  const destOf = (r: typeof m.routes[number]) => r.key.split('>')[1];
  const conflictMasks = m.routes.map((r, i) => {
    let mask = 0;
    for (let j = 0; j < m.routes.length; j++) {
      if (i === j) continue;
      if (r.flow_sensor === m.routes[j].flow_sensor && destOf(r) !== destOf(m.routes[j])) {
        mask |= (1 << j);
      }
    }
    return mask;
  });

  // Build route entries
  const routeLines = m.routes.map((r, i) => {
    const mask = r.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
    const srcTank = r.source_type === "tank" ? tankIdx.get(r.source)! : "0xFF";
    const srcWs = r.source_type === "water_source" ? wsIdx.get(r.source)! : "0xFF";
    const dst = r.destination ? tankIdx.get(r.destination)! : "0xFF";
    const flow = flowIdx.get(r.flow_sensor)!;
    const maskBin = mask.toString(2).padStart(valves.length, "0");
    const conflictBin = conflictMasks[i].toString(2).padStart(m.routes.length, "0");
    const pump = r.needs_pump ? "true" : "false";
    const srcMin = r.source_min_pct ?? 0;
    const dstMax = r.dest_max_pct ?? 0;
    const rtLvl = r.runtime_level_ok ? "true" : "false";
    return `  { ${i}, 0b${maskBin}, ${srcTank}, ${srcWs}, ${dst}, ${flow}, 0b${conflictBin}, ${r.max_runtime_seconds}, ${pump}, ${srcMin}, ${dstMax}, ${rtLvl}, "${r.name}" },`;
  });

  // Build index comments
  const valveComment = valves.map((v, i) => `${i}=${v['id']}(${v['name']})`).join("  ");
  const tankComment = tanks.map((t, i) => `${i}=${t['id']}(${t['name']})`).join("  ");
  const wsComment = waterSources.map((ws, i) => `${i}=${ws['id']}(${ws['name']})`).join("  ");
  const flowComment = flowSensors.map((f, i) => `${i}=${f['id']}(${f['name']})`).join("  ");

  // Build dispatch functions (hardware-level, renamed with _hw suffix)
  const nid = (node: Record<string, any>) => ({ id: String(node['id']) });
  const openCases = valves
    .map((v, i) => `    case ${i}: id(${valveCoverId(nid(v))}).make_call().set_command_open().perform(); break;`)
    .join("\n");
  const closeCases = valves
    .map((v, i) => `    case ${i}: id(${valveCoverId(nid(v))}).make_call().set_command_close().perform(); break;`)
    .join("\n");
  // Map each tank to its associated level_sensor (set by topology-to-manifest)
  const tankCases = tanks
    .map((t, i) => {
      const lsId = t['level_sensor'] as string | undefined;
      if (!lsId) return `    case ${i}: return -1.0f; // ${t['id']}: no level sensor`;
      const ls = levelSensors.find(s => s['id'] === lsId);
      if (!ls) return `    case ${i}: return -1.0f; // ${t['id']}: level sensor ${lsId} not found`;
      return `    case ${i}: return id(${levelSensorLevelId(nid(ls))}).state;`;
    })
    .join("\n");
  const flowCases = flowSensors
    .map((f, i) => `    case ${i}: return id(${flowSensorId(nid(f))}).state;`)
    .join("\n");

  const runtimeCases = m.routes
    .map((_, i) => `    case ${i}: return (uint16_t)id(route_${i}_max_runtime).state;`)
    .join("\n");

  const valveTravelCases = valves
    .map((v, i) => `    case ${i}: return (uint32_t)id(${valveTravelMsId(nid(v))}).state;`)
    .join("\n");

  return `\
// =============================================================================
// MajiFlow — Route Table, Slot Management & Hardware Dispatch
// =============================================================================
// AUTO-GENERATED from system manifest. Do not edit by hand.
//
// This header provides:
//   1. Route table (ROUTES[]) — static, topology-derived
//   2. RouteSlot[] — per-slot state for concurrent execution
//   3. Queue — circular buffer for deferred route starts
//   4. Helpers — slot management, conflict detection, pump refcount
//   5. Hardware dispatch — valve/tank/flow access by index
//
// The control layer (control.yaml) is topology-agnostic — it never
// references valve/tank/flow IDs directly. All routing goes through
// these structures and dispatch functions.
// =============================================================================

#pragma once

#include "esphome.h"
#include <cstring>

// --- Constants ---------------------------------------------------------------

static const int MAX_CONCURRENT_ROUTES = 2;
static const int MAX_QUEUE_SIZE        = 4;
static const uint32_t DEPRESSURIZE_MS  = 2000;

// --- Component counts --------------------------------------------------------

static const int NUM_VALVES        = ${valves.length};
static const int NUM_TANKS         = ${tanks.length};
static const int NUM_WATER_SOURCES = ${waterSources.length};
static const int NUM_FLOW_SENSORS  = ${flowSensors.length};
static const int NUM_ROUTES        = ${m.routes.length};

// --- Fault codes -------------------------------------------------------------

static const int FAULT_NONE        = 0;
static const int FAULT_NO_FLOW     = 1;
static const int FAULT_MAX_RUNTIME = 2;
static const int FAULT_API_LOST    = 3;

// --- Stop reasons ------------------------------------------------------------

static const int STOP_NONE         = 0;
static const int STOP_MANUAL       = 1;
static const int STOP_TANK_FULL    = 2;
static const int STOP_NO_FLOW      = 3;
static const int STOP_MAX_RUNTIME  = 4;
static const int STOP_API_LOST     = 5;
static const int STOP_SOURCE_LOW   = 6;

static const int FAULT_TO_STOP_OFFSET = 2;

// --- Route descriptor --------------------------------------------------------

struct Route {
  uint8_t     id;
  uint16_t    valve_mask;
  uint8_t     source_tank;     // index into tanks — 0xFF = water source
  uint8_t     source_ws;       // index into water sources — 0xFF = tank source
  uint8_t     dest_tank;       // index into tanks — 0xFF = endpoint
  uint8_t     flow_sensor;     // index into flow sensors (always valid)
  uint16_t    conflict_mask;   // bitmask of route IDs that cannot run concurrently
                               // (shared sensor + different destination = ambiguous reading)
  uint16_t    max_runtime_s;
  bool        needs_pump;      // true if route path crosses the pump node
  uint8_t     source_min_pct;  // pre-start: reject if source tank below this %. 0 = no check.
  uint8_t     dest_max_pct;    // pre-start: reject if dest tank above this %. 0 = no check.
  bool        runtime_level_ok; // true if tank sensors are reliable during pump operation
  const char* name;
};

// --- Route table -------------------------------------------------------------
//
// Valve indices:   ${valveComment}
// Tank indices:    ${tankComment}
// WSource indices: ${wsComment}
// Flow indices:    ${flowComment}

static const Route ROUTES[NUM_ROUTES] = {
  //  id   valve_mask  src_tank  src_ws  dst   flow  conflict  max_rt  pump  name
${routeLines.join("\n")}
};

// --- Route slot (per concurrent execution) -----------------------------------

struct RouteSlot {
  int      route_id;         // -1 = empty
  int      state;            // 0=IDLE 1=PREPARING 2=RUNNING 3=STOPPING 4=FAULT
  uint32_t start_time;       // millis() when PREPARING began
  uint32_t run_start_time;   // millis() when RUNNING began (for watchdogs)
  uint32_t last_flow_time;   // millis() of last flow > 0.5 L/min
  uint32_t stop_time;        // millis() when STOPPING/FAULT began
  int      fault_code;
  int      stop_reason;
  bool     flow_confirmed;
  bool     tank_full_detected;
  bool     valves_closing;   // true after depressurize, close commands issued
};

static RouteSlot slots[MAX_CONCURRENT_ROUTES];

// --- Slot helpers ------------------------------------------------------------

inline void init_slot(int s) {
  memset(&slots[s], 0, sizeof(RouteSlot));
  slots[s].route_id = -1;
}

inline int find_free_slot() {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (slots[i].state == 0) return i;
  return -1;
}

inline int find_slot_by_route(int rid) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (slots[i].route_id == rid) return i;
  return -1;
}

// --- Conflict detection ------------------------------------------------------
//
// Actuators (valves, pump) can be shared — multiple routes may need them ON.
// Sensors (flow) cannot — readings are ambiguous when shared.
// Concurrency is gated on sensor conflicts only; actuators are refcounted.

// Returns bitmask of valves used by PREPARING or RUNNING slots.
inline uint16_t active_valve_mask() {
  uint16_t mask = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if ((slots[i].state == 1 || slots[i].state == 2) && slots[i].route_id >= 0)
      mask |= ROUTES[slots[i].route_id].valve_mask;
  return mask;
}

// Valves safe to close for a stopping slot — excludes valves still needed
// by other PREPARING/RUNNING slots (actuator refcounting).
inline uint16_t safe_close_mask(int stopping_slot) {
  uint16_t other = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (i != stopping_slot && (slots[i].state == 1 || slots[i].state == 2) && slots[i].route_id >= 0)
      other |= ROUTES[slots[i].route_id].valve_mask;
  return ROUTES[slots[stopping_slot].route_id].valve_mask & ~other;
}

// True if any PREPARING/RUNNING slot conflicts with route rid.
// Conflict = shared sensor + different destination (computed at codegen time).
inline bool has_conflict(int rid) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if ((slots[i].state == 1 || slots[i].state == 2) && slots[i].route_id >= 0)
      if (ROUTES[rid].conflict_mask & (1 << slots[i].route_id)) return true;
  return false;
}

// --- Pump reference counting -------------------------------------------------

// Count of RUNNING slots whose route needs the pump.
inline int pump_ref_count() {
  int c = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (slots[i].state == 2 && slots[i].route_id >= 0 && ROUTES[slots[i].route_id].needs_pump)
      c++;
  return c;
}

// --- Derived system state ----------------------------------------------------

// Highest-priority state across all slots. FAULT(4) wins, then STOPPING, etc.
inline int derived_system_state() {
  int h = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) {
    if (slots[i].state == 4) return 4;
    if (slots[i].state > h) h = slots[i].state;
  }
  return h;
}

// --- Queue (circular buffer) -------------------------------------------------

static int route_queue[MAX_QUEUE_SIZE];
static int queue_head = 0;
static int queue_count = 0;

inline bool queue_push(int rid) {
  if (queue_count >= MAX_QUEUE_SIZE) return false;
  route_queue[(queue_head + queue_count) % MAX_QUEUE_SIZE] = rid;
  queue_count++;
  return true;
}

inline int queue_pop() {
  if (queue_count == 0) return -1;
  int v = route_queue[queue_head];
  queue_head = (queue_head + 1) % MAX_QUEUE_SIZE;
  queue_count--;
  return v;
}

inline int queue_peek(int i) {
  if (i >= queue_count) return -1;
  return route_queue[(queue_head + i) % MAX_QUEUE_SIZE];
}

// --- Hardware dispatch -------------------------------------------------------

inline void open_valve_hw(int idx) {
  switch (idx) {
${openCases}
  }
}

inline void close_valve_hw(int idx) {
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

// Max runtime — reads from HA number entities (adjustable, persisted).
// Falls back to 1800s if route_id is out of range.
inline uint16_t get_max_runtime_s(int route_id) {
  switch (route_id) {
${runtimeCases}
    default: return 1800;
  }
}

// Per-valve travel time — reads from HA number entities (adjustable, persisted).
inline uint32_t get_valve_travel_ms(int idx) {
  switch (idx) {
${valveTravelCases}
    default: return 15000;
  }
}

// Route travel time — max across all valves in the route's valve_mask.
inline uint32_t get_route_travel_ms(int route_id) {
  uint32_t mx = 0;
  uint16_t mask = ROUTES[route_id].valve_mask;
  for (int i = 0; i < NUM_VALVES; i++) {
    if (mask & (1 << i)) {
      uint32_t t = get_valve_travel_ms(i);
      if (t > mx) mx = t;
    }
  }
  return mx;
}

// --- Route start/stop (shared by API services + button entities) -------------
//
// Returns: 0=started, 1=queued, 2=rejected (invalid/duplicate/full),
//          3=rejected (source low), 4=rejected (dest full)
inline int try_route_start(int route_id) {
  if (route_id < 0 || route_id >= NUM_ROUTES) return 2;
  if (find_slot_by_route(route_id) != -1) return 2;  // already active

  if (has_conflict(route_id) || find_free_slot() == -1) {
    return queue_push(route_id) ? 1 : 2;
  }

  const Route& r = ROUTES[route_id];
  if (r.source_tank != 0xFF && r.source_min_pct > 0) {
    float src = get_tank_level(r.source_tank);
    if (!id(safety_override).state && (std::isnan(src) || src < (float)r.source_min_pct)) return 3;
  }
  if (r.dest_tank != 0xFF && r.dest_max_pct > 0) {
    float dst = get_tank_level(r.dest_tank);
    if (!id(safety_override).state && !std::isnan(dst) && dst > (float)r.dest_max_pct) return 4;
  }

  int slot = find_free_slot();
  init_slot(slot);
  slots[slot].route_id = route_id;
  slots[slot].state = 1;  // PREPARING
  slots[slot].start_time = millis();
  for (int i = 0; i < NUM_VALVES; i++)
    if (r.valve_mask & (1 << i)) open_valve_hw(i);
  if (id(active_slot) == -1) id(active_slot) = slot;
  id(system_state) = derived_system_state();
  return 0;
}

// Returns: 0=stopping, 1=not active, 2=already stopping/idle
inline int try_route_stop(int route_id) {
  int s = find_slot_by_route(route_id);
  if (s < 0) return 1;
  if (slots[s].state == 0 || slots[s].state == 3) return 2;
  slots[s].stop_reason = STOP_MANUAL;
  slots[s].state = 3;  // STOPPING
  slots[s].stop_time = millis();
  slots[s].valves_closing = false;
  id(system_state) = derived_system_state();
  return 0;
}
`;
}
