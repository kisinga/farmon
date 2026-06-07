/**
 * Cleanup: Remove all simulated data.
 *
 * Deletes telemetry, state_changes, commands, device_controls, device_fields
 * for simulation device EUIs, then deletes the devices and the Solar Farm profile.
 *
 * Does NOT touch the seeded profiles (FarMon Water Monitor, SenseCAP S2105).
 */
import PocketBase from "pocketbase";
import { PB_URL, DEVICES, PROFILE_SOLAR_FARM, authPb, step, ok, info, err } from "./config.js";

const pb = new PocketBase(PB_URL);

const SIM_EUIS = Object.values(DEVICES).map(d => d.eui);

async function deleteByEui(collection: string, euiField: string) {
  let deleted = 0;
  for (const eui of SIM_EUIS) {
    try {
      const records = await pb.collection(collection).getFullList({ filter: `${euiField} = "${eui}"` });
      for (const rec of records) {
        await pb.collection(collection).delete(rec.id);
        deleted++;
      }
    } catch { /* collection may not exist */ }
  }
  return deleted;
}

async function main() {
  await authPb(pb);
  step("Cleaning up simulation data");

  info("Deleting telemetry...");
  ok(`${await deleteByEui("telemetry", "device_eui")} telemetry records`);

  info("Deleting state changes...");
  ok(`${await deleteByEui("state_changes", "device_eui")} state change records`);

  info("Deleting commands...");
  ok(`${await deleteByEui("commands", "device_eui")} command records`);

  info("Deleting device controls...");
  ok(`${await deleteByEui("device_controls", "device_eui")} device control records`);

  info("Deleting device fields...");
  ok(`${await deleteByEui("device_fields", "device_eui")} device field records`);

  info("Deleting devices...");
  ok(`${await deleteByEui("devices", "device_eui")} device records`);

  info("Deleting lorawan sessions...");
  ok(`${await deleteByEui("lorawan_sessions", "device_eui")} session records`);

  // Delete Solar Farm profile (cascade deletes sub-components)
  info("Deleting Solar Farm Monitor profile...");
  try {
    const profile = await pb.collection("device_profiles").getFirstListItem(`name = "${PROFILE_SOLAR_FARM}"`);
    await pb.collection("device_profiles").delete(profile.id);
    ok("Solar Farm Monitor profile deleted");
  } catch {
    info("  Solar Farm profile not found, skipping");
  }

  info("");
  ok("Cleanup complete. Run steps again to re-seed.");
}

main().catch(e => { err(e.message); process.exit(1); });
