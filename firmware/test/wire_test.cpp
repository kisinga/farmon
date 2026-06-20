// Host test for the pure wire codec (firmware/components/maji_coord/wire.cpp).
// Proves the interop-critical invariants: exact JSON framing, canonical sig, and
// verify + anti-replay. Compiled with g++ against the OpenSSL-backed mbedtls shim.
//
//   bash firmware/test/run-host-tests.sh
#include "wire.h"
#include <cstdio>
#include <map>
#include <string>

static int pass = 0, fail = 0;
static void check(bool c, const char *name) {
  if (c) { printf("  ok   %s\n", name); pass++; }
  else { printf("  FAIL %s\n", name); fail++; }
}
static std::string str(const std::vector<uint8_t> &v) { return std::string(v.begin(), v.end()); }
// Last "mac":"...." value (16 hex chars).
static std::string mac_of(const std::string &j) { return j.substr(j.rfind("\"mac\":\"") + 7, 16); }

int main() {
  const std::string key = "site-secret", self = "ctrlA";

  // --- Framing: byte-exact with the old build_*_msg format (mac varies, shape fixed).
  uint32_t c1 = 0;
  std::string claim = str(maji_wire::encode_claim(self, key, c1, "pump1"));
  const std::string claimPrefix = "{\"t\":\"claim\",\"node_id\":\"pump1\",\"from\":\"ctrlA\",\"c\":1,\"mac\":\"";
  check(claim.rfind(claimPrefix, 0) == 0, "claim framing prefix exact");
  check(claim.size() == claimPrefix.size() + 16 + 2, "claim: 16-hex mac + closing \"}");
  check(c1 == 1, "encode increments counter");

  uint32_t c2 = 0;
  std::string rel = str(maji_wire::encode_release(self, key, c2, "pump1"));
  check(rel.rfind("{\"t\":\"release\",\"node_id\":\"pump1\",", 0) == 0, "release framing");

  uint32_t c3 = 0;
  std::string rd = str(maji_wire::encode_reading(self, key, c3, "tank1", "level", 12.34f));
  check(rd.find("\"role\":\"level\",\"value\":12.3400,\"mac\":\"") != std::string::npos,
        "reading value is %.4f, unquoted");
  check(rd.rfind("{\"t\":\"reading\",\"node_id\":\"tank1\",\"from\":\"ctrlA\",\"c\":1,", 0) == 0, "reading framing");

  uint32_t c4 = 0;
  std::string held = str(maji_wire::encode_held(self, key, c4, "valve1", "ctrlB,ctrlC"));
  check(held.find("\"who\":\"ctrlB,ctrlC\",\"mac\":\"") != std::string::npos, "held who csv");

  // --- Canonical sig.
  check(maji_wire::sig("claim", "pump1", "ctrlA", 1, "") == "claim|pump1|ctrlA|1", "sig: no extra");
  check(maji_wire::sig("reading", "tank1", "ctrlA", 2, "level|12.3400") == "reading|tank1|ctrlA|2|level|12.3400",
        "sig: with extra");

  // --- verify + anti-replay (ctrlB -> ctrlA).
  std::map<std::string, uint32_t> seen;
  uint32_t bc = 0;
  std::string b1 = str(maji_wire::encode_claim("ctrlB", key, bc, "pump1"));  // c=1
  std::string m1 = mac_of(b1);
  check(maji_wire::verify(key, self, "ctrlB", 1, "claim", "pump1", "", m1, seen), "verify accepts valid frame");
  check(!maji_wire::verify(key, self, "ctrlB", 1, "claim", "pump1", "", m1, seen), "verify rejects replay (same c)");

  std::string b2 = str(maji_wire::encode_claim("ctrlB", key, bc, "pump1"));  // c=2
  check(maji_wire::verify(key, self, "ctrlB", 2, "claim", "pump1", "", mac_of(b2), seen), "verify accepts advanced c");
  check(!maji_wire::verify(key, self, "ctrlB", 2, "claim", "pump1", "", mac_of(b2), seen), "verify rejects replay (c==last)");

  check(!maji_wire::verify(key, self, "ctrlB", 3, "claim", "pump1", "", "0000000000000000", seen),
        "verify rejects forged mac");
  check(!maji_wire::verify(key, self, "ctrlA", 9, "claim", "pump1", "", "0000000000000000", seen),
        "verify rejects our own echo (from == self)");

  // Reboot re-baseline: sender's RAM counter reset (last - c > 4096) is accepted.
  seen["ctrlC"] = 10000;
  uint32_t cc = 0;
  std::string c1f = str(maji_wire::encode_claim("ctrlC", key, cc, "pump1"));  // c=1
  check(maji_wire::verify(key, self, "ctrlC", 1, "claim", "pump1", "", mac_of(c1f), seen),
        "verify accepts reboot re-baseline (10000 - 1 > 4096)");

  // Wrong-key frame is rejected (tampered site key).
  uint32_t wk = 0;
  std::string w = str(maji_wire::encode_claim("ctrlD", "other-key", wk, "pump1"));
  check(!maji_wire::verify(key, self, "ctrlD", 1, "claim", "pump1", "", mac_of(w), seen),
        "verify rejects frame signed with a different key");

  // --- confirmation liveness (cc_<node> goes false on owner silence) ---
  check(maji_wire::confirm_stale(0, 1000, 30000), "never-confirmed (last=0) is stale");
  check(!maji_wire::confirm_stale(1000, 1000, 30000), "just-confirmed is fresh");
  check(!maji_wire::confirm_stale(1000, 30999, 30000), "within timeout is fresh");
  check(maji_wire::confirm_stale(1000, 31000, 30000), "at timeout is stale");
  check(!maji_wire::confirm_stale(0xFFFFFF00u, 0x00000010u, 30000),
        "millis() wraparound: small elapsed across the wrap is fresh");

  printf("\n%d passed, %d failed\n", pass, fail);
  return fail ? 1 : 0;
}
