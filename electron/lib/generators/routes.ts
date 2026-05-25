import type { Manifest } from "../schema.js";
import { nodesByKind, nodesWithFlag, pumpSwitchId } from "../schema.js";
import { valveCoverId, valveTravelTimeId, levelSensorLevelId, pressureSensorLevelId, flowSensorId, parseRouteKey } from '@far-mon/core';
import { generateDeadman } from './deadman.js';

// ---------------------------------------------------------------------------
// Route context — pure computation, platform-agnostic
// ---------------------------------------------------------------------------

export interface RouteContext {
  manifest: Manifest;
  tanks: Manifest['nodes'];
  levelSensors: Manifest['nodes'];
  pressureSensors: Manifest['nodes'];
  valves: Manifest['nodes'];
  flowSensors: Manifest['nodes'];
  waterSources: Manifest['nodes'];
  pumps: Manifest['nodes'];
  tankIdx: Map<string, number>;
  valveIdx: Map<string, number>;
  flowIdx: Map<string, number>;
  wsIdx: Map<string, number>;
  pumpIdx: Map<string, number>;
  valveTravelMs: number;
  flowWatchdogMs: number;
  flowConfirmMs: number;
  apiWatchdogMs: number;
  conflictMasks: number[];
  routeLines: string[];
  valveComment: string;
  tankComment: string;
  wsComment: string;
  flowComment: string;
  pumpComment: string;
}

/**
 * Build a RouteContext from a manifest.
 * Pure function — all index computation, conflict masks, and route table
 * formatting lives here. Platform-specific emission is separate.
 */
export function buildRouteContext(m: Manifest): RouteContext {
  const tanks = nodesByKind(m.nodes, 'tank');
  const levelSensors = nodesWithFlag(m.nodes, 'isLevelSensor');
  const pressureSensors = nodesWithFlag(m.nodes, 'isPressureSensor');
  const valves = nodesWithFlag(m.nodes, 'isValve');
  const flowSensors = nodesWithFlag(m.nodes, 'isFlowSensor');
  const waterSources = nodesByKind(m.nodes, 'water_source');
  const pumps = nodesWithFlag(m.nodes, 'isPump');

  const tankIdx = new Map(tanks.map((t, i) => [t['id'], i]));
  const valveIdx = new Map(valves.map((v, i) => [v['id'], i]));
  const flowIdx = new Map(flowSensors.map((f, i) => [f['id'], i]));
  const wsIdx = new Map(waterSources.map((ws, i) => [ws['id'], i]));
  const pumpIdx = new Map(pumps.map((p, i) => [p['id'], i]));

  // Timing constants
  const valveTravelMs = m.timing.valve_travel_time * 1000;
  const flowWatchdogMs = m.timing.flow_watchdog * 1000;
  const flowConfirmMs = m.timing.flow_confirm * 1000;
  const apiWatchdogMs = m.timing.api_watchdog * 1000;

  // Compute conflict masks — routes conflict when they share a flow sensor
  // but go to different destinations (ambiguous readings).
  // Same sensor + same destination = safe to run concurrently.
  const destOf = (r: typeof m.routes[number]) => parseRouteKey(r.key).destination;
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
    const pump = r.crossesPump ? pumpIdx.get(r.nodeSequence[r.pumpIndex])! : "0xFF";
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
  const pumpComment = pumps.map((p, i) => `${i}=${p['id']}(${p['name']})`).join("  ");

  return {
    manifest: m,
    tanks, levelSensors, pressureSensors, valves, flowSensors, waterSources, pumps,
    tankIdx, valveIdx, flowIdx, wsIdx, pumpIdx,
    valveTravelMs, flowWatchdogMs, flowConfirmMs, apiWatchdogMs,
    conflictMasks, routeLines,
    valveComment, tankComment, wsComment, flowComment, pumpComment,
  };
}

// ---------------------------------------------------------------------------
// ESPHome-specific emission
// ---------------------------------------------------------------------------

export function generateRoutes(m: Manifest): string {
  const ctx = buildRouteContext(m);
  const {
    tanks, levelSensors, pressureSensors, valves, flowSensors, waterSources, pumps,
    valveTravelMs, flowWatchdogMs, flowConfirmMs, apiWatchdogMs,
    conflictMasks, routeLines,
    valveComment, tankComment, wsComment, flowComment, pumpComment,
  } = ctx;

  // Build dispatch functions (hardware-level, renamed with _hw suffix)
  const nid = (node: Manifest['nodes'][number]) => ({ id: node.id });
  const openCases = valves
    .map((v, i) => `    case ${i}: id(${valveCoverId(nid(v))}).make_call().set_command_open().perform(); break;`)
    .join("\n");
  const closeCases = valves
    .map((v, i) => `    case ${i}: id(${valveCoverId(nid(v))}).make_call().set_command_close().perform(); break;`)
    .join("\n");
  const stopCases = valves
    .map((v, i) => `    case ${i}: id(${valveCoverId(nid(v))}).make_call().set_command_stop().perform(); break;`)
    .join("\n");
  // Map each tank to its associated level source (set by topology-to-manifest).
  // Source may be a level_sensor (direct %) or a pressure_sensor (% derived
  // from pressure-vs-calibration). Dispatch on kind to the right codegen ID.
  const tankCases = tanks
    .map((t, i) => {
      if (t['remoteHaEntityId']) {
        return `    case ${i}: return id(ri_${t['id']}).state; // remote: ${t['name']}`;
      }
      const src = t['level_source'] as { id: string; kind: 'level_sensor' | 'pressure_sensor' } | undefined;
      if (!src) return `    case ${i}: return -1.0f; // ${t['id']}: no level source`;
      if (src.kind === 'level_sensor') {
        const ls = levelSensors.find(s => s['id'] === src.id);
        if (!ls) return `    case ${i}: return -1.0f; // ${t['id']}: level_sensor ${src.id} not found`;
        return `    case ${i}: return id(${levelSensorLevelId(nid(ls))}).state;`;
      }
      const ps = pressureSensors.find(s => s['id'] === src.id);
      if (!ps) return `    case ${i}: return -1.0f; // ${t['id']}: pressure_sensor ${src.id} not found`;
      return `    case ${i}: return id(${pressureSensorLevelId(nid(ps))}).state;`;
    })
    .join("\n");
  const flowCases = flowSensors
    .map((f, i) => {
      if (f['remoteHaEntityId']) {
        return `    case ${i}: return id(ri_${f['id']}).state; // remote: ${f['name']}`;
      }
      return `    case ${i}: return id(${flowSensorId(nid(f))}).state;`;
    })
    .join("\n");

  // Route max-runtime is operator-facing in minutes; convert to seconds for
  // the firmware control loop. Bound check in minutes — anything below 1 min
  // falls back to the manifest-baked seconds default.
  const runtimeCases = m.routes
    .map((_, i) => `    case ${i}: {
      float v = id(route_${i}_max_runtime).state;
      return (!std::isnan(v) && v >= 1.0f) ? (uint16_t)(v * 60.0f) : ROUTES[${i}].max_runtime_s;
    }`)
    .join("\n");

  // Pre-start safety thresholds — read from HA tunables when present, fall
  // back to the manifest-baked Route struct value otherwise.
  const sourceMinCases = m.routes
    .map((r, i) => r.source_has_level
      ? `    case ${i}: {
      float v = id(route_${i}_source_min_pct).state;
      return (!std::isnan(v) && v >= 0.0f && v <= 100.0f) ? (uint8_t)v : ROUTES[${i}].source_min_pct;
    }`
      : `    case ${i}: return ROUTES[${i}].source_min_pct;`)
    .join("\n");

  const destMaxCases = m.routes
    .map((r, i) => r.dest_has_level
      ? `    case ${i}: {
      float v = id(route_${i}_dest_max_pct).state;
      return (!std::isnan(v) && v >= 0.0f && v <= 100.0f) ? (uint8_t)v : ROUTES[${i}].dest_max_pct;
    }`
      : `    case ${i}: return ROUTES[${i}].dest_max_pct;`)
    .join("\n");

  // Valve travel time is operator-facing in seconds; convert to ms for the
  // ESPHome time-based cover. Bound check in seconds — anything below 1 s
  // falls back to the firmware default (already in ms).
  const valveTravelCases = valves
    .map((v, i) => `    case ${i}: {
      float v = id(${valveTravelTimeId(nid(v))}).state;
      return (!std::isnan(v) && v >= 1.0f) ? (uint32_t)(v * 1000.0f) : DEFAULT_VALVE_TRAVEL_MS;
    }`)
    .join("\n");

  return `\
// =============================================================================
// MajiFlow — Route Table, Slot Management & Hardware Dispatch
// =============================================================================
// AUTO-GENERATED from system manifest. Do not edit by hand.
//
// This header provides:
//   1. Dead-man claim registry (anchor mesh safety)
//   2. Route table (ROUTES[]) — static, topology-derived
//   3. RouteSlot[] — per-slot state for concurrent execution
//   4. Queue — circular buffer for deferred route starts
//   5. Helpers — slot management, conflict detection, pump refcount
//   6. Hardware dispatch — valve/tank/flow access by index
//
// The control layer (control.yaml) is topology-agnostic — it never
// references valve/tank/flow IDs directly. All routing goes through
// these structures and dispatch functions.
// =============================================================================

#pragma once

#include "esphome.h"
#include <cstring>

${generateDeadman(m)}

// --- Constants ---------------------------------------------------------------

static const int MAX_CONCURRENT_ROUTES = 2;
static const int MAX_QUEUE_SIZE        = 4;
static const uint32_t DEPRESSURIZE_MS  = 2000;

// Manifest-derived firmware defaults. HA number entities are editable and
// persisted, but these constants remain the boot-safe source of truth whenever
// an editable number has not published a sane state yet.
static const uint32_t DEFAULT_VALVE_TRAVEL_MS        = ${valveTravelMs}U;
static const uint32_t DEFAULT_FLOW_WATCHDOG_MS       = ${flowWatchdogMs}U;
static const uint32_t DEFAULT_FLOW_CONFIRM_MS        = ${flowConfirmMs}U;
static const float    DEFAULT_FLOW_THRESHOLD_L_MIN   = ${m.timing.flow_threshold};
static const uint32_t DEFAULT_API_WATCHDOG_MS        = ${apiWatchdogMs}U;

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
  uint8_t     pump_idx;        // index into PUMP_IDS — 0xFF = no pump
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
  //  id   valve_mask  src_tank  src_ws  dst   flow  conflict  max_rt  pump_idx  name
${routeLines.join("\n")}
};

// --- Route slot (per concurrent execution) -----------------------------------

struct RouteSlot {
  int      route_id;         // -1 = empty
  int      state;            // 0=IDLE 1=PREPARING 2=RUNNING 3=STOPPING 4=FAULT
  uint32_t start_time;       // millis() when PREPARING began
  uint32_t run_start_time;   // millis() when RUNNING began (for watchdogs)
  uint32_t api_lost_since;   // millis() when this RUNNING slot first had zero API clients
  uint32_t flow_active_since;// millis() when current above-threshold flow began
  uint32_t last_flow_time;   // millis() of last flow above configured threshold
  uint32_t stop_time;        // millis() when STOPPING/FAULT began
  int      fault_code;
  int      stop_reason;
  bool     flow_confirmed;
  bool     tank_full_detected;
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
// Concurrency is gated on sensor conflicts only; actuators are refcounted
// implicitly via the level-triggered valve reconciler below.

// True if any PREPARING/RUNNING slot conflicts with route rid.
// Conflict = shared sensor + different destination (computed at codegen time).
inline bool has_conflict(int rid) {
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if ((slots[i].state == 1 || slots[i].state == 2) && slots[i].route_id >= 0)
      if (ROUTES[rid].conflict_mask & (1 << slots[i].route_id)) return true;
  return false;
}

// --- Pump reference counting -------------------------------------------------

${pumps.length > 0 ? `static const char* PUMP_IDS[${pumps.length}] = {
${pumps.map(p => `  "${p['id']}_relay"`).join(',\n')}
};

inline int pump_index_for_id(const std::string& id) {
  for (int i = 0; i < ${pumps.length}; i++)
    if (std::string(PUMP_IDS[i]) == id) return i;
  return -1;
}

// Count of RUNNING slots whose route needs a specific pump.
inline int pump_ref_count(uint8_t pump_idx) {
  int c = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++)
    if (slots[i].state == 2 && slots[i].route_id >= 0 && ROUTES[slots[i].route_id].pump_idx == pump_idx)
      c++;
  return c;
}` : '// No pumps in this controller'}}

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

// --- Valve reconciliation ----------------------------------------------------
//
// Valves are level-triggered: every 1s tick the reconciler computes which
// valves should be open (from active slots) and emits commands for any that
// disagree with what was last commanded. Replaces the previous edge-driven
// open-on-start / close-on-stop model.
//
// The invariant: valve i is open iff some slot is "claiming" it. A slot
// claims its valve_mask while PREPARING/RUNNING, and during the depressurize
// window after entering STOPPING/FAULT.

// Forward declarations — definitions below in "Hardware dispatch".
inline void open_valve_hw(int idx);
inline void close_valve_hw(int idx);

// Bit i = "we last told valve i to be open". Updated only by reconcile_valves
// and at boot. Stays a faithful proxy for ESPHome's cover state as long as
// nothing else drives the covers.
static uint16_t commanded_valve_mask = 0;

// Valves slot s is claiming right now (open during depressurize, dropped after).
inline uint16_t valve_claim_mask(int s) {
  if (slots[s].route_id < 0) return 0;
  int st = slots[s].state;
  if (st == 1 || st == 2) return ROUTES[slots[s].route_id].valve_mask;
  if (st == 3 || st == 4) {
    if ((millis() - slots[s].stop_time) < DEPRESSURIZE_MS)
      return ROUTES[slots[s].route_id].valve_mask;
  }
  return 0;
}

// Union of claims across all slots — the desired open-mask.
inline uint16_t desired_valve_mask() {
  uint16_t m = 0;
  for (int i = 0; i < MAX_CONCURRENT_ROUTES; i++) m |= valve_claim_mask(i);
  for (int i = 0; i < NUM_VALVES; i++) {
    if (has_live_claim(valve_id_for_index(i))) m |= (1 << i);
  }
  return m;
}

// Diff vs commanded; emit cover commands only for valves whose desired state
// changed. No periodic reissue — steady state is silent.
inline void reconcile_valves() {
  uint16_t desired = desired_valve_mask();
  uint16_t diff = desired ^ commanded_valve_mask;
  if (!diff) return;
  for (int i = 0; i < NUM_VALVES; i++) {
    if (!(diff & (1 << i))) continue;
    if (desired & (1 << i)) open_valve_hw(i);
    else close_valve_hw(i);
  }
  commanded_valve_mask = desired;
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

// cover.stop_cover for valve idx. Used to force-resync ESPHome's internal
// position estimate when a slot enters FAULT — without this, a subsequent
// close call may be filtered as a no-op if the cover already thinks it's closed.
inline void stop_valve_hw(int idx) {
  switch (idx) {
${stopCases}
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

// Source-min and dest-max thresholds — read from HA number entities (adjustable,
// persisted) for routes whose tank endpoint has a level reading. Routes without
// a level reading fall back to the manifest-baked Route struct value (typically
// 0 = "skip this check"). 0 disables the corresponding pre-start guard.
inline uint8_t get_route_source_min_pct(int route_id) {
  switch (route_id) {
${sourceMinCases}
    default: return 0;
  }
}

inline uint8_t get_route_dest_max_pct(int route_id) {
  switch (route_id) {
${destMaxCases}
    default: return 0;
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

// --- Actuator stop (dead-man enforcement) ------------------------------------

inline void stop_actuator(const std::string& nodeId) {
${pumps.map(p => `  if (nodeId == "${p['id']}_relay") { id(${p['id']}_relay).turn_off(); return; }`).join('\n')}
${valves.map((v, i) => `  if (nodeId == "${v['id']}") { close_valve_hw(${i}); return; }`).join('\n')}
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

  uint8_t src_min = get_route_source_min_pct(route_id);
  uint8_t dst_max = get_route_dest_max_pct(route_id);
  const Route& r = ROUTES[route_id];
  if (r.source_tank != 0xFF && src_min > 0) {
    float src = get_tank_level(r.source_tank);
    if (!id(safety_override).state && (std::isnan(src) || src < (float)src_min)) return 3;
  }
  if (r.dest_tank != 0xFF && dst_max > 0) {
    float dst = get_tank_level(r.dest_tank);
    if (!id(safety_override).state && !std::isnan(dst) && dst > (float)dst_max) return 4;
  }

  int slot = find_free_slot();
  init_slot(slot);
  slots[slot].route_id = route_id;
  slots[slot].state = 1;  // PREPARING
  slots[slot].start_time = millis();
  // Valves open via the reconciler on the next 1s tick.
  if (id(active_slot) == -1) id(active_slot) = slot;
  id(system_state) = derived_system_state();
  return 0;
}

// Returns: 0=stopping, 1=not active, 2=already stopping/idle/faulted
// FAULT (state==4) is rejected — only fault_reset clears a fault, so the
// per-route fault registration isn't silently overwritten by a Stop press.
inline int try_route_stop(int route_id) {
  int s = find_slot_by_route(route_id);
  if (s < 0) return 1;
  if (slots[s].state == 0 || slots[s].state == 3 || slots[s].state == 4) return 2;
  slots[s].stop_reason = STOP_MANUAL;
  slots[s].state = 3;  // STOPPING
  slots[s].stop_time = millis();
  id(system_state) = derived_system_state();
  return 0;
}
`;
}
