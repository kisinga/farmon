/**
 * Unit tests for yaml-fragment utilities.
 *
 * Usage: npx tsx test/unit/yaml-fragment.test.ts
 */

import { indent, joinYamlItems } from '../../packages/core/src/yaml-fragment';

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

// ---------------------------------------------------------------------------
// indent()
// ---------------------------------------------------------------------------

console.log("indent():");

assert(indent("- platform: gpio\n  id: test", 2) === "  - platform: gpio\n    id: test",
  "Prepends pad to each non-empty line, preserving relative indent");

assert(indent("line1\n\nline2", 4) === "    line1\n\n    line2",
  "Preserves empty lines without adding whitespace");

assert(indent("  already indented", 2) === "    already indented",
  "Adds pad on top of existing indentation");

assert(indent("", 2) === "",
  "Empty string stays empty");

// ---------------------------------------------------------------------------
// joinYamlItems()
// ---------------------------------------------------------------------------

console.log("\njoinYamlItems():");

const items = [
  "- platform: gpio\n  id: pump_relay\n  name: \"Pump\"",
  "- platform: gpio\n  id: valve_open\n  name: \"Valve\"",
];

const joined = joinYamlItems(items);
assert(joined.startsWith("  - platform: gpio"),
  "First item indented by default 2 spaces");
assert(joined.includes("\n\n  - platform: gpio"),
  "Items separated by blank line");
assert(!joined.includes("\n\n\n"),
  "No triple newlines");

const joined4 = joinYamlItems(items, 4);
assert(joined4.startsWith("    - platform: gpio"),
  "Custom indent of 4 spaces");

assert(joinYamlItems([]) === "",
  "Empty array returns empty string");

assert(joinYamlItems(["- single"]) === "  - single",
  "Single item indented without trailing separator");

// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
