/**
 * Unit tests for the board pinout callout layout — the collision-free label
 * placement that backs the documentation "Board Pinout" render and the editor
 * board view.
 *
 * Usage: npm run test:pinout
 */
import * as path from "node:path";
import {
  layoutCallouts, emitPinoutSvg, calloutLabelsFor,
  type ConnectorGeom, type CalloutLabel, type ViewBox, type PinUsage,
} from "@core";
import { loadBoard } from "./helpers";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const VB: ViewBox = { x: 0, y: 0, width: 1000, height: 600 };

function boxesOverlap(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// --- layoutCallouts: collision-free stacking ------------------------------
{
  // Three left-side pins crammed at nearly the same height — naive on-pin labels
  // would overlap. Plus one right-side pin.
  const geoms: ConnectorGeom[] = [
    { connector: "L1", x: 100, y: 300, w: 8, h: 8 },
    { connector: "L2", x: 100, y: 304, w: 8, h: 8 },
    { connector: "L3", x: 100, y: 308, w: 8, h: 8 },
    { connector: "R1", x: 900, y: 120, w: 8, h: 8 },
  ];
  const labels: CalloutLabel[] = [
    { connector: "L1", text: "Tank A level", color: "#11aabb" },
    { connector: "L2", text: "Valve 1 open pin", color: "#cc4444" },
    { connector: "L3", text: "Pump booster", color: "#22bb55" },
    { connector: "R1", text: "Flow main", color: "#8844cc" },
  ];
  const p = layoutCallouts(geoms, labels, VB);

  assert(p.boxes.length === 4, "every connected pin gets a box");

  let anyOverlap = false;
  for (let i = 0; i < p.boxes.length; i++)
    for (let j = i + 1; j < p.boxes.length; j++)
      if (boxesOverlap(p.boxes[i], p.boxes[j])) anyOverlap = true;
  assert(!anyOverlap, "no two callout boxes overlap");

  const left = p.boxes.filter(b => b.side === "left");
  const right = p.boxes.filter(b => b.side === "right");
  assert(left.length === 3 && right.length === 1, "pins routed to the nearer margin");
  assert(left.every(b => b.x + b.w <= VB.x), "left boxes sit left of the board");
  assert(right.every(b => b.x >= VB.x + VB.width), "right boxes sit right of the board");

  assert(
    p.viewBox.width > VB.width && p.viewBox.x < VB.x,
    "viewBox expands to include the margin columns",
  );
  assert(p.boxes.every(b => b.w > 0 && b.text.length > 0), "boxes carry sized text");
  assert(
    p.boxes.every(b => (b.side === "left" ? b.pinX >= b.connectX : b.pinX <= b.connectX)),
    "leader runs from pin outward to its box",
  );
}

// --- layoutCallouts: empty input is inert ---------------------------------
{
  const p = layoutCallouts([], [], VB);
  assert(p.boxes.length === 0, "no labels -> no boxes");
  assert(p.viewBox.width === VB.width && p.viewBox.x === VB.x, "no labels -> viewBox untouched");
}

// --- emitPinoutSvg --------------------------------------------------------
{
  const base = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000" height="600"><rect id="L1" x="96" y="296" width="8" height="8"/></svg>`;

  const empty = layoutCallouts([], [], VB);
  assert(emitPinoutSvg(base, empty) === base, "no callouts -> base SVG returned unchanged");

  const p = layoutCallouts(
    [{ connector: "L1", x: 96, y: 296, w: 8, h: 8 }],
    [{ connector: "L1", text: "Tank A level", color: "#11aabb" }],
    VB,
  );
  const out = emitPinoutSvg(base, p);
  assert(out.includes('class="pinout-callouts"'), "callout group injected");
  assert(out.includes('width="100%"') && !/width="1000"/.test(out), "root re-rooted responsive (fixed width stripped)");
  assert(/viewBox="-?\d/.test(out) && !out.includes('viewBox="0 0 1000 600"'), "root viewBox replaced with expanded box");
  assert((out.match(/<svg/g) ?? []).length === 1 && out.trimEnd().endsWith("</svg>"), "still a single well-formed root SVG");
  assert(out.includes("Tank A level"), "label text present in output");
}

// --- calloutLabelsFor: connector lookup + off-board drop ------------------
{
  const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
  const board = loadBoard(path.join(ROOT, "defaults", "boards", "heltec-v3"));
  const realPin = board.pins[0];
  const usages: PinUsage[] = [
    {
      pin: realPin.gpio, nodeId: "n1", kind: "pump", nodeName: "Booster",
      fieldKey: "pin", fieldLabel: "Relay Pin", owner: 'Pump "Booster" Relay Pin',
    },
    {
      pin: "mux9:CH99", nodeId: "n2", kind: "valve", nodeName: "Off-board valve",
      fieldKey: "open_pin", fieldLabel: "Open Pin", owner: 'Valve "Off-board valve" Open Pin',
    },
  ];
  const labels = calloutLabelsFor(board, usages);
  assert(labels.length === 1, "off-board (mux) pin dropped, on-board pin kept");
  assert(labels[0].connector === realPin.connector, "pin mapped to its board connector");
  assert(labels[0].text.includes("Booster") && labels[0].text.includes("Relay Pin"), "label text combines node + field");
  assert(/^#/.test(labels[0].color), "label carries an entity colour");
}

console.log(`\n${"=".repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
