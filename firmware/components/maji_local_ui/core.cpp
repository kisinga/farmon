#include "core.h"
#include <cstdio>

namespace maji_localui {

std::string sse_frame(const std::string &message) {
  // SSE payload: one data line + the blank-line event terminator.
  std::string payload = "data: " + message + "\r\n\r\n";
  // Chunk header: hex payload length (no leading zeros is valid HTTP/1.1 chunking).
  char hdr[16];
  int n = snprintf(hdr, sizeof(hdr), "%zx\r\n", payload.size());
  return std::string(hdr, n) + payload + "\r\n";
}

void sse_offer(SseSlot &s, const std::string &message) {
  if (s.closing || s.sent != 0)
    return;
  s.pending = sse_frame(message);
}

bool sse_has_pending(const SseSlot &s) { return s.sent < s.pending.size(); }

SseFlush sse_flush_fold(SseSlot &s, SseWrite w, size_t wrote, uint16_t max_failures) {
  if (w == SseWrite::kProgress) {
    s.sent += wrote;
    s.failures = 0;
    if (!sse_has_pending(s)) {  // frame fully written — reset for the next offer
      s.pending.clear();
      s.sent = 0;
    }
    return SseFlush::kAgain;
  }
  if (w == SseWrite::kFailed)
    return SseFlush::kWait;  // a real error: httpd closes the session → destroy releases us
  if (++s.failures >= max_failures) {
    s.closing = true;  // the shell triggers the close; free_ctx is the only release
    return SseFlush::kClose;
  }
  return SseFlush::kWait;
}

}  // namespace maji_localui
