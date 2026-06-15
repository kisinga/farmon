/**
 * Shared test helpers. The board loader is a thin file read + `parseBoardDef`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { type BoardDef, parseBoardDef } from "@core";

/** Load + parse a board.yaml from a board directory. */
export function loadBoard(boardDir: string): BoardDef {
  return parseBoardDef(parseYaml(fs.readFileSync(path.join(boardDir, "board.yaml"), "utf-8")));
}

/**
 * Minimal assertion harness shared by the tsx test files (they otherwise each
 * re-roll this pass/fail/exit boilerplate). `done()` exits non-zero on any
 * failure — the signal `run-all.ts` keys on.
 */
export function makeAsserter() {
  let passed = 0;
  let failed = 0;
  const assert = (condition: boolean, name: string, detail?: string): void => {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  };
  const done = (): never => {
    console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ""}`);
    process.exit(failed ? 1 : 0);
  };
  return { assert, done };
}
