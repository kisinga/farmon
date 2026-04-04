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

static const int NUM_VALVES       = 4;
static const int NUM_TANKS        = 2;
static const int NUM_FLOW_SENSORS = 2;
static const int NUM_ROUTES       = 3;

// --- Route table ------------------------------------------------------------
//
// Valve indices:  0=valve1(Tank 1 Outlet)  1=valve2(Tank 2 Outlet)  2=valve3(Pump to Tank 2)  3=valve4(Pump to House 2)
// Tank indices:   0=tank1(Rain Tank)  1=tank2(Storage Tank)
// Flow indices:   0=flow1(House 1 Water Flow)  1=flow2(House 2 Water Flow)

static const Route ROUTES[NUM_ROUTES] = {
  //  id   valve_mask  src  dst   flow   watchdog       name
  { 0, 0b0101, 0, 1, 0xFF, WD_LEVEL_RISE, "T1>T2" },
  { 1, 0b1001, 0, 0xFF, 1, WD_FLOW, "T1>H2" },
  { 2, 0b1010, 1, 0xFF, 1, WD_FLOW, "T2>H2" },
};

// --- Dispatch functions -----------------------------------------------------

inline void open_valve(int idx) {
  switch (idx) {
    case 0: id(valve1).make_call().set_command_open().perform(); break;
    case 1: id(valve2).make_call().set_command_open().perform(); break;
    case 2: id(valve3).make_call().set_command_open().perform(); break;
    case 3: id(valve4).make_call().set_command_open().perform(); break;
  }
}

inline void close_valve(int idx) {
  switch (idx) {
    case 0: id(valve1).make_call().set_command_close().perform(); break;
    case 1: id(valve2).make_call().set_command_close().perform(); break;
    case 2: id(valve3).make_call().set_command_close().perform(); break;
    case 3: id(valve4).make_call().set_command_close().perform(); break;
  }
}

inline float get_tank_level(int idx) {
  switch (idx) {
    case 0: return id(tank1_level).state;
    case 1: return id(tank2_level).state;
    default: return -1.0f;
  }
}

inline float get_flow_rate(int idx) {
  switch (idx) {
    case 0: return id(flow1).state;
    case 1: return id(flow2).state;
    default: return -1.0f;
  }
}
