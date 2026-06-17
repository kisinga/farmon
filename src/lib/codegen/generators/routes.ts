import type { Manifest } from '@core';
import { nodesByKind, nodesWithFlag, allNodes, pumpSwitchId, routeVolumeEligible, routeSetVersion } from '@core';
import { valveCoverId, valveTravelTimeId, pressureSensorLevelId, flowSensorId, flowTotalId, parseRouteKey } from '@core';
import { generateDeadman } from './deadman';

// ---------------------------------------------------------------------------
// Route context — pure computation, platform-agnostic
// ---------------------------------------------------------------------------

export interface RouteContext {
  manifest: Manifest;
  tanks: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  valves: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  flowSensors: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  waterSources: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  pumps: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  tankIdx: Map<string, number>;
  valveIdx: Map<string, number>;
  flowIdx: Map<string, number>;
  wsIdx: Map<string, number>;
  pumpIdx: Map<string, number>;
  valveTravelMs: number;
  flowWatchdogMs: number;
  flowConfirmMs: number;
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
  const all = allNodes(m);
  const tanks = nodesByKind(all, 'tank');
  const valves = nodesWithFlag(all, 'isValve');
  const flowSensors = nodesWithFlag(all, 'isFlowSensor');
  const waterSources = nodesByKind(all, 'water_source');
  const pumps = nodesWithFlag(all, 'isPump');

  const tankIdx = new Map(tanks.map((t, i) => [t['id'], i]));
  const valveIdx = new Map(valves.map((v, i) => [v['id'], i]));
  const flowIdx = new Map(flowSensors.map((f, i) => [f['id'], i]));
  const wsIdx = new Map(waterSources.map((ws, i) => [ws['id'], i]));
  const pumpIdx = new Map(pumps.map((p, i) => [p['id'], i]));

  // Timing constants
  const valveTravelMs = m.timing.valve_travel_time * 1000;
  const flowWatchdogMs = m.timing.flow_watchdog * 1000;
  const flowConfirmMs = m.timing.flow_confirm * 1000;

  // Compute conflict masks — routes conflict when they share a flow sensor
  // but go to different destinations (ambiguous readings).
  // Same sensor + same destination = safe to run concurrently.
  const destOf = (r: typeof m.routes[number]) => parseRouteKey(r.key).destination;
  const conflictMasks = m.routes.map((r, i) => {
    let mask = 0;
    // Unmonitored routes (no flow sensor) never conflict — there's no
    // ambiguous reading to worry about.
    if (!r.flow_sensor) return mask;
    for (let j = 0; j < m.routes.length; j++) {
      if (i === j) continue;
      if (!m.routes[j].flow_sensor) continue;
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
    const flow = r.flow_sensor !== undefined ? flowIdx.get(r.flow_sensor)! : "0xFF";
    const maskBin = mask.toString(2).padStart(valves.length, "0");
    const conflictBin = conflictMasks[i].toString(2).padStart(m.routes.length, "0");
    const pump = r.crossesPump ? (pumpIdx.get(r.nodeSequence[r.pumpIndex]) ?? "0xFF") : "0xFF";
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
    tanks, valves, flowSensors, waterSources, pumps,
    tankIdx, valveIdx, flowIdx, wsIdx, pumpIdx,
    valveTravelMs, flowWatchdogMs, flowConfirmMs,
    conflictMasks, routeLines,
    valveComment, tankComment, wsComment, flowComment, pumpComment,
  };
}

// ---------------------------------------------------------------------------
// ESPHome-specific emission
// ---------------------------------------------------------------------------

interface ManualPumpRow {
  nodeId: string; relayIdx: number; flowMask: number; srcTank: string; srcMin: number; maxRtMs: number;
}

/**
 * C++ for the manual / claim-driven pump guard (routes.h). A bare claim drives a
 * local pump's relay in pumpMgmt, bypassing the per-route-slot watchdogs; this
 * guards that run (dry-run via the pump's local flow sensors + max-runtime) and
 * latches the pump on a trip so pumpMgmt gates the claim off until release/reset.
 * Reuses check_precheck (source-low) + get_flow_rate + the STOP_* vocabulary.
 */
function buildManualGuard(rows: ManualPumpRow[]): string {
  if (rows.length === 0) {
    return `// --- Manual / claim-driven pump guard (no local pumps) -----------------------
static const int NUM_MANUAL_PUMPS = 0;
inline int  manual_pump_slot(const char*) { return -1; }
inline bool manual_claim_ok(int) { return true; }
inline void manual_clear_latch(int) {}
inline void manual_clear_all_latches() {}
inline int  manual_pump_precheck(int) { return 0; }
inline void manual_pump_guard_tick() {}`;
  }
  const col = (sel: (r: ManualPumpRow) => string | number) => rows.map(sel).join(', ');
  return `// --- Manual / claim-driven pump guard ----------------------------------------
// A bare claim (manual node_set OR a cross-controller peer) drives a local pump
// relay in pumpMgmt, bypassing the per-route-slot watchdogs. This guards that run:
// dry-run (no flow on the pump's local flow sensors after the watchdog) and
// max-runtime. A trip latches the pump → pumpMgmt gates its claim contribution off
// until released / fault_reset. safety_override bypasses pre-check + watchdog.
static const int NUM_MANUAL_PUMPS = ${rows.length};
static const char*    MP_NODE_ID[NUM_MANUAL_PUMPS]   = { ${col((r) => `"${r.nodeId}"`)} };
static const uint8_t  MP_RELAY_IDX[NUM_MANUAL_PUMPS] = { ${col((r) => r.relayIdx)} };
static const uint16_t MP_FLOW_MASK[NUM_MANUAL_PUMPS] = { ${col((r) => `0x${r.flowMask.toString(16)}`)} };
static const uint8_t  MP_SRC_TANK[NUM_MANUAL_PUMPS]  = { ${col((r) => r.srcTank)} };
static const uint8_t  MP_SRC_MIN[NUM_MANUAL_PUMPS]   = { ${col((r) => r.srcMin)} };
static const uint32_t MP_MAX_RT_MS[NUM_MANUAL_PUMPS] = { ${col((r) => `${r.maxRtMs}U`)} };
static int      manual_latch[NUM_MANUAL_PUMPS]     = {0};   // 0 ok, else STOP_* reason
static uint32_t manual_run_since[NUM_MANUAL_PUMPS] = {0};
static uint32_t manual_last_flow[NUM_MANUAL_PUMPS] = {0};

inline int manual_pump_slot(const char* node_id) {
  for (int k = 0; k < NUM_MANUAL_PUMPS; k++)
    if (strcmp(node_id, MP_NODE_ID[k]) == 0) return k;
  return -1;
}
inline bool manual_claim_ok(int k) {
  if (k < 0 || k >= NUM_MANUAL_PUMPS) return true;
  return id(safety_override).state || manual_latch[k] == 0;
}
inline void manual_clear_latch(int k) {
  if (k >= 0 && k < NUM_MANUAL_PUMPS) { manual_latch[k] = 0; manual_run_since[k] = 0; }
}
inline void manual_clear_all_latches() {
  for (int k = 0; k < NUM_MANUAL_PUMPS; k++) manual_clear_latch(k);
}
// NODE_SET pre-check rc: 0 ok, 1 source-low, 2 no local flow sensor (dry-run unprotectable).
inline int manual_pump_precheck(int k) {
  if (k < 0 || k >= NUM_MANUAL_PUMPS) return 0;
  if (id(safety_override).state) return 0;
  if (MP_FLOW_MASK[k] == 0) return 2;
  if (check_precheck(MP_SRC_TANK[k], MP_SRC_MIN[k], 0xFF, 0) == 3) return 1;
  return 0;
}
// 1s tick: guard claim-only pump runs. Latches gate the claim in pumpMgmt; cleared
// when the claim drops (release / lease expiry → !claim_only).
inline void manual_pump_guard_tick() {
  uint32_t now = millis();
  float wd_s = id(flow_watchdog_s).state;
  uint32_t flow_watchdog = (!std::isnan(wd_s) && wd_s >= 5.0f) ? (uint32_t)(wd_s * 1000.0f) : DEFAULT_FLOW_WATCHDOG_MS;
  float th = id(flow_threshold_l_min).state;
  float flow_threshold = (!std::isnan(th) && th >= 0.1f) ? th : DEFAULT_FLOW_THRESHOLD_L_MIN;
  for (int k = 0; k < NUM_MANUAL_PUMPS; k++) {
    bool claim_only = pump_ref_count(MP_RELAY_IDX[k]) == 0 && has_live_claim(MP_NODE_ID[k]);
    if (!claim_only) { manual_run_since[k] = 0; manual_latch[k] = 0; continue; }
    if (id(safety_override).state) { manual_run_since[k] = 0; continue; }
    if (manual_latch[k] != 0) continue;
    if (manual_run_since[k] == 0) { manual_run_since[k] = now; manual_last_flow[k] = now; }
    uint32_t runtime = now - manual_run_since[k];
    if (MP_FLOW_MASK[k]) {
      bool flow = false;
      for (int i = 0; i < NUM_FLOW_SENSORS; i++)
        if (MP_FLOW_MASK[k] & (1 << i)) { float f = get_flow_rate(i); if (!std::isnan(f) && f >= flow_threshold) { flow = true; break; } }
      if (flow) manual_last_flow[k] = now;
      if (runtime > flow_watchdog && now - manual_last_flow[k] > flow_watchdog) { manual_latch[k] = STOP_NO_FLOW; continue; }
    }
    if (runtime > MP_MAX_RT_MS[k]) manual_latch[k] = STOP_MAX_RUNTIME;
  }
}`;
}

export function generateRoutes(m: Manifest): string {
  const ctx = buildRouteContext(m);
  const {
    tanks, valves, flowSensors, waterSources, pumps,
    valveTravelMs, flowWatchdogMs, flowConfirmMs,
    conflictMasks, routeLines,
    valveComment, tankComment, wsComment, flowComment, pumpComment,
  } = ctx;

  // --- Manual / claim-driven pump guard data (local pumps only) ---
  // A bare claim (manual node_set OR a cross-controller peer) drives a LOCAL pump
  // relay in pumpMgmt, bypassing the per-route-slot watchdogs. Bake each local
  // pump's guard context — derived from the route(s) that cross it — so the runtime
  // guard (below) can dry-run / max-runtime protect that run.
  const localFlowIds = new Set(nodesWithFlag(m.nodes, 'isFlowSensor').map((f) => f['id']));
  const localPumps = nodesWithFlag(m.nodes, 'isPump');
  const mpRows = localPumps.map((p) => {
    const routesUsing = m.routes.filter((r) => r.crossesPump && r.nodeSequence[r.pumpIndex] === p['id']);
    // Union of LOCAL primary flow sensors across the pump's routes → bitmask (a
    // remote/imported flow sensor is excluded: its mirror lags, can't dry-run-guard).
    let flowMask = 0;
    for (const r of routesUsing) {
      if (r.flow_sensor && localFlowIds.has(r.flow_sensor)) flowMask |= 1 << ctx.flowIdx.get(r.flow_sensor)!;
    }
    // Source-low only when every route shares ONE source tank with a level reading.
    const srcSet = new Set(routesUsing.filter((r) => r.source_type === 'tank' && r.source_has_level).map((r) => r.source));
    let srcTank = '0xFF';
    let srcMin = 0;
    if (srcSet.size === 1) {
      const t = [...srcSet][0];
      srcTank = String(ctx.tankIdx.get(t)!);
      srcMin = Math.max(0, ...routesUsing.filter((r) => r.source === t).map((r) => r.source_min_pct ?? 0));
    }
    const maxRtS = routesUsing.length ? Math.max(...routesUsing.map((r) => r.max_runtime_seconds)) : 1800;
    return { nodeId: p['id'], relayIdx: ctx.pumpIdx.get(p['id'])!, flowMask, srcTank, srcMin, maxRtMs: maxRtS * 1000 };
  });
  const manualGuardCpp = buildManualGuard(mpRows);

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
  // Map each tank to its level reading. Monitored tanks use their intrinsic
  // pressure sensor; unmonitored tanks return -1.0f.
  const tankCases = tanks
    .map((t, i) => {
      if (t['remoteSourceRef']) {
        return `    case ${i}: return id(ri_${t['id']}).state; // remote: ${t['name']}`;
      }
      if (!t['level_monitored']) return `    case ${i}: return -1.0f; // ${t['id']}: no level monitoring`;
      return `    case ${i}: return id(${pressureSensorLevelId(nid(t))}).state;`;
    })
    .join("\n");
  const flowCases = flowSensors
    .map((f, i) => {
      if (f['remoteSourceRef']) {
        return `    case ${i}: return id(ri_${f['id']}).state; // remote: ${f['name']}`;
      }
      return `    case ${i}: return id(${flowSensorId(nid(f))}).state;`;
    })
    .join("\n");
  // Cumulative volume (L) per flow sensor — the integration total. Remote
  // sensors have no mirrored total, so they return -1.0f and a volume stop on a
  // remote-sourced route never trips (a build rule already steers volume targets
  // to local, unshared sensors).
  const flowTotalCases = flowSensors
    .map((f, i) => {
      if (f['remoteSourceRef']) {
        return `    case ${i}: return -1.0f; // remote: ${f['name']} (no total mirror)`;
      }
      return `    case ${i}: return id(${flowTotalId(nid(f))}).state;`;
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

  // Per-route intent stops (clean completion). Duration applies to any route;
  // volume only to monitored routes (others have no number entity → 0 = off).
  const targetDurationCases = m.routes
    .map((_, i) => `    case ${i}: {
      float v = id(route_${i}_target_duration_s).state;
      return (!std::isnan(v) && v >= 0.0f) ? (uint16_t)v : 0;
    }`)
    .join("\n");

  const targetVolumeCases = m.routes
    .map((r, i) => routeVolumeEligible(r, m.routes)
      ? `    case ${i}: {
      float v = id(route_${i}_target_volume_l).state;
      return (!std::isnan(v) && v >= 0.0f) ? (uint32_t)v : 0;
    }`
      : `    case ${i}: return 0;`)
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

  // Flow-stall full-detection toggle — monitored routes read the HA number
  // (NaN/missing → enabled, the baseline). Unmonitored routes can't stall-detect
  // (no flow sensor) → 0.
  const flowStallCases = m.routes
    .map((r, i) => r.flow_sensor
      ? `    case ${i}: {
      float v = id(route_${i}_flow_stall_enable).state;
      return std::isnan(v) ? 1 : (v >= 0.5f ? 1 : 0);
    }`
      : `    case ${i}: return 0;`)
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

// --- Processed command deduplication -----------------------------------------

static std::map<std::string, uint32_t> processed_commands;

inline void prune_processed_commands(uint32_t now) {
  auto it = processed_commands.begin();
  while (it != processed_commands.end()) {
    if (now - it->second > 300000) {
      it = processed_commands.erase(it);
    } else {
      ++it;
    }
  }
}

inline bool is_duplicate_command(const char* command_id) {
  if (!command_id || command_id[0] == '\0') return false;
  uint32_t now = millis();
  prune_processed_commands(now);
  std::string key(command_id);
  auto it = processed_commands.find(key);
  if (it != processed_commands.end()) return true;
  if (processed_commands.size() >= 64) {
    auto oldest = processed_commands.begin();
    for (auto jt = processed_commands.begin(); jt != processed_commands.end(); ++jt) {
      if (jt->second < oldest->second) oldest = jt;
    }
    processed_commands.erase(oldest);
  }
  processed_commands[key] = now;
  return false;
}

// --- Command outcomes (re-asserted in the snapshot) --------------------------
// The result of each handled command, kept in a small ring and re-published with
// every snapshot so a dropped one isn't lost. The server reconciles the matching
// commands record; the dashboard reads the reason for a refused command.
struct CmdOutcome { char command_id[20]; char result[16]; char reason[16]; };
static const int MAX_OUTCOMES = 4;
static CmdOutcome g_outcomes[MAX_OUTCOMES];
static uint8_t g_outcome_head = 0;

// Escape a string for embedding as a JSON value (quotes/backslashes/control chars).
// Single static buffer — the snapshot builder calls it once per field, immediately,
// on the main loop only. A name with a stray quote would otherwise break the whole
// snapshot's JSON and the server would drop it.
inline const char* json_esc(const char* s) {
  static char out[160];
  int o = 0;
  for (int i = 0; s && s[i] && o < (int) sizeof(out) - 2; i++) {
    char c = s[i];
    if (c == '"' || c == '\\\\') { out[o++] = '\\\\'; out[o++] = c; }
    else if (c >= 0 && c < 0x20) { /* drop control chars */ }
    else out[o++] = c;
  }
  out[o] = '\\0';
  return out;
}

inline void record_outcome(const char* command_id, const char* result, const char* reason) {
  if (!command_id || command_id[0] == '\\0') return;  // automations/local: no command_id to ack
  CmdOutcome& o = g_outcomes[g_outcome_head];
  snprintf(o.command_id, sizeof(o.command_id), "%s", command_id);
  snprintf(o.result, sizeof(o.result), "%s", result ? result : "");
  snprintf(o.reason, sizeof(o.reason), "%s", reason ? reason : "");
  g_outcome_head = (g_outcome_head + 1) % MAX_OUTCOMES;
}

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

// --- Component counts --------------------------------------------------------

static const int NUM_VALVES        = ${valves.length};
static const int NUM_TANKS         = ${tanks.length};
static const int NUM_WATER_SOURCES = ${waterSources.length};
static const int NUM_FLOW_SENSORS  = ${flowSensors.length};
static const int NUM_ROUTES        = ${m.routes.length};

// Stable hash of the ordered route-key list. The runtime automation engine
// refuses any set stamped with a different value (an index could otherwise point
// at the wrong route after a topology change). See automation-wire.ts.
static const uint16_t ROUTE_SET_VERSION = ${routeSetVersion(m)};

// --- Fault codes -------------------------------------------------------------

static const int FAULT_NONE        = 0;
static const int FAULT_NO_FLOW     = 1;
static const int FAULT_MAX_RUNTIME = 2;
static const int FAULT_CONTROL_LOST = 3;  // reserved: local-mode control-link loss (Phase 2)

// --- Stop reasons ------------------------------------------------------------

static const int STOP_NONE         = 0;
static const int STOP_MANUAL       = 1;
static const int STOP_TANK_FULL    = 2;
static const int STOP_NO_FLOW      = 3;
static const int STOP_MAX_RUNTIME  = 4;
static const int STOP_CONTROL_LOST = 5;  // reserved: local-mode control-link loss (Phase 2)
static const int STOP_SOURCE_LOW   = 6;
static const int STOP_VOLUME_REACHED   = 7;  // clean: target volume delivered (intent stop)
static const int STOP_DURATION_REACHED = 8;  // clean: timed run elapsed (intent stop)

static const int FAULT_TO_STOP_OFFSET = 2;

// --- Run-parameter override (sparse overlay) ---------------------------------
// A start may carry a sparse override of the per-route run-params; only the bits
// set in override_mask apply, everything else inherits the route's live tunable.
// One mechanism for the per-route default (mask 0), a manual one-off, and an
// automation. STOPSPEC_INHERIT = "use the route tunables for everything".
static const uint8_t OV_SOURCE_MIN = 1 << 0;
static const uint8_t OV_DEST_MAX   = 1 << 1;
static const uint8_t OV_MAX_RT     = 1 << 2;
static const uint8_t OV_DURATION   = 1 << 3;
static const uint8_t OV_VOLUME     = 1 << 4;

struct StopSpec {
  uint8_t  override_mask;
  uint8_t  ov_source_min_pct;
  uint8_t  ov_dest_max_pct;
  uint16_t ov_max_runtime_min;
  uint16_t ov_target_duration_s;
  uint32_t ov_target_volume_l;
};
static const StopSpec STOPSPEC_INHERIT = {0, 0, 0, 0, 0, 0};

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
  uint32_t flow_active_since;// millis() when current above-threshold flow began
  uint32_t last_flow_time;   // millis() of last flow above configured threshold
  uint32_t stop_time;        // millis() when STOPPING/FAULT began
  int      fault_code;
  int      stop_reason;
  bool     flow_confirmed;
  bool     tank_full_detected;
  float    volume_at_start;  // flow-sensor total (L) snapshot at RUNNING entry; baseline for volume stop
  uint8_t  override_mask;    // sparse run-param override carried from the start (0 = inherit all)
  uint8_t  ov_source_min_pct;
  uint8_t  ov_dest_max_pct;
  uint16_t ov_max_runtime_min;
  uint16_t ov_target_duration_s;
  uint32_t ov_target_volume_l;
};

// Run-origin codes — mirror ORIGIN_TOKENS in codegen-ids.ts (index == value).
static const uint8_t ORIGIN_SYSTEM     = 0;
static const uint8_t ORIGIN_MANUAL     = 1;
static const uint8_t ORIGIN_AUTOMATION = 2;

static RouteSlot slots[MAX_CONCURRENT_ROUTES];

// Per-route attribution that OUTLIVES the slot — who/what is responsible for the
// route's current state. Stamped at each actor-driven transition (the starter at
// activate_slot, the stopper at a manual try_route_stop) and read by the snapshot
// even after the slot is freed at IDLE, so a finished run still reports "by Jane" /
// "Automation: <name>" until the next run rebinds it (per-transition attribution).
// Device-internal stops (level reached, watchdog, fault) do NOT rebind: the run
// stays owned by whoever started it; the reason token explains why it ended.
// Zero-init = ORIGIN_SYSTEM / "" — a route that has never run since boot. Indexed
// by route id (survives slot reuse, which is keyed differently), so the snapshot's
// per-route line is the single source of truth re-asserted every interval.
static uint8_t route_origin[NUM_ROUTES];
static char    route_actor[NUM_ROUTES][16];

inline void bind_route_actor(int route_id, uint8_t origin, const char* actor) {
  if (route_id < 0 || route_id >= NUM_ROUTES) return;
  route_origin[route_id] = origin;
  snprintf(route_actor[route_id], sizeof(route_actor[route_id]), "%s", actor ? actor : "");
}

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
}` : '// No pumps in this controller'}

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

// Union of claims across all slots — the desired open-mask. Correct per valve
// (open if any active route needs it); does NOT verify the combined open-set is
// a coherent flow path. Two independently-valid routes can merge into an
// unintended path; path compatibility is a design-time property, not enforced.
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

// A queued start carries its StopSpec so a deferred run honours the same override
// (volume/duration/etc.) it would have had if a slot were free immediately, plus
// its origin (who/what queued it) so the run is attributed correctly when it drains.
struct QueueEntry { int route_id; StopSpec spec; uint8_t origin; char actor[16]; };
static QueueEntry route_queue[MAX_QUEUE_SIZE];
static int queue_head = 0;
static int queue_count = 0;

inline bool queue_push(int rid, const StopSpec& spec, uint8_t origin = ORIGIN_SYSTEM, const char* actor = "") {
  if (queue_count >= MAX_QUEUE_SIZE) return false;
  QueueEntry& e = route_queue[(queue_head + queue_count) % MAX_QUEUE_SIZE];
  e.route_id = rid;
  e.spec = spec;
  e.origin = origin;
  snprintf(e.actor, sizeof(e.actor), "%s", actor ? actor : "");
  queue_count++;
  return true;
}

inline QueueEntry queue_pop() {
  if (queue_count == 0) return {-1, STOPSPEC_INHERIT, ORIGIN_SYSTEM, ""};
  QueueEntry v = route_queue[queue_head];
  queue_head = (queue_head + 1) % MAX_QUEUE_SIZE;
  queue_count--;
  return v;
}

// Route id at queue position i (for conflict checks), or -1 if out of range.
inline int queue_peek(int i) {
  if (i >= queue_count) return -1;
  return route_queue[(queue_head + i) % MAX_QUEUE_SIZE].route_id;
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

// Cumulative delivered volume (L) per flow sensor — the integration total.
// -1.0f when unavailable (remote sensor / bad idx) so volume-stop callers skip.
inline float get_flow_total(int idx) {
  switch (idx) {
${flowTotalCases}
    default: return -1.0f;
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

// Per-route intent-stop targets (clean completion). 0 = off. Duration is any
// route; volume is monitored-only (0 for the rest).
inline uint16_t get_route_target_duration_s(int route_id) {
  switch (route_id) {
${targetDurationCases}
    default: return 0;
  }
}

inline uint32_t get_route_target_volume_l(int route_id) {
  switch (route_id) {
${targetVolumeCases}
    default: return 0;
  }
}

// Flow-stall full-detection toggle — 1 = a confirmed-then-ceased flow is treated
// as tank-full. 0 = ignore the stall (rely on level / volume / duration / max
// runtime). Does NOT gate the no-flow dry-run fault, which is unconditional.
inline uint8_t get_route_flow_stall_enable(int route_id) {
  switch (route_id) {
${flowStallCases}
    default: return 0;
  }
}

// --- Effective run-params (3-layer cascade) ----------------------------------
// effective = slot override (when its bit is set) else the route's live tunable.
// Inherited fields stay live (operator can retune mid-run); overridden fields are
// fixed for the run. max_runtime override is clamped to the tunable ceiling.
inline uint8_t effective_source_min_pct(int s) {
  return (slots[s].override_mask & OV_SOURCE_MIN) ? slots[s].ov_source_min_pct
                                                  : get_route_source_min_pct(slots[s].route_id);
}
inline uint8_t effective_dest_max_pct(int s) {
  return (slots[s].override_mask & OV_DEST_MAX) ? slots[s].ov_dest_max_pct
                                                : get_route_dest_max_pct(slots[s].route_id);
}
inline uint16_t effective_max_runtime_s(int s) {
  if (!(slots[s].override_mask & OV_MAX_RT)) return get_max_runtime_s(slots[s].route_id);
  // Clamp mirrors the max_runtime tunable bounds in tunable-numbers.ts ([1,120] min).
  uint16_t mins = slots[s].ov_max_runtime_min;
  if (mins < 1) mins = 1;
  if (mins > 120) mins = 120;
  return (uint16_t)(mins * 60);
}
inline uint16_t effective_target_duration_s(int s) {
  return (slots[s].override_mask & OV_DURATION) ? slots[s].ov_target_duration_s
                                                : get_route_target_duration_s(slots[s].route_id);
}
inline uint32_t effective_target_volume_l(int s) {
  return (slots[s].override_mask & OV_VOLUME) ? slots[s].ov_target_volume_l
                                              : get_route_target_volume_l(slots[s].route_id);
}

// --- Pre-start guard (shared by routes + manual pump claims) ------------------
// Value-based so try_route_start and manual_pump_precheck use ONE impl. src_idx/
// dst_idx are tank indices (0xFF = skip); src_min/dst_max are %. safety_override
// bypasses both. Returns 0 ok, 3 source-low, 4 dest-full.
inline int check_precheck(uint8_t src_idx, uint8_t src_min, uint8_t dst_idx, uint8_t dst_max) {
  if (id(safety_override).state) return 0;
  if (src_idx != 0xFF && src_min > 0) {
    float src = get_tank_level(src_idx);
    if (std::isnan(src) || src < (float)src_min) return 3;
  }
  if (dst_idx != 0xFF && dst_max > 0) {
    float dst = get_tank_level(dst_idx);
    if (!std::isnan(dst) && dst > (float)dst_max) return 4;
  }
  return 0;
}

${manualGuardCpp}

// Set a free slot to PREPARING for a route, carrying its run-param override.
// Shared by try_route_start and the queue drain so both honour the same spec and
// origin (who/what started this run).
inline void activate_slot(int slot, int route_id, const StopSpec& spec, uint8_t origin, const char* actor) {
  init_slot(slot);
  slots[slot].route_id            = route_id;
  slots[slot].state               = 1;  // PREPARING
  slots[slot].start_time          = millis();
  slots[slot].override_mask       = spec.override_mask;
  slots[slot].ov_source_min_pct   = spec.ov_source_min_pct;
  slots[slot].ov_dest_max_pct     = spec.ov_dest_max_pct;
  slots[slot].ov_max_runtime_min  = spec.ov_max_runtime_min;
  slots[slot].ov_target_duration_s= spec.ov_target_duration_s;
  slots[slot].ov_target_volume_l  = spec.ov_target_volume_l;
  // The starter owns the route's state until the next transition rebinds it.
  bind_route_actor(route_id, origin, actor);
  // Valves open via the reconciler on the next 1s tick.
}

// --- Route start/stop (shared by API services + button entities) -------------
//
// spec carries an optional sparse run-param override (STOPSPEC_INHERIT = use the
// route tunables). Returns: 0=started, 1=queued, 2=rejected (invalid/duplicate/
// full), 3=rejected (source low), 4=rejected (dest full).
inline int try_route_start(int route_id, const char* command_id, const StopSpec& spec = STOPSPEC_INHERIT,
                           uint8_t origin = ORIGIN_SYSTEM, const char* actor = "") {
  if (route_id < 0 || route_id >= NUM_ROUTES) return 2;
  if (is_duplicate_command(command_id)) return 0;  // idempotent success
  if (find_slot_by_route(route_id) != -1) return 2;  // already active

  if (has_conflict(route_id) || find_free_slot() == -1) {
    return queue_push(route_id, spec, origin, actor) ? 1 : 2;
  }

  // Pre-check with the EFFECTIVE thresholds the override would apply.
  const Route& r = ROUTES[route_id];
  uint8_t eff_src_min = (spec.override_mask & OV_SOURCE_MIN) ? spec.ov_source_min_pct
                                                            : get_route_source_min_pct(route_id);
  uint8_t eff_dst_max = (spec.override_mask & OV_DEST_MAX) ? spec.ov_dest_max_pct
                                                           : get_route_dest_max_pct(route_id);
  int pc = check_precheck(r.source_tank, eff_src_min, r.dest_tank, eff_dst_max);
  if (pc != 0) return pc;

  int slot = find_free_slot();
  activate_slot(slot, route_id, spec, origin, actor);
  if (id(active_slot) == -1) id(active_slot) = slot;
  id(system_state) = derived_system_state();
  return 0;
}

// Returns: 0=stopping, 1=not active, 2=already stopping/idle/faulted
// FAULT (state==4) is rejected — only fault_reset clears a fault, so the
// per-route fault registration isn't silently overwritten by a Stop press.
// origin/actor attribute WHO stopped it (per-transition): the stopper takes over
// ownership of the route's state, so a manual stop of an automation run reports
// the person, not the automation. Defaults to MANUAL for the local-button path.
inline int try_route_stop(int route_id, const char* command_id,
                          uint8_t origin = ORIGIN_MANUAL, const char* actor = "") {
  if (is_duplicate_command(command_id)) return 0;  // idempotent success
  int s = find_slot_by_route(route_id);
  if (s < 0) return 1;
  if (slots[s].state == 0 || slots[s].state == 3 || slots[s].state == 4) return 2;
  slots[s].stop_reason = STOP_MANUAL;
  slots[s].state = 3;  // STOPPING
  slots[s].stop_time = millis();
  bind_route_actor(route_id, origin, actor);
  id(system_state) = derived_system_state();
  return 0;
}
`;
}
