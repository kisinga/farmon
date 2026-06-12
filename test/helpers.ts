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
