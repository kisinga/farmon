/**
 * Drift guard: the generated TS barrel (src/lib/static/firmware-components.generated.ts,
 * which the browser codegen ships) MUST mirror the real ESPHome external_components
 * source under firmware/components/**. The real files are the source of truth — author,
 * compile, and host-test those; this barrel is a build artifact. If they diverge, the
 * downloaded firmware bundle would carry stale C++.
 *
 * Fix on failure: npm run gen:firmware-components
 *
 * Usage: npm run test:firmware-components
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { FIRMWARE_COMPONENT_FILES } from "@core";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const SRC = path.join(ROOT, "firmware", "components");

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

/** Files under `dir`, as POSIX paths relative to it, sorted — matches the gen script. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry);
    if (fs.statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out.sort();
}

const onDisk = walk(SRC);
const inBarrel = FIRMWARE_COMPONENT_FILES.map((f) => f.path).sort();

assert(
  JSON.stringify(onDisk) === JSON.stringify(inBarrel),
  "barrel lists exactly the on-disk component files",
  `disk=${onDisk.join(",")} barrel=${inBarrel.join(",")}`,
);

for (const rel of onDisk) {
  const expected = fs.readFileSync(path.join(SRC, rel), "utf8");
  const actual = FIRMWARE_COMPONENT_FILES.find((f) => f.path === rel)?.content;
  assert(actual === expected, `barrel content matches ${rel}`, "run: npm run gen:firmware-components");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
