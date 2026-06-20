/**
 * Shared test helpers. The board loader is a thin file read + `parseBoardDef`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type BoardDef, parseBoardDef } from "@core";

/** Load + parse a board.json from a board directory — the canonical board definition
 *  (the same JSON shape the frontend imports into the DB catalog), so tests exercise
 *  the exact artifact production consumes. */
export function loadBoard(boardDir: string): BoardDef {
  return parseBoardDef(JSON.parse(fs.readFileSync(path.join(boardDir, "board.json"), "utf-8")));
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
