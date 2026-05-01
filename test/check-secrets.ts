import * as path from "node:path";
import * as fs from "node:fs";
import { loadBoard } from "../electron/lib/board.js";
import { generateSelfTest } from "../electron/lib/self-test/index.js";

const board = loadBoard(path.resolve("defaults/boards/kc868-a16"));
const secrets = {
  wifi_ssid: "SAF", wifi_password: "wahenganawahenguzi",
  api_key: "ujd3y58DwlY73ncaH4uvhjneXoK5Yl7lfjCCcwkhTKA=",
  ota_password: "fbf9b5033954a3716ecb8a34ddcbc85c",
};
const files = generateSelfTest(board, secrets);
const boardYaml = files.find(f => f.relativePath.endsWith("board.yaml"))!.content;
const lines = boardYaml.split("\n");
for (const l of lines) {
  if (l.includes("secret")) console.log(l);
}
console.log("\nHas quoted !secret:", boardYaml.includes('"!secret'));
// Write to tmp for esphome validation
const outDir = "/tmp/selftest-check";
for (const f of files) {
  const p = path.join(outDir, f.relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.content);
}
console.log("\nWrote to", outDir);
