// device-config-write: the single config write seam (BackendService.writeControllerConfig)
// in both builds.
//
// On-device (DeviceBackendService): one `config_set` command per patch entry, POSTed
// to /local/command through the same envelope path as every other device command —
// command_id minted client-side, actor 'local-ui', key/value in the body. This is
// what makes the Setup editors (safety timings, route defaults, calibration) work
// from the on-device bundle, where there is no PocketBase.
//
// Cloud (BackendService): the PocketBase `controller_config` find → update-or-create
// upsert the command-lifecycle store used to do inline (moved here so the device
// subclass can override it). Update merges into the existing `desired` bag; a first
// write carries the caller-passed site id (a designed-but-never-provisioned
// controller has no registry row to read it from — that lookup used to 404).
import assert from "node:assert";
import { DeviceBackendService } from "../src/app/device/device-backend.service";
import { BackendService } from "../src/app/core/services/backend.service";

interface FetchCall { url: string; method: string; body: Record<string, unknown> }

function stubFetch(calls: FetchCall[], ok = true, status = 200): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return { ok, status } as Response;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const main = async () => {

// --- On-device: one config_set per entry, in patch order, full envelope. --------
{
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    const svc = new DeviceBackendService();
    await svc.writeControllerConfig("site-1", "ctrl-1", { flow_watchdog_s: 30, max_runtime_min: 45 });
    assert.equal(calls.length, 2, "one command per patch entry");
    for (const [i, [key, value]] of Object.entries({ flow_watchdog_s: 30, max_runtime_min: 45 }).entries()) {
      const c = calls[i];
      assert.equal(c.url, "/local/command", "posts to the device command endpoint");
      assert.equal(c.method, "POST");
      assert.equal(c.body.action, "config_set", "local-lane config action");
      assert.equal(c.body.actor, "local-ui", "on-device actor tag");
      assert.equal(c.body.key, key, "kv key rides the envelope");
      assert.equal(c.body.value, value, "kv value rides the envelope");
      assert.equal(typeof c.body.command_id, "string", "client-minted command id");
    }
    assert.notEqual(calls[0].body.command_id, calls[1].body.command_id, "each command gets its own id");
  } finally {
    restore();
  }
}

// --- On-device: empty patch is a no-op (no fetch at all). ------------------------
{
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls);
  try {
    const svc = new DeviceBackendService();
    await svc.writeControllerConfig("site-1", "ctrl-1", {});
    assert.equal(calls.length, 0, "empty patch sends nothing");
  } finally {
    restore();
  }
}

// --- On-device: a refused command rejects (the editor surfaces the failure). -----
{
  const calls: FetchCall[] = [];
  const restore = stubFetch(calls, false, 503);
  try {
    const svc = new DeviceBackendService();
    await assert.rejects(() => svc.writeControllerConfig("site-1", "ctrl-1", { flow_watchdog_s: 30 }), /refused|503/i);
    assert.equal(calls.length, 1, "stops at the first refusal");
  } finally {
    restore();
  }
}

// --- Cloud: existing row → merge into the desired bag and update. ----------------
{
  const svc = new BackendService();
  const writes: { op: string; args: unknown[] }[] = [];
  const fakePb = {
    filter: (s: string) => s,
    collection: (name: string) => ({
      getFirstListItem: async () =>
        name === "controller_config" ? { id: "cfg-9", desired: { claim_lease_s: 30 } } : Promise.reject(new Error("no")),
      update: async (...args: unknown[]) => { writes.push({ op: `update:${name}`, args }); },
      create: async (...args: unknown[]) => { writes.push({ op: `create:${name}`, args }); },
    }),
  };
  (svc as unknown as { pb: unknown }).pb = fakePb;
  await svc.writeControllerConfig("site-7", "ctrl-1", { flow_watchdog_s: 12 });
  assert.equal(writes.length, 1, "one write");
  assert.equal(writes[0].op, "update:controller_config", "existing row is updated, not created");
  assert.equal(writes[0].args[0], "cfg-9", "updates the found row");
  assert.deepEqual(
    (writes[0].args[1] as { desired: Record<string, number> }).desired,
    { claim_lease_s: 30, flow_watchdog_s: 12 },
    "patch merges over the existing desired bag",
  );
}

// --- Cloud: no row → create, carrying the caller-passed site id. -------------
{
  const svc = new BackendService();
  const writes: { op: string; args: unknown[] }[] = [];
  const fakePb = {
    filter: (s: string) => s,
    collection: (name: string) => ({
      getFirstListItem: async () => Promise.reject(new Error("404")),
      update: async (...args: unknown[]) => { writes.push({ op: `update:${name}`, args }); },
      create: async (...args: unknown[]) => { writes.push({ op: `create:${name}`, args }); },
    }),
  };
  (svc as unknown as { pb: unknown }).pb = fakePb;
  await svc.writeControllerConfig("site-7", "ctrl-1", { flow_watchdog_s: 12 });
  assert.equal(writes.length, 1, "one write");
  assert.equal(writes[0].op, "create:controller_config", "missing row is created");
  assert.deepEqual(
    writes[0].args[0],
    { site: "site-7", controller: "ctrl-1", desired: { flow_watchdog_s: 12 } },
    "create carries the passed site id, the controller id, and the patch as desired",
  );
}

console.log("device-config-write: all assertions passed");
};
void main();
