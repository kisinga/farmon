#pragma once
// Pure SSE/HTTP-chunk framing + per-client send bookkeeping for maji_local_ui — no
// esphome, no id(), host-testable (firmware/test/local_ui_frame_test.cpp). The shell
// (maji_local_ui.cpp) owns the sockets and the slot claim/release flags; this only
// formats the bytes and tracks how far they got.
#include <cstddef>
#include <cstdint>
#include <string>

namespace maji_localui {

// Frame one single-line SSE event as one HTTP/1.1 chunk (the esp-idf httpd response
// for an event stream is chunked; each event rides one chunk so a partial send never
// splits the SSE grammar):
//
//   "<hex payload len>\r\n" + "data: " + <message> + "\r\n\r\n" + "\r\n"
//
// The snapshot JSON never contains a raw newline (JSON escapes them), so one data:
// line per event is correct here — there is deliberately no multi-line splitting.
std::string sse_frame(const std::string &message);

// One SSE client's unsent-frame bookkeeping — the coalesce / partial-send / stall
// state machine as plain data. All access is main-loop only (the shell's slot flags
// are the atomic part, not this).
struct SseSlot {
  std::string pending;      // framed event not yet fully sent (coalesced)
  size_t sent{0};           // bytes of pending already written
  uint16_t failures{0};     // consecutive would-block flushes
  bool closing{false};      // stall close requested — waiting for httpd's free_ctx
  uint32_t connected_ms{0}; // millis() at claim — the ghost-slot bounds below key off it
};

// --- Ghost-slot bounds ---------------------------------------------------------
// A dead-but-unclosed peer (phone asleep, lid closed, WiFi drop) still ACCEPTS
// sends into the kernel buffer, so write-error stall detection alone can hold a
// slot hostage for hours. Two bounds, both closing via httpd (free_ctx reaps):
//   1. sse_expired — a hard session age cap; healthy clients reconnect instantly,
//      a ghost is always reaped within the cap.
//   2. sse_oldest — when a new client connects and every slot is busy, the oldest
//      is sacrificed (LRU purge) so a live dashboard can always get back in.

// Age-cap check, wraparound-safe (uint32 subtraction).
bool sse_expired(uint32_t now_ms, uint32_t connected_ms, uint32_t max_age_ms);

// Index of the used slot with the oldest connected_ms, or -1 when none is used.
// `connected`/`used` are parallel arrays of the shell's sessions.
int sse_oldest(const uint32_t connected[], const bool used[], int n);

// Coalesce a new snapshot onto the slot: an UNSENT pending frame is replaced (snapshots
// are full-state re-assertions — only the newest is ever worth sending, and pending RAM
// stays bounded at one frame per client). A partially-sent one finishes first: swapping
// mid-chunk would corrupt the stream, and the next snapshot self-heals. A slot waiting
// on close takes nothing new.
void sse_offer(SseSlot &s, const std::string &message);

// True while the slot has bytes left to write.
bool sse_has_pending(const SseSlot &s);

// How one non-blocking write attempt ended.
enum class SseWrite { kProgress, kBlocked, kFailed };

// What the shell must do after folding a write result in: keep writing this pass, stop
// until the next loop pass, or close the stalled socket (httpd_sess_trigger_close —
// the free_ctx callback then releases the slot, the shell never drops it itself).
enum class SseFlush { kAgain, kWait, kClose };

// Fold one write attempt into the slot (`wrote` is the byte count for kProgress). A
// kProgress that finishes the frame resets the slot for the next offer. kBlocked past
// max_failures marks the slot closing and returns kClose — after that the slot's only
// exit is the destroy callback.
SseFlush sse_flush_fold(SseSlot &s, SseWrite w, size_t wrote, uint16_t max_failures);

// --- Static app assets ---------------------------------------------------------
// The generated local-ui-assets.h embeds the device-mode app as a flat table of
// gzipped files; the shell (canHandle/handleRequest) routes GETs through these.

// One embedded file. data is gzipped and lives in flash (PROGMEM); path is the
// served URL path, "/" being the index (the SPA entry point).
struct LocalUiAsset {
  const char *path;
  const uint8_t *data;
  size_t len;
  const char *content_type;
  bool immutable;  // content-hashed filename — safe to cache forever
};

// Exact path lookup, nullptr on a miss.
const LocalUiAsset *find_asset(const LocalUiAsset *assets, size_t count, const std::string &path);

// Which asset a GET is served, or nullptr for a strict 404:
//   - "/local" itself and anything under /local/ (the API namespace) never fall
//     back — always 404 here (the shell exact-matches the registered endpoints
//     like /local/state before this is consulted);
//   - an exact table match wins;
//   - "/", "/index.html", and any other extension-less path serve the index —
//     SPA client-route fallback, so deep-links and refreshes load the app;
//   - anything else (a missing file WITH an extension) is a 404.
// .map files are never in the table (the codegen excludes them), so they 404.
const LocalUiAsset *resolve_get(const LocalUiAsset *assets, size_t count, const std::string &url);

// MIME type by file extension — the same mapping the codegen stamps into the
// table, kept here so the host tests pin both sides to identical strings.
const char *content_type_for(const std::string &path);

}  // namespace maji_localui
