/**
 * Step 2: Provision devices with their profiles.
 *
 * Creates 4 devices:
 *   e001 — FarMon Water Monitor (with firmware)
 *   e002 — Solar Farm Monitor (with firmware)
 *   e003 — SenseCAP S2105 (third-party, no firmware)
 *   e004 — FarMon Water Monitor (new device, no firmware yet)
 *
 * Idempotent: updates existing devices if already provisioned.
 */
import PocketBase from "pocketbase";
import {
  PB_URL, DEVICES, PROFILE_WATER_MONITOR, PROFILE_SOLAR_FARM, PROFILE_SENSECAP,
  authPb, step, ok, info, err,
} from "./config.js";

const pb = new PocketBase(PB_URL);

async function findProfileByName(name: string): Promise<string> {
  const rec = await pb.collection("device_profiles").getFirstListItem(`name = "${name}"`);
  return rec.id;
}

async function provisionViaAPI(eui: string, name: string, profileId: string) {
  const res = await fetch(`${PB_URL}/api/farmon/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_eui: eui, device_name: name, profile_id: profileId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function setDeviceFields(eui: string, fields: Record<string, unknown>) {
  const rec = await pb.collection("devices").getFirstListItem(`device_eui = "${eui}"`);
  await pb.collection("devices").update(rec.id, fields);
}

async function main() {
  step("Authenticating as superuser");
  await authPb(pb);
  ok("Authenticated");

  step("Resolving profiles");
  const waterProfileId = await findProfileByName(PROFILE_WATER_MONITOR);
  ok(`${PROFILE_WATER_MONITOR} → ${waterProfileId}`);

  const solarProfileId = await findProfileByName(PROFILE_SOLAR_FARM);
  ok(`${PROFILE_SOLAR_FARM} → ${solarProfileId}`);

  const soilProfileId = await findProfileByName(PROFILE_SENSECAP);
  ok(`${PROFILE_SENSECAP} → ${soilProfileId}`);

  // --- Device 1: FarMon Water Monitor (has firmware) ---
  step("Provisioning devices");

  const d1 = DEVICES.waterMonitor;
  const r1 = await provisionViaAPI(d1.eui, d1.name, waterProfileId);
  await setDeviceFields(d1.eui, {
    firmware_version: "2.1.0",
    device_type: "water_monitor",
    config_status: "synced",
    is_active: true,
  });
  ok(`${d1.name} (${d1.eui}) — app_key=${r1.app_key}`);

  // --- Device 2: Solar Farm Monitor (has firmware) ---
  const d2 = DEVICES.solarFarm;
  const r2 = await provisionViaAPI(d2.eui, d2.name, solarProfileId);
  await setDeviceFields(d2.eui, {
    firmware_version: "1.0.3",
    device_type: "solar_farm_monitor",
    config_status: "synced",
    is_active: true,
  });
  ok(`${d2.name} (${d2.eui}) — app_key=${r2.app_key}`);

  // --- Device 3: SenseCAP S2105 (third party, no custom firmware) ---
  const d3 = DEVICES.soilSensor;
  const r3 = await provisionViaAPI(d3.eui, d3.name, soilProfileId);
  await setDeviceFields(d3.eui, {
    device_type: "sensecap_s2105",
    config_status: "n/a",
    is_active: true,
  });
  ok(`${d3.name} (${d3.eui}) — app_key=${r3.app_key}`);

  // --- Device 4: Unprovisioned (profile set, but no firmware/data yet) ---
  const d4 = DEVICES.unprovisioned;
  const r4 = await provisionViaAPI(d4.eui, d4.name, waterProfileId);
  await setDeviceFields(d4.eui, {
    config_status: "pending",
    is_active: false,
  });
  ok(`${d4.name} (${d4.eui}) — app_key=${r4.app_key} (inactive, no firmware)`);

  info("");
  ok("All 4 devices provisioned.");
}

main().catch(e => { err(e.message); process.exit(1); });
