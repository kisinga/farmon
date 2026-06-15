/**
 * Route → pipes mapping (`pipesAlongPath`): the live map animates a running
 * route by lighting its pipes, so each route must resolve to *its own* path's
 * pipes. Endpoint-reachability (the old approach) conflated parallel routes
 * between the same source/dest — this locks the path-exact behaviour.
 *
 * Usage: npx tsx test/route-pipes.test.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import Graph from "graphology";
import {
  pipesAlongPath, buildGraph, deriveRoutes, parseTopology, type TopologyGraph,
} from "@core";
import { makeAsserter } from "./helpers";

const { assert, done } = makeAsserter();

// ---------------------------------------------------------------------------
// Targeted: two parallel valve paths between the same endpoints.
//   S → vA → D   and   S → vB → D
// The routes share source + destination but differ by valve, so reachability
// would return all four pipes for either; the path-exact mapping must not.
// ---------------------------------------------------------------------------
function diamond(): TopologyGraph {
  const g = new Graph({ type: "directed", multi: false });
  for (const n of ["S", "vA", "vB", "D"]) g.addNode(n);
  g.addEdge("S", "vA", { pipeId: "p_s_va" });
  g.addEdge("vA", "D", { pipeId: "p_va_d" });
  g.addEdge("S", "vB", { pipeId: "p_s_vb" });
  g.addEdge("vB", "D", { pipeId: "p_vb_d" });
  return g as unknown as TopologyGraph;
}

console.log("Parallel paths (synthetic diamond):");
const g = diamond();
const viaA = pipesAlongPath(g, ["S", "vA", "D"]);
const viaB = pipesAlongPath(g, ["S", "vB", "D"]);
assert(JSON.stringify(viaA) === JSON.stringify(["p_s_va", "p_va_d"]), "route via vA → exactly its two pipes");
assert(JSON.stringify(viaB) === JSON.stringify(["p_s_vb", "p_vb_d"]), "route via vB → exactly its two pipes");
assert(!viaA.some((p) => viaB.includes(p)), "parallel routes share no pipes (no cross-branch leak)");
assert(pipesAlongPath(g, ["vA", "S"]).length === 1, "reversed orientation still resolves the pipe");
assert(pipesAlongPath(g, ["S", "D"]).length === 0, "non-adjacent pair → skipped, not thrown");

// ---------------------------------------------------------------------------
// Property check against a real derived topology (composes with deriveRoutes):
// every route's pipes are one-per-step and all real; parallel routes differ.
// ---------------------------------------------------------------------------
console.log("\nReal topology (derived routes):");
const CONFIG = path.resolve(new URL(".", import.meta.url).pathname, "..", "defaults/configs/pump-controller.yaml");
const topo = parseTopology(parseYaml(fs.readFileSync(CONFIG, "utf-8")));
const rg = buildGraph(topo.nodes, topo.pipes);
const routes = deriveRoutes(rg);
const realPipes = new Set(topo.pipes.map((p) => p.id));
assert(routes.length > 0, `derived ${routes.length} route(s)`);

const byEndpoints = new Map<string, string[][]>();
for (const r of routes) {
  const pipes = pipesAlongPath(rg, r.nodeSequence);
  assert(pipes.length === Math.max(0, r.nodeSequence.length - 1), `route ${r.key}: one pipe per path step`);
  assert(pipes.every((id) => realPipes.has(id)), `route ${r.key}: all pipes are real topology pipes`);
  const ends = `${r.nodeSequence[0]}→${r.nodeSequence[r.nodeSequence.length - 1]}`;
  const list = byEndpoints.get(ends) ?? [];
  list.push(pipes);
  byEndpoints.set(ends, list);
}

let parallelPairs = 0;
for (const [ends, sets] of byEndpoints) {
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      parallelPairs++;
      assert(JSON.stringify(sets[i]) !== JSON.stringify(sets[j]), `parallel routes ${ends} get distinct pipe sets`);
    }
  }
}
console.log(`  (checked ${parallelPairs} same-endpoint route pair(s))`);

done();
