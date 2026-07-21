// device-topology normalizeTopology: /topology.json serves the RAW stored topology
// (what codegen injects into the firmware asset table); early bundles served an
// {site, topology} envelope. Both must bootstrap the dashboard — a strict
// envelope-only parse threw on `cache.site.id` and blanked the on-device UI.
import assert from "node:assert";
import { normalizeTopology } from "../src/app/device/device-topology";

const rawTopology = {
  schema: 19,
  controllers: [{ id: "kc868-a16-controller", friendlyName: "WATER-CTRL", board: "kc868_a16" }],
  nodes: [],
  pipes: [],
  route_overrides: {},
  timing: { update_interval: 5 },
  remoteImports: [],
};

// Raw shape (what the device actually serves): site identity is synthesized
// from the single controller; the topology passes through untouched.
{
  const env = normalizeTopology(structuredClone(rawTopology));
  assert.equal(env.site.id, "local", "raw: synthesized site id");
  assert.equal(env.site.name, "WATER-CTRL", "raw: site name from controller friendlyName");
  assert.equal(env.topology.controllers[0].id, "kc868-a16-controller", "raw: controller id readable");
  assert.equal(env.topology.timing.update_interval, 5, "raw: timing readable");
}

// Envelope shape (early bundles): passed through as-is.
{
  const envelope = { site: { id: "site-1", name: "Kavisi" }, topology: structuredClone(rawTopology) };
  const env = normalizeTopology(envelope);
  assert.equal(env.site.id, "site-1", "envelope: site id preserved");
  assert.equal(env.site.name, "Kavisi", "envelope: site name preserved");
  assert.equal(env.topology.schema, 19, "envelope: topology preserved");
}

// Degenerate raw topology (no controllers): falls back to a generic name
// instead of throwing — a broken page must never come from a name lookup.
{
  const env = normalizeTopology({ schema: 19, controllers: [] });
  assert.equal(env.site.name, "Controller", "empty: generic fallback name");
}

console.log("device-topology: all tests passed");
