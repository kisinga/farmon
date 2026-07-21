// End-to-end validation of the online firmware-generation asset path:
//   1. the running server's /device-ui/ route (headers, raw gz bytes, no-cache)
//   2. fetchDeviceUiAssets — the exact browser-path code — against that server
//   3. generateLocalUiAssetsHeader over the fetched assets + a site topology
//   4. the mixed-build guard (index refs must resolve)
//
// Usage: npx tsx scripts/validate-device-ui.ts [serverBaseUrl]
// Expects a maji-cloud running with MAJI_DEVICE_UI_DIR set (see header of
// scripts/validate-device-ui.sh for the full local harness).
import assert from "node:assert";
import { gunzipSync } from "fflate";
import { fetchDeviceUiAssets, generateLocalUiAssetsHeader } from "../src/lib/codegen/generators/local-ui";
import { topologyToManifestForController, parseTopology } from "../src/lib";
import { loadBoard } from "../test/helpers";
import * as fs from "node:fs";
import { parse as parseYaml } from "yaml";

const BASE = process.argv[2] ?? "http://127.0.0.1:8091";

async function main() {
  // 1. The route itself: manifest reachable, raw gz, revalidation forced.
  const mres = await fetch(`${BASE}/device-ui/device-ui-manifest.json`);
  assert.equal(mres.status, 200, "manifest: served");
  assert.equal(mres.headers.get("cache-control"), "no-cache", "manifest: no-cache (stale-mix prevention)");
  assert(!mres.headers.get("content-encoding"), "manifest: no content-encoding (raw bytes)");
  const manifest = (await mres.json()) as { assets: { file: string }[] };
  const oneGz = manifest.assets.find(a => a.file.endsWith(".gz"));
  assert(oneGz, "manifest: lists .gz files");
  const gres = await fetch(`${BASE}/device-ui/${oneGz!.file}`);
  assert.equal(gres.status, 200, "asset: served");
  assert.equal(gres.headers.get("content-type"), "application/gzip", "asset: application/gzip");
  assert(!gres.headers.get("content-encoding"), "asset: gz bytes not double-encoded");
  const magic = new Uint8Array(await gres.arrayBuffer());
  assert(magic[0] === 0x1f && magic[1] === 0x8b, "asset: gzip magic bytes");

  // 2. The exact browser codegen path against the live server.
  const dist = await fetchDeviceUiAssets(fetch, `${BASE}/device-ui/`);
  assert(dist, "fetchDeviceUiAssets: succeeded against the live server");
  assert(dist!.assets.length >= 5, `fetchDeviceUiAssets: ${dist!.assets.length} assets`);
  assert(dist!.assets.every(a => a.gz[0] === 0x1f && a.gz[1] === 0x8b), "fetchDeviceUiAssets: all payloads are gzip");

  // 3+4. Header generation over the fetched assets, with a real site topology.
  const topo = parseTopology(parseYaml(fs.readFileSync("defaults/configs/kc868-a16-controller.yaml", "utf-8")));
  const manifestOut = topologyToManifestForController(topo, topo.controllers[0].id);
  const header = await generateLocalUiAssetsHeader(manifestOut, JSON.stringify(topo));
  assert(header.includes('"/main-'), "header: real app embedded (not the placeholder)");
  assert(header.includes('"/topology.json"'), "header: topology injected");
  // The index-consistency guard ran inside generateLocalUiAssetsHeader — reaching
  // here means every script/style the index references is in the asset set.

  console.log(`validate-device-ui: OK — ${dist!.assets.length} assets fetched from ${BASE}, header consistent`);
}

main().catch((err) => {
  console.error("validate-device-ui: FAILED —", err instanceof Error ? err.message : err);
  process.exit(1);
});
