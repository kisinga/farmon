/**
 * One-time migration: convert pump-controller.yaml from schema 2 to schema 3.
 * Usage: npx tsx test/migrate-config.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ManifestSchema } from "../electron/lib/schema.js";
import { manifestToTopology } from "../electron/lib/manifest-to-topology.js";

const DEFAULTS = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults");
const CONFIG_PATH = path.join(DEFAULTS, "configs/pump-controller.yaml");

const raw = parseYaml(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
const manifest = ManifestSchema.parse(raw);
const topology = manifestToTopology(manifest);

// Fix up the endpoint name to be more descriptive
for (const node of topology.nodes) {
  if (node.kind === "endpoint" && node.id === "h2") {
    node.name = "House 2";
  }
}

const yaml = stringifyYaml(topology, { indent: 2, lineWidth: 0 });
fs.writeFileSync(CONFIG_PATH, yaml, "utf-8");
console.log(`Migrated ${CONFIG_PATH} to schema 3`);
console.log(yaml);
