// Host test for the pure SSE core of maji_local_ui (firmware/components/maji_local_ui/core.cpp).
// Covers both halves the shell wires to sockets:
//   1. Framing — the one-chunk-per-event layout written to the socket: hex chunk length
//      header, a single data: line (snapshots are single-line JSON), the blank-line
//      event terminator, and the chunk-closing CRLF.
//   2. Slot bookkeeping — the coalesce / partial-send / stall state machine behind
//      sse_send_/sse_flush_, including the stall-drop lifecycle: claim → offer →
//      blocked flushes → kClose (the shell triggers httpd close) → closing slot takes
//      nothing new → destroy/reap → a fresh claim is unaffected by the old state.
//   3. Asset routing — the generated-table lookup behind canHandle/handle_asset_:
//      exact hits, "/" → index, SPA navigation fallback, the strict /local
//      namespace and missing-file 404s, .map never served, and the
//      extension→MIME mapping the codegen stamps into the table.
// No esphome needed.
//
//   bash firmware/test/run-host-tests.sh
#include "core.h"
#include <cstdio>
#include <cstring>
#include <string>

using maji_localui::LocalUiAsset;
using maji_localui::SseFlush;
using maji_localui::SseSlot;
using maji_localui::SseWrite;
using maji_localui::content_type_for;
using maji_localui::find_asset;
using maji_localui::resolve_get;
using maji_localui::sse_expired;
using maji_localui::sse_flush_fold;
using maji_localui::sse_frame;
using maji_localui::sse_has_pending;
using maji_localui::sse_offer;
using maji_localui::sse_oldest;

static int pass = 0, fail = 0;
static void check(bool c, const char *name) {
  if (c) { printf("  ok   %s\n", name); pass++; }
  else { printf("  FAIL %s\n", name); fail++; }
}

static void test_framing() {
  const std::string msg = R"({"ts":123,"readings":{"flow":1.5},"routes":[]})";
  const std::string frame = sse_frame(msg);
  const std::string payload = "data: " + msg + "\r\n\r\n";

  // "<hex>\r\n" + payload + "\r\n"
  char expect_hdr[16];
  snprintf(expect_hdr, sizeof(expect_hdr), "%zx\r\n", payload.size());
  check(frame.compare(0, strlen(expect_hdr), expect_hdr) == 0, "chunk header is the hex payload length");
  check(frame.compare(strlen(expect_hdr), payload.size(), payload) == 0, "payload is one data: line + blank-line terminator");
  check(frame.compare(frame.size() - 2, 2, "\r\n") == 0, "chunk closes with CRLF");
  check(frame.size() == strlen(expect_hdr) + payload.size() + 2, "total length is exact (no slack)");

  // The event is self-terminating for an SSE parser: the double CRLF ends the event.
  check(frame.find("\r\n\r\n") != std::string::npos, "event terminator present");

  // Empty message frames as an empty data: line (kept out of the stream by callers,
  // but the framing itself stays well-formed).
  const std::string empty = sse_frame("");
  check(empty == "a\r\n" "data: \r\n\r\n" "\r\n", "empty message frames correctly");
}

static void test_coalesce_and_partial_send() {
  SseSlot s;  // a fresh claim starts from a zeroed slot
  sse_offer(s, "one");
  check(sse_has_pending(s), "offer leaves bytes to send");

  // An UNSENT pending frame is replaced by the next snapshot (coalesce).
  sse_offer(s, "two");
  check(s.pending == sse_frame("two"), "unsent pending frame is replaced by the newest snapshot");

  // A PARTIALLY-sent frame is not swapped mid-chunk.
  const size_t half = s.pending.size() / 2;
  check(sse_flush_fold(s, SseWrite::kProgress, half, 250) == SseFlush::kAgain, "partial write keeps flushing");
  check(s.sent == half && sse_has_pending(s), "partial write advances the cursor");
  sse_offer(s, "three");
  check(s.pending == sse_frame("two"), "partially-sent frame is not replaced");

  // Finishing the frame resets the slot for the next offer.
  check(sse_flush_fold(s, SseWrite::kProgress, s.pending.size() - s.sent, 250) == SseFlush::kAgain,
        "final write keeps the flush loop going");
  check(!sse_has_pending(s) && s.pending.empty() && s.sent == 0, "completed frame resets the slot");
  sse_offer(s, "three");
  check(s.pending == sse_frame("three"), "next offer frames cleanly after a completed send");
}

static void test_stall_drop_lifecycle() {
  const uint16_t MAX = 3;  // stand-in for the shell's MAX_SEND_FAILURES
  SseSlot s;               // claim
  sse_offer(s, "snap");
  const std::string pending_at_stall = s.pending;

  // A full TCP buffer: blocked flushes count up, then the core declares a stall.
  check(sse_flush_fold(s, SseWrite::kBlocked, 0, MAX) == SseFlush::kWait, "blocked flush waits for the next pass");
  check(s.failures == 1 && !s.closing, "blocked flush counts a failure");
  // Progress resets the failure counter.
  check(sse_flush_fold(s, SseWrite::kProgress, 1, MAX) == SseFlush::kAgain, "progress keeps flushing");
  check(s.failures == 0, "progress resets the failure counter");

  check(sse_flush_fold(s, SseWrite::kBlocked, 0, MAX) == SseFlush::kWait, "stall: failure 1");
  check(sse_flush_fold(s, SseWrite::kBlocked, 0, MAX) == SseFlush::kWait, "stall: failure 2");
  check(sse_flush_fold(s, SseWrite::kBlocked, 0, MAX) == SseFlush::kClose, "stall: hitting the cap asks for a close");
  check(s.closing, "stall marks the slot closing (shell triggers httpd close)");

  // While closing, the slot takes no new snapshots and never asks for a second close.
  sse_offer(s, "newer");
  check(s.pending == pending_at_stall, "closing slot takes no new offers");
  check(sse_flush_fold(s, SseWrite::kBlocked, 0, MAX) == SseFlush::kClose, "repeat close decision is stable");

  // free_ctx fired → loop() reaps: the released slot is reset exactly like the shell's
  // reap/claim paths do, and a NEW claim inherits nothing from the stalled one.
  s = SseSlot{};
  check(!s.closing && s.failures == 0 && s.sent == 0 && s.pending.empty(), "reap/claim resets all slot state");
  sse_offer(s, "newer");
  check(s.pending == sse_frame("newer"), "new claim sends the newest snapshot, not the stalled frame");
  check(sse_flush_fold(s, SseWrite::kProgress, s.pending.size(), MAX) == SseFlush::kAgain &&
            !sse_has_pending(s),
        "new claim flushes to completion");

  // A hard send error is not a stall: the shell leaves the close to httpd.
  SseSlot e;
  sse_offer(e, "snap");
  check(sse_flush_fold(e, SseWrite::kFailed, 0, MAX) == SseFlush::kWait, "send error waits (httpd closes)");
  check(!e.closing, "send error does not trigger a stall close");
}

// --- Asset routing -------------------------------------------------------------

// A table shaped like the generated one: the index, hashed JS/CSS (immutable), and
// one nested unhashed file. .map files never appear (the codegen excludes them).
static const uint8_t GZ[4] = {0x1f, 0x8b, 0x00, 0x00};
static const LocalUiAsset ASSETS[] = {
    {"/", GZ, sizeof(GZ), "text/html", false},
    {"/main-ABC123XY.js", GZ, sizeof(GZ), "text/javascript", true},
    {"/styles-FHXOZC2R.css", GZ, sizeof(GZ), "text/css", true},
    {"/icons/icon-192.png", GZ, sizeof(GZ), "image/png", false},
};
static const size_t ASSETS_COUNT = sizeof(ASSETS) / sizeof(ASSETS[0]);

static void test_asset_routing() {
  const LocalUiAsset *a = resolve_get(ASSETS, ASSETS_COUNT, "/main-ABC123XY.js");
  check(a == &ASSETS[1], "exact match serves the file");
  check(a != nullptr && strcmp(a->content_type, "text/javascript") == 0, "exact match: js content-type");
  check(a != nullptr && a->immutable, "exact match: hashed bundle is immutable");

  check(resolve_get(ASSETS, ASSETS_COUNT, "/") == &ASSETS[0], "/ serves the index");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/index.html") == &ASSETS[0], "/index.html serves the index");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/site/local/dashboard") == &ASSETS[0],
        "extension-less app route falls back to the index (SPA deep-link)");
  const LocalUiAsset *icon = resolve_get(ASSETS, ASSETS_COUNT, "/icons/icon-192.png");
  check(icon == &ASSETS[3], "nested path serves by full path");
  check(icon != nullptr && !icon->immutable, "unhashed asset is not immutable");

  check(resolve_get(ASSETS, ASSETS_COUNT, "/local") == nullptr, "/local itself is NOT handled (strict 404)");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/local/") == nullptr, "/local/ is NOT handled (strict 404)");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/local/nope") == nullptr, "/local/* miss is NOT handled (strict 404)");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/local/state") == nullptr,
        "/local/state is never an asset (the shell exact-matches the endpoint before this)");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/missing.js") == nullptr,
        "missing asset WITH an extension is NOT handled (404)");
  check(resolve_get(ASSETS, ASSETS_COUNT, "/main-ABC123XY.js.map") == nullptr, ".map is never served");

  check(find_asset(ASSETS, ASSETS_COUNT, "/styles-FHXOZC2R.css") == &ASSETS[2], "find_asset exact hit");
  check(find_asset(ASSETS, ASSETS_COUNT, "/nope") == nullptr, "find_asset miss");

  // An empty table routes nothing (canHandle 404s everything outside /local/state).
  check(resolve_get(ASSETS, 0, "/") == nullptr, "empty table: no index, no fallback");
}

static void test_content_types() {
  // Pin the strings the codegen stamps into the table — both sides must agree.
  check(strcmp(content_type_for("/index.html"), "text/html") == 0, "html → text/html");
  check(strcmp(content_type_for("/main-ABC123XY.js"), "text/javascript") == 0, "js → text/javascript");
  check(strcmp(content_type_for("/styles-FHXOZC2R.css"), "text/css") == 0, "css → text/css");
  check(strcmp(content_type_for("/manifest.webmanifest"), "application/manifest+json") == 0,
        "webmanifest → application/manifest+json");
  check(strcmp(content_type_for("/icons/icon-192.png"), "image/png") == 0, "png → image/png");
  check(strcmp(content_type_for("/fonts/inter-latin-400-normal.woff2"), "font/woff2") == 0, "woff2 → font/woff2");
  check(strcmp(content_type_for("/favicon.ico"), "image/x-icon") == 0, "ico → image/x-icon");
  check(strcmp(content_type_for("/marketing/controller.avif"), "image/avif") == 0, "avif → image/avif");
  check(strcmp(content_type_for("/robots.txt"), "text/plain") == 0, "txt → text/plain");
  check(strcmp(content_type_for("/sitemap.xml"), "application/xml") == 0, "xml → application/xml");
  check(strcmp(content_type_for("/data.bin"), "application/octet-stream") == 0, "unknown → octet-stream");
  check(strcmp(content_type_for("/noextension"), "application/octet-stream") == 0, "no extension → octet-stream");
}

static void test_ghost_bounds() {
  // sse_expired: over the cap is expired, at/under is not, wraparound-safe.
  check(!sse_expired(5000, 1000, 10000), "under cap: not expired");
  check(!sse_expired(11000, 1000, 10000), "at cap: not expired");
  check(sse_expired(11001, 1000, 10000), "over cap: expired");
  check(sse_expired(1000, 0xFFFFFFF0, 1000), "wraparound: age 1016 across overflow > cap");

  // sse_oldest: skips unused, picks the smallest connected_ms, -1 when none used.
  uint32_t connected[2] = {500, 100};
  bool used[2] = {true, true};
  check(sse_oldest(connected, used, 2) == 1, "oldest: smallest connected_ms wins");
  bool one_used[2] = {false, true};
  check(sse_oldest(connected, one_used, 2) == 1, "oldest: unused slot skipped");
  bool none_used[2] = {false, false};
  check(sse_oldest(connected, none_used, 2) == -1, "oldest: none used → -1");
}

int main() {
  test_framing();
  test_coalesce_and_partial_send();
  test_stall_drop_lifecycle();
  test_asset_routing();
  test_content_types();
  test_ghost_bounds();
  printf("%s (%d/%d)\n", fail ? "FAILED" : "PASSED", pass, pass + fail);
  return fail ? 1 : 0;
}
