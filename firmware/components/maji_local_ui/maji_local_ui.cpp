#include "maji_local_ui.h"
#include "esphome/core/log.h"
#include <cerrno>
#include <cstdio>
#include <sys/socket.h>

namespace esphome {
namespace maji_local_ui {

static const char *const TAG = "localui";

void MajiLocalUi::setup() {
  base_->set_port(port_);
  // Refcounted init: shares the one AsyncWebServer with captive_portal (which
  // init/deinit's it around AP mode). Handlers registered here survive that —
  // add_handler_without_auth appends to the base's list, and init() (re)binds it.
  base_->init();
  base_->add_handler(this);
}

void MajiLocalUi::loop() {
  for (auto &s : sessions_) {
    if (!s.used.load())
      continue;
    if (s.fd.load() == 0) {  // destroy callback fired — the ONLY path that releases a slot.
      s.slot = maji_localui::SseSlot{};  // free_ctx marks dead on the httpd task; the reap
      s.used.store(false);               // stays on the loop thread, so a fresh claim can't
      continue;                          // reset the slot under a mid-flight flush
    }
    if (s.slot.closing)  // close requested — waiting for httpd's free_ctx
      continue;
    if (s.need_initial) {  // a freshly connected client gets the current snapshot first
      s.need_initial = false;
      if (!last_snapshot_.empty())
        sse_send_(s, last_snapshot_.c_str());
    }
    sse_flush_(s);
  }
}

bool MajiLocalUi::canHandle(AsyncWebServerRequest *request) const {
  char url_buf[AsyncWebServerRequest::URL_BUF_SIZE];
  StringRef url = request->url_to(url_buf);
  if (request->method() == HTTP_GET) {
    if (url == "/local/state")
      return true;
    // Exact asset hit, or the SPA navigation fallback (extension-less GET outside
    // /local/ → the index). "/local" itself, /local/* misses, and missing files
    // WITH an extension stay strict 404s; .map files are never in the table.
    // Rules live in the core.
    return maji_localui::resolve_get(assets_, assets_count_, url.str()) != nullptr;
  }
  if (request->method() == HTTP_POST)
    return url == "/local/command" || url == "/local/automations";
  return false;
}

void MajiLocalUi::handleRequest(AsyncWebServerRequest *request) {
  char url_buf[AsyncWebServerRequest::URL_BUF_SIZE];
  StringRef url = request->url_to(url_buf);
  if (request->method() == HTTP_GET) {
    if (url == "/local/state")
      return this->handle_state_(request);
    return this->handle_asset_(request);  // table hit, "/", or SPA client route
  }
  if (url == "/local/command")
    return this->handle_command_(request);
  return this->handle_automations_(request);  // "/local/automations"
}

// --- GET <asset> — the gzipped app files ---------------------------------------

void MajiLocalUi::handle_asset_(AsyncWebServerRequest *request) {
  char url_buf[AsyncWebServerRequest::URL_BUF_SIZE];
  const auto *asset = maji_localui::resolve_get(assets_, assets_count_, request->url_to(url_buf).str());
  if (asset == nullptr) {  // canHandle already guaranteed a hit — belt and braces
    send_json_(request, 404, "{\"error\":\"not_found\"}");
    return;
  }
  // Served straight from flash (PROGMEM is a no-op on esp-idf) — no copy, no chunking
  // needed: the response is one contiguous rodata range.
  auto *res = request->beginResponse(200, asset->content_type, asset->data, asset->len);
  res->addHeader("Content-Encoding", "gzip");
  // Content-hashed filenames can be cached forever; the index (and anything else
  // unhashed) must revalidate so an OTA app update is picked up immediately.
  res->addHeader("Cache-Control", asset->immutable ? "max-age=31536000, immutable" : "no-cache");
  request->send(res);
}

// --- GET /local/state — SSE snapshot stream ------------------------------------

void MajiLocalUi::handle_state_(AsyncWebServerRequest *request) {
  int slot = -1;
  for (int i = 0; i < MAX_SSE_CLIENTS; i++) {
    if (!sessions_[i].used.load()) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {  // heap precedent (networking.ts): never let open streams pile up
    send_json_(request, 503, "{\"error\":\"sse_busy\"}");
    return;
  }
  httpd_req_t *req = *request;
  httpd_resp_set_status(req, HTTPD_200);
  httpd_resp_set_type(req, "text/event-stream");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
  httpd_resp_set_hdr(req, "Connection", "keep-alive");
  httpd_resp_send_chunk(req, "\r\n", 2);  // open the chunked stream

  SseSession &s = sessions_[slot];
  s.hd = req->handle;
  s.fd.store(httpd_req_to_sockfd(req));
  s.need_initial = true;
  s.slot = maji_localui::SseSlot{};  // slot is unclaimed, so the main loop isn't touching it yet
  req->sess_ctx = &s;
  req->free_ctx = &MajiLocalUi::sse_destroy_;
  httpd_sess_set_send_override(s.hd, s.fd.load(), &MajiLocalUi::nonblocking_send_);
  s.used.store(true);  // claim LAST — the main loop only reads used slots
}

void MajiLocalUi::sse_destroy_(void *ptr) {
  auto *s = static_cast<SseSession *>(ptr);
  // httpd fires free_ctx exactly once per session, when the session is torn down — so a
  // dead mark can only come from THIS connection's close, never from a stall decision.
  // Mark only (same idiom as web_server_idf's AsyncEventSourceResponse::destroy): the
  // main loop reaps the slot, keeping every string/slot mutation on the loop thread.
  s->fd.store(0);
}

// Same non-blocking send web_server_idf installs for its own event source: a full TCP
// buffer yields EAGAIN instead of blocking the caller (watchdog protection).
int MajiLocalUi::nonblocking_send_(httpd_handle_t hd, int sockfd, const char *buf, size_t buf_len, int flags) {
  if (buf == nullptr)
    return HTTPD_SOCK_ERR_INVALID;
  int ret = send(sockfd, buf, buf_len, flags | MSG_DONTWAIT);
  if (ret < 0) {
    if (errno == EAGAIN || errno == EWOULDBLOCK)
      return HTTPD_SOCK_ERR_TIMEOUT;
    ESP_LOGD(TAG, "SSE send error: errno %d", errno);
    return HTTPD_SOCK_ERR_FAIL;
  }
  return ret;
}

void MajiLocalUi::push_snapshot(const char *json) {
  last_snapshot_ = json;
  for (auto &s : sessions_) {
    if (s.used.load() && s.fd.load() != 0)
      sse_send_(s, json);
  }
}

void MajiLocalUi::sse_send_(SseSession &s, const char *json) {
  // Coalesce rules live in the pure core (core.h): an unsent pending frame is replaced,
  // a partially-sent one finishes first, a closing slot takes nothing.
  maji_localui::sse_offer(s.slot, json);
  sse_flush_(s);
}

void MajiLocalUi::sse_flush_(SseSession &s) {
  if (s.slot.closing)
    return;  // close already requested — waiting for httpd's free_ctx
  while (maji_localui::sse_has_pending(s.slot)) {
    int w = httpd_socket_send(s.hd, s.fd.load(), s.slot.pending.data() + s.slot.sent,
                              s.slot.pending.size() - s.slot.sent, 0);
    // EAGAIN (full TCP buffer) → kBlocked, retry next loop pass; a real error → httpd
    // closes the session itself and the destroy callback marks the slot dead.
    auto oc = w > 0                        ? maji_localui::SseWrite::kProgress
              : w == HTTPD_SOCK_ERR_TIMEOUT ? maji_localui::SseWrite::kBlocked
                                            : maji_localui::SseWrite::kFailed;
    switch (maji_localui::sse_flush_fold(s.slot, oc, w > 0 ? (size_t) w : 0, MAX_SEND_FAILURES)) {
      case maji_localui::SseFlush::kAgain:
        continue;
      case maji_localui::SseFlush::kClose:
        // Stalled peer: ask httpd to tear the session down (safe from any task). The
        // socket closes AND free_ctx fires, so the reap path in loop() releases the
        // slot — we never drop it ourselves, and the socket doesn't leak.
        ESP_LOGW(TAG, "SSE client stalled — closing");
        httpd_sess_trigger_close(s.hd, s.fd.load());
        return;
      case maji_localui::SseFlush::kWait:
      default:
        return;
    }
  }
}

// --- POST bodies ---------------------------------------------------------------
// web_server_idf pre-reads only form-urlencoded bodies; a JSON / octet-stream POST
// reaches the handler with the body still on the socket (see its request_post_handler
// fallback). Read it here, capped BEFORE allocation.

bool MajiLocalUi::read_body_(AsyncWebServerRequest *request, std::string &out, size_t cap) {
  httpd_req_t *req = *request;
  size_t total = req->content_len;
  if (total == 0 || total > cap)
    return false;
  out.resize(total);
  size_t got = 0;
  while (got < total) {
    int r = httpd_req_recv(req, &out[got], total - got);
    if (r <= 0) {  // TIMEOUT or connection closed
      out.clear();
      return false;
    }
    got += r;
  }
  return true;
}

void MajiLocalUi::send_json_(AsyncWebServerRequest *request, uint16_t code, const std::string &body) {
  httpd_req_t *req = *request;
  // AsyncWebServerRequest::send maps any code outside 200/404/409 to a 500 status
  // line, so set it ourselves — the contract needs real 4xx codes.
  char status[24];
  const char *reason = code == 200   ? "OK"
                       : code == 400 ? "Bad Request"
                       : code == 409 ? "Conflict"
                       : code == 503 ? "Service Unavailable"
                                     : nullptr;
  if (reason != nullptr)
    snprintf(status, sizeof(status), "%u %s", code, reason);
  else  // a bare numeric code is a valid status line — never mislabel it as a 500
    snprintf(status, sizeof(status), "%u", code);
  httpd_resp_set_status(req, status);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, body.c_str(), (int) body.size());
}

void MajiLocalUi::handle_command_(AsyncWebServerRequest *request) {
  std::string body;
  if (!read_body_(request, body, MAX_COMMAND_BODY))
    return send_json_(request, 400, "{\"error\":\"bad_body\"}");
  if (!command_handler_)
    return send_json_(request, 503, "{\"error\":\"not_ready\"}");
  std::string reply;
  uint16_t code = command_handler_(body, reply);
  send_json_(request, code, reply);
}

void MajiLocalUi::handle_automations_(AsyncWebServerRequest *request) {
  std::string body;
  if (!read_body_(request, body, maji_auto::MAX_AUTOMATION_SET_BYTES))
    return send_json_(request, 400, "{\"error\":\"bad_body\"}");
  if (!automations_handler_)
    return send_json_(request, 503, "{\"error\":\"not_ready\"}");
  uint16_t code = automations_handler_((const uint8_t *) body.data(), body.size());
  send_json_(request, code, code == 200 ? "{}" : "{\"error\":\"rejected\"}");
}

void MajiLocalUi::dump_config() {
  size_t total = 0;
  for (size_t i = 0; i < assets_count_; i++)
    total += assets_[i].len;
  ESP_LOGCONFIG(TAG, "MajiLocalUi: port=%u, assets=%u (%u B gz), command handler %s, automations handler %s", port_,
                (unsigned) assets_count_, (unsigned) total, command_handler_ ? "installed" : "MISSING",
                automations_handler_ ? "installed" : "MISSING");
}

}  // namespace maji_local_ui
}  // namespace esphome
