// Dev helper: render a site's ESPHome bundle to disk so `esphome config` / `esphome
// compile` can validate the generated YAML + vendored external_components end-to-end.
//   npx tsx scripts/emit-bundle.ts <config.yaml> <boardDir> <outDir>
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseTopology, topologyToManifestForController } from "@core";
import { generateAll, createTestMetadata } from "@core/codegen";
import { loadBoard } from "../test/helpers";

const [configPath, boardDir, outDir] = process.argv.slice(2);
if (!configPath || !boardDir || !outDir) {
  console.error("usage: tsx scripts/emit-bundle.ts <config.yaml> <boardDir> <outDir>");
  process.exit(2);
}

const topo = parseTopology(parseYaml(fs.readFileSync(configPath, "utf-8")));
const ctrl = topo.controllers[0]?.id ?? "default";
const manifest = topologyToManifestForController(topo, ctrl);
const files = generateAll(manifest, loadBoard(boardDir), "test-site", undefined, createTestMetadata(), {});

for (const f of files) {
  const p = path.join(outDir, f.relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.content);
}

const dir = manifest.device.directory ?? manifest.device.name;
const deviceYaml = files.find((f) => f.relativePath.endsWith(`/${dir}/${dir}.yaml`));
if (!deviceYaml) {
  console.error(`device yaml not found for "${dir}" (no file ending /${dir}/${dir}.yaml)`);
  process.exit(1);
}
console.log(`wrote ${files.length} files to ${outDir}`);
console.log(`DEVICE_YAML=${path.join(outDir, deviceYaml.relativePath)}`);
