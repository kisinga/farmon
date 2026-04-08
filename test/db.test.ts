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

  console.log("\ninputChecksum");
  const board = { model: "heltec-v3", label: "Heltec V3", pins: [] };
  const cs1 = inputChecksum(topo("dev", 1), board);
  const cs2 = inputChecksum(topo("dev", 2), board);
  const cs1again = inputChecksum(topo("dev", 1), board);
  assert(cs1.length === 16, "checksum is 16-char hex");
  assert(cs1 !== cs2, "different inputs produce different checksums");
  assert(cs1 === cs1again, "same inputs produce same checksum");

  console.log("\ncreateGeneration");
  const gen1 = createGeneration("test-device", topo("test-device", 1), board);
  assert(gen1 !== null, "first generation is created");
  assert(typeof gen1!.id === "number" && gen1!.id > 0, "returns numeric ID");
  assert(typeof gen1!.version === "string" && gen1!.version.length === 8, "returns 8-char hex version");
  assert(/^[0-9a-f]{8}$/.test(gen1!.version), "version is valid hex");

  const gen2 = createGeneration("test-device", topo("test-device", 2), board);
  assert(gen2 !== null, "different inputs creates new generation");
  assert(gen2!.id > gen1!.id, "IDs are incrementing");
  assert(gen2!.version !== gen1!.version, "versions are unique");

  const gen3 = createGeneration("test-device", topo("test-device", 3), board);
  assert(gen3 !== null, "third distinct generation created");

  console.log("\ncreateGeneration — checksum dedup");
  const dup = createGeneration("test-device", topo("test-device", 3), board);
  assert(dup === null, "returns null when inputs match latest generation");
  assert(listGenerations("test-device").length === 3, "no new row created for duplicate");

  // Different config with same inputs should still create
  const otherConfig = createGeneration("other-device", topo("test-device", 3), board);
  assert(otherConfig !== null, "same inputs but different config creates new generation");

  console.log("\nfinalizeGeneration");
  finalizeGeneration(gen1!.id, 10);
  finalizeGeneration(gen2!.id, 9);
  finalizeGeneration(gen3!.id, 11);
  const loaded1 = loadGeneration(gen1!.id);
  assert(loaded1?.fileCount === 10, "updates file count");

  console.log("\nlistGenerations");
  const list = listGenerations("test-device");
  assert(list.length === 3, `returns correct count (got ${list.length})`);
  assert(list[0].id === gen3!.id, "newest first");
  assert(list[0].version === gen3!.version, "includes version");
  assert(list[0].fileCount === 11, "includes file count");
  assert(typeof list[0].checksum === "string" && list[0].checksum.length === 16, "includes checksum");
  assert(typeof list[0].createdAt === "string", "includes createdAt");
  assert(!("topology" in list[0]), "excludes topology blob from list");
  assert(!("board" in list[0]), "excludes board blob from list");

  console.log("\nlistGenerations — different config");
  const otherList = listGenerations("other-device");
  assert(otherList.length === 1, "separate config has independent history");
  assert(listGenerations("test-device").length === 3, "original config unchanged");

  console.log("\nloadGeneration");
  const snapshot = loadGeneration(gen1!.id);
  assert(snapshot !== null, "returns snapshot for valid ID");
  assert(snapshot!.version === gen1!.version, "correct version");
  assert(snapshot!.configName === "test-device", "correct config name");
  const parsedTopology = JSON.parse(snapshot!.topology);
  assert(parsedTopology.device.name === "test-device", "topology JSON is parseable and correct");
  const parsedBoard = JSON.parse(snapshot!.board);
  assert(parsedBoard.model === "heltec-v3", "board JSON is parseable and correct");

  console.log("\nloadGeneration — invalid ID");
  assert(loadGeneration(99999) === null, "returns null for non-existent ID");

  console.log("\nloadGenerationByVersion");
  const byVersion = loadGenerationByVersion(gen2!.version);
  assert(byVersion !== null, "finds by version string");
  assert(byVersion!.id === gen2!.id, "returns correct generation");

  console.log("\nloadGenerationByVersion — invalid");
  assert(loadGenerationByVersion("00000000") === null, "returns null for non-existent version");

  console.log("\npruneGenerations");
  createGeneration("test-device", topo("test-device", 4), board);
  createGeneration("test-device", topo("test-device", 5), board);
  assert(listGenerations("test-device").length === 5, "now has 5 generations");

  const pruned = pruneGenerations("test-device", 2);
  assert(pruned === 3, `pruned 3 oldest (got ${pruned})`);
  assert(listGenerations("test-device").length === 2, "keeps only 2 most recent");

  assert(listGenerations("other-device").length === 1, "prune does not affect other configs");

  console.log("\ncreateGeneration — dedup after prune allows re-creation");
  // After pruning, gen3's checksum is gone. Re-creating with same inputs should work.
  const reborn = createGeneration("test-device", topo("test-device", 3), board);
  // The latest is topo 5, so topo 3 is different — should create
  assert(reborn !== null, "can create after prune removed the matching generation");

  // -------------------------------------------------------------------------

  closeDb();
  fs.rmSync(tmpDir, { recursive: true });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
