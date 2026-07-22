// initiator: the single viewer-relative "who did it" rule. Pins the reserved
// device actors (panel / local-ui — no users/owners row anywhere, so they must
// resolve from RESERVED_ACTOR_LABELS and render via the DEVICE origin, not fall
// through to the Support warning chip), alongside the unchanged behaviour for
// real users and unknown ids.
import assert from "node:assert";
import { displayOrigin, formatInitiator, resolveInitiator, type InitiatorCtx } from "../src/app/pages/dashboard/widgets/initiator";
import { RESERVED_ACTOR_LABELS } from "../src/lib/index";

const ctx: InitiatorCtx = {
  meId: "user_me",
  meEmail: "me@x.com",
  owners: new Set(["user_me", "user_jane"]),
  people: new Map([["user_jane", { name: "Jane", email: "jane@x.com" }]]),
};

// Reserved actors: a panel-button run arrives with wire origin MANUAL and an
// actor id that is nobody — it must read "Panel button" (bare, no "by", no
// warning styling), never "Support".
{
  const panel = resolveInitiator({ origin: "MANUAL", actorId: "panel", actorName: "Panel button" }, ctx);
  assert.equal(panel.label, "Panel button");
  assert.equal(panel.support, false, "a device source never gets the warning chip");
  const origin = displayOrigin("MANUAL", "panel");
  assert.equal(origin, "DEVICE", "reserved actors render via the DEVICE path");
  assert.equal(formatInitiator(origin, panel.label), "Panel button", "bare label, no 'by'");

  const localUi = resolveInitiator({ origin: "MANUAL", actorId: "local-ui", actorName: "On-device dashboard" }, ctx);
  assert.equal(localUi.label, "On-device dashboard");
  assert.equal(localUi.support, false);
  assert.equal(formatInitiator(displayOrigin("MANUAL", "local-ui"), localUi.label), "On-device dashboard");

  // The labels stay in lockstep with the shared map (the server labels the same
  // ids at ingest; the on-device feed reads the same map).
  assert.equal(panel.label, RESERVED_ACTOR_LABELS["panel"]);
  assert.equal(localUi.label, RESERVED_ACTOR_LABELS["local-ui"]);
}

// A real co-owner still resolves via the owner set, with the MANUAL "by"
// phrasing and their name (not the raw id) — cloud behaviour unchanged.
{
  const jane = resolveInitiator({ origin: "MANUAL", actorId: "user_jane", actorName: "jane@x.com" }, ctx);
  assert.equal(jane.label, "Jane");
  assert.equal(jane.support, false);
  assert.equal(displayOrigin("MANUAL", "user_jane"), "MANUAL", "real users keep their wire origin");
  assert.equal(formatInitiator("MANUAL", jane.label), "by Jane");

  const me = resolveInitiator({ origin: "MANUAL", actorId: "user_me" }, ctx);
  assert.equal(me.label, "you");
  assert.equal(formatInitiator("MANUAL", me.label), "you");
}

// An unknown id (an admin who took control) still falls through to Support,
// warning styling and all, and keeps its wire origin.
{
  const outsider = resolveInitiator({ origin: "MANUAL", actorId: "admin_xyz", actorName: "Root" }, ctx);
  assert.equal(outsider.label, "Support");
  assert.equal(outsider.support, true);
  assert.equal(displayOrigin("MANUAL", "admin_xyz"), "MANUAL", "unknown ids keep their wire origin");
}

console.log("initiator: all tests passed");
