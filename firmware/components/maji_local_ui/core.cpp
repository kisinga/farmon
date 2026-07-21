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

// --- Static app assets ---------------------------------------------------------

const LocalUiAsset *find_asset(const LocalUiAsset *assets, size_t count, const std::string &path) {
  for (size_t i = 0; i < count; i++) {
    if (path == assets[i].path)
      return &assets[i];
  }
  return nullptr;
}

const LocalUiAsset *resolve_get(const LocalUiAsset *assets, size_t count, const std::string &url) {
  if (url == "/local" || url.rfind("/local/", 0) == 0)
    return nullptr;  // API namespace: misses stay strict 404s, never the app
  if (const LocalUiAsset *a = find_asset(assets, count, url))
    return a;
  const LocalUiAsset *index = find_asset(assets, count, "/");
  if (index == nullptr)
    return nullptr;
  // "/index.html" is the index by name; any other extension-less GET is SPA
  // navigation (deep-link / refresh) and gets the index too.
  if (url == "/index.html" || url.find('.') == std::string::npos)
    return index;
  return nullptr;
}

const char *content_type_for(const std::string &path) {
  const size_t dot = path.rfind('.');
  if (dot == std::string::npos)
    return "application/octet-stream";
  const std::string ext = path.substr(dot + 1);
  if (ext == "html" || ext == "htm") return "text/html";
  if (ext == "js" || ext == "mjs") return "text/javascript";
  if (ext == "css") return "text/css";
  if (ext == "json") return "application/json";
  if (ext == "webmanifest") return "application/manifest+json";
  if (ext == "txt") return "text/plain";
  if (ext == "xml") return "application/xml";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "jpg" || ext == "jpeg") return "image/jpeg";
  if (ext == "gif") return "image/gif";
  if (ext == "webp") return "image/webp";
  if (ext == "avif") return "image/avif";
  if (ext == "ico") return "image/x-icon";
  if (ext == "woff") return "font/woff";
  if (ext == "woff2") return "font/woff2";
  if (ext == "ttf") return "font/ttf";
  if (ext == "otf") return "font/otf";
  if (ext == "pdf") return "application/pdf";
  if (ext == "wasm") return "application/wasm";
  return "application/octet-stream";
}

}  // namespace maji_localui
