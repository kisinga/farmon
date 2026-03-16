/**
 * Step 1: Create device profiles.
 *
 * - FarMon Water Monitor v1 and SenseCAP S2105 are auto-seeded by the backend.
 * - This script creates the "Solar Farm Monitor v1" profile with all sub-components.
 *
 * Idempotent: skips if profile already exists.
 */
import PocketBase from "pocketbase";
import { PB_URL, PROFILE_SOLAR_FARM, authPb, step, ok, info, err } from "./config.js";

const pb = new PocketBase(PB_URL);

async function findProfile(name: string) {
  try {
    return await pb.collection("device_profiles").getFirstListItem(`name = "${name}"`);
  } catch {
    return null;
  }
}

async function createField(profileId: string, f: Record<string, unknown>) {
  await pb.collection("profile_fields").create({ profile: profileId, data_type: "number", category: "telemetry", access: "r", ...f });
}

async function createControl(profileId: string, c: Record<string, unknown>) {
  await pb.collection("profile_controls").create({ profile: profileId, ...c });
}

async function createCommand(profileId: string, c: Record<string, unknown>) {
  await pb.collection("profile_commands").create({ profile: profileId, payload_type: "empty", ...c });
}

async function createDecodeRule(profileId: string, r: Record<string, unknown>) {
  await pb.collection("decode_rules").create({ profile: profileId, ...r });
}

async function createVisualization(profileId: string, v: Record<string, unknown>) {
  await pb.collection("profile_visualizations").create({ profile: profileId, ...v });
}

async function main() {
  await authPb(pb);
  step("Creating Solar Farm Monitor v1 profile");

  // Check seeded profiles exist
  for (const name of ["FarMon Water Monitor v1", "SenseCAP S2105"]) {
    const p = await findProfile(name);
    if (p) {
      ok(`${name} exists (id=${p.id})`);
    } else {
      err(`${name} NOT found — is the backend running with seed?`);
    }
  }

  // Create Solar Farm Monitor
  const existing = await findProfile(PROFILE_SOLAR_FARM);
  if (existing) {
    ok(`${PROFILE_SOLAR_FARM} already exists (id=${existing.id}), skipping`);
    return;
  }

  const profile = await pb.collection("device_profiles").create({
    name: PROFILE_SOLAR_FARM,
    description: "LoRa-E5 with RS485 3-phase solar inverter, water flow sensor, relay valve, solar battery system, and DHT22 temp/humidity sensor",
    profile_type: "airconfig",
    is_template: true,
  });
  ok(`Created profile: ${profile.id}`);

  // --- Fields (sort_order = field_idx) ---
  info("Creating fields...");
  const fields = [
    // Solar inverter (RS485 Modbus)
    { key: "grid_v",     display_name: "Grid Voltage",        unit: "V",   sort_order: 0,  state_class: "m", max_value: 300 },
    { key: "grid_p",     display_name: "Grid Power",          unit: "W",   sort_order: 1,  state_class: "m", max_value: 6000 },
    { key: "pv_v",       display_name: "PV Voltage",          unit: "V",   sort_order: 2,  state_class: "m", max_value: 500 },
    { key: "pv_p",       display_name: "PV Power",            unit: "W",   sort_order: 3,  state_class: "m", max_value: 6000 },
    { key: "daily_kwh",  display_name: "Daily Energy",        unit: "kWh", sort_order: 4,  state_class: "i", max_value: 50 },
    { key: "total_kwh",  display_name: "Total Energy",        unit: "kWh", sort_order: 5,  state_class: "i", max_value: 999999 },
    { key: "inv_temp",   display_name: "Inverter Temp",       unit: "°C",  sort_order: 6,  state_class: "m", max_value: 80 },
    // Battery system
    { key: "bat_v",      display_name: "Battery Voltage",     unit: "V",   sort_order: 7,  state_class: "m", max_value: 60 },
    { key: "bat_soc",    display_name: "Battery SOC",         unit: "%",   sort_order: 8,  state_class: "m", max_value: 100 },
    { key: "charge_p",   display_name: "Charge Power",        unit: "W",   sort_order: 9,  state_class: "m", max_value: 1000 },
    // Water flow
    { key: "flow_rate",  display_name: "Flow Rate",           unit: "L/min", sort_order: 10, state_class: "m", max_value: 100 },
    { key: "total_flow", display_name: "Total Flow",          unit: "L",   sort_order: 11, state_class: "i", max_value: 999999 },
    // Environment
    { key: "temperature", display_name: "Temperature",        unit: "°C",  sort_order: 12, state_class: "m", max_value: 60 },
    { key: "humidity",    display_name: "Humidity",            unit: "%",   sort_order: 13, state_class: "m", max_value: 100 },
    // System
    { key: "bp",          display_name: "Device Battery",     unit: "%",   sort_order: 14, state_class: "m", max_value: 100, category: "system" },
    { key: "tx",          display_name: "TX Interval",        unit: "s",   sort_order: 15, state_class: "m", max_value: 3600, category: "system", access: "w" },
  ];
  for (const f of fields) {
    await createField(profile.id, f);
  }
  ok(`Created ${fields.length} fields`);

  // --- Controls ---
  info("Creating controls...");
  await createControl(profile.id, { key: "valve", display_name: "Irrigation Valve", states: JSON.stringify(["closed", "open"]), sort_order: 0 });
  ok("Created 1 control (valve)");

  // --- Commands ---
  info("Creating commands...");
  const commands = [
    { name: "reset",    fport: 10 },
    { name: "interval", fport: 11, payload_type: "uint16_le_seconds" },
    { name: "reboot",   fport: 12 },
    { name: "status",   fport: 15 },
    { name: "ctrl",     fport: 20, payload_type: "control_binary" },
  ];
  for (const c of commands) {
    await createCommand(profile.id, c);
  }
  ok(`Created ${commands.length} commands`);

  // --- Decode rules ---
  info("Creating decode rules...");
  await createDecodeRule(profile.id, {
    fport: 2,
    format: "text_kv",
    config: JSON.stringify({ separator: ",", kv_separator: ":" }),
  });
  await createDecodeRule(profile.id, {
    fport: 3,
    format: "binary_state_change",
    config: JSON.stringify({
      record_size: 11,
      layout: [
        { offset: 0, name: "control_idx", type: "uint8" },
        { offset: 1, name: "new_state", type: "uint8" },
        { offset: 2, name: "old_state", type: "uint8" },
        { offset: 3, name: "source_id", type: "uint8" },
        { offset: 4, name: "rule_id", type: "uint8" },
        { offset: 5, name: "device_ms", type: "uint32_le" },
        { offset: 9, name: "seq", type: "uint16_le" },
      ],
      source_map: { "0": "BOOT", "1": "RULE", "2": "MANUAL", "3": "DOWNLINK" },
    }),
  });
  ok("Created 2 decode rules");

  // --- AirConfig ---
  info("Creating airconfig...");
  await pb.collection("profile_airconfig").create({
    profile: profile.id,
    pin_map:  JSON.stringify([0,0,0,0,3,0,5,0,9,0,0,0,0,0,0,0,0,0,0,0]),
    sensors:  JSON.stringify([
      { type: 10, pin_index: 4, field_index: 0, flags: 1, param1: 9600 },  // RS485 inverter
      { type: 1,  pin_index: 6, field_index: 10, flags: 1, param1: 450 },  // Flow sensor
      { type: 5,  pin_index: 0, field_index: 12, flags: 1, param1: 0 },    // DHT22
      { type: 2,  pin_index: 0, field_index: 14, flags: 1, param1: 0 },    // Battery ADC
    ]),
    controls: JSON.stringify([{ pin_index: 8, state_count: 2, flags: 1 }]),
    lorawan:  JSON.stringify({ region: 0, sub_band: 1, data_rate: 0, tx_power: 0, adr: true, confirmed: false }),
  });
  ok("Created airconfig");

  // --- Visualizations ---
  info("Creating visualizations...");
  const vizs = [
    { name: "Solar Production",   viz_type: "time_series", sort_order: 0,
      config: JSON.stringify({ fields: ["pv_p", "grid_p"], y_label: "Power", y_unit: "W", color: ["#f59e0b", "#3b82f6"] }) },
    { name: "Daily Energy",       viz_type: "time_series", sort_order: 1,
      config: JSON.stringify({ fields: ["daily_kwh"], y_label: "Energy", y_unit: "kWh" }) },
    { name: "Battery",            viz_type: "gauge", sort_order: 2,
      config: JSON.stringify({ field: "bat_soc", color_ranges: [{ max: 20, color: "error" }, { max: 50, color: "warning" }, { max: 100, color: "success" }] }) },
    { name: "Charge Power",       viz_type: "time_series", sort_order: 3,
      config: JSON.stringify({ fields: ["charge_p"], y_label: "Power", y_unit: "W", color: ["#10b981"] }) },
    { name: "Water Flow",         viz_type: "time_series", sort_order: 4,
      config: JSON.stringify({ fields: ["flow_rate"], y_label: "Flow", y_unit: "L/min", color: ["#06b6d4"] }) },
    { name: "Temperature & Humidity", viz_type: "time_series", sort_order: 5,
      config: JSON.stringify({ fields: ["temperature", "humidity"], y_label: "Value", y_unit: "", color: ["#ef4444", "#8b5cf6"] }) },
    { name: "Grid Voltage",       viz_type: "stat", sort_order: 6,
      config: JSON.stringify({ field: "grid_v", suffix: "V", show_trend: true }) },
    { name: "Inverter Temp",      viz_type: "gauge", sort_order: 7,
      config: JSON.stringify({ field: "inv_temp", color_ranges: [{ max: 40, color: "success" }, { max: 60, color: "warning" }, { max: 80, color: "error" }] }) },
  ];
  for (const v of vizs) {
    await createVisualization(profile.id, v);
  }
  ok(`Created ${vizs.length} visualizations`);

  ok(`Done! Solar Farm Monitor profile id=${profile.id}`);
}

main().catch(e => { err(e.message); process.exit(1); });
