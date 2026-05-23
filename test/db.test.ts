/**
 * Tests for the generation history DB module (electron/db.ts).
 * Runs without Electron — uses a temp directory for the DB file.
 *
 * Usage: npm run test:db
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  openDb,
  closeDb,
  createGeneration,
  finalizeGeneration,
  listGenerations,
  loadGeneration,
  loadGenerationByVersion,
  pruneGenerations,
  inputChecksum,
  createSite,
  listSites,
  loadSiteFull,
  saveSiteTransaction,
  deleteSite,
  insertSystem,
  checkNodeIdConflicts,
  getSetting,
  setSetting,
  getSettings,
  duplicateSite,
} from "../electron/db.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
    failed++;
  }
}

/** Create a topology with a unique field so each generation has a distinct checksum. */
function topo(name: string, variant: number) {
  return { device: { name }, nodes: [{ id: variant }], edges: [] };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "majiflow-db-test-"));

  console.log("\nDB module tests\n");
  console.log(`  Temp dir: ${tmpDir}\n`);

  // -------------------------------------------------------------------------

  console.log("openDb");
  await openDb(tmpDir);
  assert(fs.existsSync(path.join(tmpDir, "generations.db")), "creates DB file on disk");

  // -------------------------------------------------------------------------
  // Site CRUD
  // -------------------------------------------------------------------------

  console.log("\ncreateSite");
  createSite("test-site", "Test Site");
  const sites = listSites();
  assert(sites.length === 1, "site created");
  assert(sites[0].id === "test-site", "correct site id");
  assert(sites[0].friendlyName === "Test Site", "correct friendly name");

  console.log("\nsaveSiteTransaction");
  saveSiteTransaction({
    site: { id: "test-site", friendlyName: "Test Site Updated" },
    topology: {
      schema: 15,
      controllers: [{ id: "pump-ctrl", board: "heltec-v3" }],
      nodes: [
        { id: "pump1", kind: "pump", anchorId: "pump-ctrl" },
        { id: "tank1", kind: "tank", anchorId: "pump-ctrl" },
      ],
      pipes: [],
      route_overrides: {},
      timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
      automations: [],
    },
  });

  const full = loadSiteFull("test-site");
  assert(full !== null, "site loads after save");
  assert(full!.site.friendlyName === "Test Site Updated", "friendly name updated");
  const savedTopo = full!.topology as { nodes: Array<{ id: string }> };
  assert(savedTopo.nodes.length === 2, "topology nodes preserved");

  console.log("\ncheckNodeIdConflicts");
  const conflicts = checkNodeIdConflicts("test-site", "other-system", ["pump1", "new-node"]);
  assert(conflicts.length === 1, "detects pump1 conflict");
  assert(conflicts[0] === "pump1", "correct conflicting ID");
  const noConflicts = checkNodeIdConflicts("test-site", "pump-ctrl", ["new-node"]);
  assert(noConflicts.length === 0, "no conflict for new node");

  console.log("\ninsertSystem");
  insertSystem("test-site", {
    id: "valve-ctrl",
    friendlyName: "Valve Controller",
    board: "heltec-v3",
    directory: null,
    topology: { nodes: [{ id: "valve1", kind: "valve" }], pipes: [], route_overrides: {}, timing: {}, automations: [] },
    deviceName: "valve-ctrl",
  });
  const full2 = loadSiteFull("test-site");
  const topo2 = full2!.topology as { controllers: Array<{ id: string }>; nodes: Array<{ id: string }> };
  assert(topo2.controllers.length === 2, "second controller inserted");
  assert(topo2.nodes.length === 3, "third node inserted");

  console.log("\ndeleteSite");
  createSite("to-delete", "Delete Me");
  deleteSite("to-delete");
  assert(loadSiteFull("to-delete") === null, "site deleted");

  // -------------------------------------------------------------------------
  // Generation history
  // -------------------------------------------------------------------------

  console.log("\ninputChecksum");
  const board = { model: "heltec-v3", label: "Heltec V3", pins: [] };
  const cs1 = inputChecksum(topo("dev", 1), board);
  const cs2 = inputChecksum(topo("dev", 2), board);
  const cs1again = inputChecksum(topo("dev", 1), board);
  assert(cs1.length === 16, "checksum is 16-char hex");
  assert(cs1 !== cs2, "different inputs produce different checksums");
  assert(cs1 === cs1again, "same inputs produce same checksum");

  console.log("\ncreateGeneration");
  const gen1 = createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 1), board);
  assert(gen1 !== null, "first generation is created");
  assert(typeof gen1!.id === "number" && gen1!.id > 0, "returns numeric ID");
  assert(typeof gen1!.version === "string" && gen1!.version.length === 8, "returns 8-char hex version");

  const gen2 = createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 2), board);
  assert(gen2 !== null, "different inputs creates new generation");
  assert(gen2!.id > gen1!.id, "IDs are incrementing");

  const gen3 = createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 3), board);
  assert(gen3 !== null, "third distinct generation created");

  console.log("\ncreateGeneration — checksum dedup");
  const dup = createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 3), board);
  assert(dup === null, "returns null when inputs match latest generation");
  assert(listGenerations("test-site", "pump-ctrl").length === 3, "no new row created for duplicate");

  // Different system with same inputs should still create
  const otherSystem = createGeneration("test-site", "valve-ctrl", topo("pump-ctrl", 3), board);
  assert(otherSystem !== null, "same inputs but different system creates new generation");

  console.log("\nfinalizeGeneration");
  finalizeGeneration(gen1!.id, 10);
  finalizeGeneration(gen2!.id, 9);
  finalizeGeneration(gen3!.id, 11);
  const loaded1 = loadGeneration(gen1!.id);
  assert(loaded1?.fileCount === 10, "updates file count");

  console.log("\nlistGenerations");
  const list = listGenerations("test-site", "pump-ctrl");
  assert(list.length === 3, `returns correct count (got ${list.length})`);
  assert(list[0].id === gen3!.id, "newest first");
  assert(list[0].version === gen3!.version, "includes version");
  assert(list[0].fileCount === 11, "includes file count");

  console.log("\nlistGenerations — different system");
  const otherList = listGenerations("test-site", "valve-ctrl");
  assert(otherList.length === 1, "separate system has independent history");

  console.log("\nloadGeneration");
  const snapshot = loadGeneration(gen1!.id);
  assert(snapshot !== null, "returns snapshot for valid ID");
  assert(snapshot!.version === gen1!.version, "correct version");
  assert(snapshot!.systemId === "pump-ctrl", "correct system id");
  const parsedTopology = JSON.parse(snapshot!.topology);
  assert(parsedTopology.device.name === "pump-ctrl", "topology JSON is parseable and correct");

  console.log("\nloadGenerationByVersion");
  const byVersion = loadGenerationByVersion(gen2!.version);
  assert(byVersion !== null, "finds by version string");
  assert(byVersion!.id === gen2!.id, "returns correct generation");

  console.log("\npruneGenerations");
  createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 4), board);
  createGeneration("test-site", "pump-ctrl", topo("pump-ctrl", 5), board);
  assert(listGenerations("test-site", "pump-ctrl").length === 5, "now has 5 generations");

  const pruned = pruneGenerations("test-site", "pump-ctrl", 2);
  assert(pruned === 3, `pruned 3 oldest (got ${pruned})`);
  assert(listGenerations("test-site", "pump-ctrl").length === 2, "keeps only 2 most recent");

  assert(listGenerations("test-site", "valve-ctrl").length === 1, "prune does not affect other systems");

  // -------------------------------------------------------------------------
  // System settings
  // -------------------------------------------------------------------------

  console.log("\nsettings — CRUD");
  setSetting("test-site", "pump-ctrl", "generator", "esphome");
  assert(getSetting("test-site", "pump-ctrl", "generator") === "esphome", "getSetting returns stored value");
  assert(getSetting("test-site", "pump-ctrl", "missing") === null, "getSetting returns null for missing key");

  setSetting("test-site", "pump-ctrl", "generator", "frugaliot");
  assert(getSetting("test-site", "pump-ctrl", "generator") === "frugaliot", "setSetting overwrites existing value");

  setSetting("test-site", "pump-ctrl", "ota_address", "192.168.1.50");
  const allSettings = getSettings("test-site", "pump-ctrl");
  assert(Object.keys(allSettings).length === 2, "getSettings returns all keys");
  assert(allSettings.generator === "frugaliot", "getSettings includes generator");
  assert(allSettings.ota_address === "192.168.1.50", "getSettings includes ota_address");

  console.log("\nsettings — cascade on site delete");
  createSite("settings-cascade", "Cascade Test");
  saveSiteTransaction({
    site: { id: "settings-cascade", friendlyName: "Cascade Test" },
    topology: {
      schema: 15,
      controllers: [{ id: "sys1", board: "heltec-v3" }],
      nodes: [],
      pipes: [],
      route_overrides: {},
      timing: { valve_travel_time: 15, flow_watchdog: 30, flow_confirm: 10, flow_threshold: 0.5, api_watchdog: 60, update_interval: 30 },
      automations: [],
    },
  });
  setSetting("settings-cascade", "sys1", "key1", "val1");
  deleteSite("settings-cascade");
  assert(loadSiteFull("settings-cascade") === null, "site deleted");

  console.log("\nsettings — duplicateSite copies settings");
  setSetting("test-site", "pump-ctrl", "copy_test", "copied_value");
  duplicateSite("test-site", "dup-site", "Dup Site");
  const dupSettings = getSettings("dup-site", "pump-ctrl");
  assert(dupSettings.copy_test === "copied_value", "duplicateSite copies settings");
  assert(dupSettings.generator === "frugaliot", "duplicateSite copies all settings");

  // -------------------------------------------------------------------------

  closeDb();
  fs.rmSync(tmpDir, { recursive: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
