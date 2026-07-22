#pragma once
// On-device operator dashboard (maji_local_ui) — replaces the stock ESPHome
// web_server v3 page when the topology's local.ui flag is on. Registers one
// AsyncWebHandler on the shared web_server_base (port 80) and serves:
//
//   GET  <asset path>       — the device-mode app, embedded as a flat table of gzipped
//                             files in the generated local-ui-assets.h (wired via
//                             set_assets). Exact path match → that file
//                             (Content-Encoding: gzip, the table's Content-Type);
//                             "/", "/index.html", and any other extension-less GET
//                             outside /local/ → the index entry (SPA client-route
//                             fallback, so deep-links and refreshes load the app).
//                             Content-hashed assets (immutable=true) get
//                             "Cache-Control: max-age=31536000, immutable"; everything
//                             else "no-cache". "/local" itself and unknown /local/*
//                             stay strict 404s. The routing rules live in the pure
//                             core (core.h).
//   GET  /local/state        — SSE stream of the ControllerSnapshot JSON: the same bytes
//                              publish_snapshot builds for the MQTT state topic. The script
//                              calls push_snapshot() every time it builds one, so the SSE
//                              cadence IS the snapshot cadence (periodic + command fast-path).
//   GET  /local/automations  — the current automation set as the raw wire blob
//                              (application/octet-stream, the exact bytes the POST accepts),
//                              from maji_automations' serving copy — never the live table
//                              (loop-thread only, see the threading note below).
//   POST /local/command      — operator command envelope, dispatched exactly like the MQTT
//                              handler (the generated local-ui.yaml installs command_handler_
//                              with the shared dispatch body from mqtt.ts).
//   POST /local/automations  — raw automation wire blob → maji_automations.apply_set
//                              (validated first; the generated glue installs automations_handler_).
//
// Threading: HTTP handlers run on the esp-idf httpd task. They only parse + gate
// (read-only); every mutation is marshalled to the main loop with defer_to_loop() —
// the route
// engine, claims registry, and automation table are loop-thread only (see the no-lock
// note in maji_automations.h). SSE sends happen on the main loop too (push_snapshot is
// called from the publish_snapshot script).
//
// RAM discipline (see the BLE-bootloop heap precedent in networking.ts): SSE clients
// are capped at 2 fixed slots, each session buffers at most ONE pending snapshot (a new
// snapshot coalesces onto it — snapshots are full-state re-assertions, so a superseded
// one is never worth keeping), and POST bodies are size-capped before allocation.
#include "core.h"
#include "../maji_control/maji_control.h"
#include "../maji_automations/maji_automations.h"
#include "esphome/core/component.h"
#include "esphome/components/web_server_base/web_server_base.h"
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

namespace esphome {
namespace maji_local_ui {

class MajiLocalUi : public AsyncWebHandler, public Component {
 public:
  explicit MajiLocalUi(web_server_base::WebServerBase *base) : base_(base) {}

  void set_control(maji_control::MajiControl *c) { control_ = c; }
  void set_automations(maji_automations::MajiAutomations *a) { autos_ = a; }
  void set_port(uint16_t port) { port_ = port; }

  // The embedded app files — the generated local-ui-assets.h table (PROGMEM in
  // main.cpp). Points into flash rodata; never freed, never copied.
  void set_assets(const maji_localui::LocalUiAsset *assets, size_t count) {
    assets_ = assets;
    assets_count_ = count;
  }

  // Generated glue (local-ui.yaml on_boot) installs both handlers. The command handler
  // parses + TTL-gates the envelope, defers the MQTT-identical dispatch to the main
  // loop, and returns the HTTP status; the automations handler validates the wire blob
  // on a scratch table and defers id(autos).apply_set.
  using CommandHandler = std::function<uint16_t(const std::string &body, std::string &reply)>;
  using AutomationsHandler = std::function<uint16_t(const uint8_t *data, size_t len)>;
  void set_command_handler(CommandHandler f) { command_handler_ = std::move(f); }
  void set_automations_handler(AutomationsHandler f) { automations_handler_ = std::move(f); }

  // Marshal a mutation onto the main loop. Public wrapper: Component::defer() is
  // protected, and the generated handler glue calls this from free lambdas (the
  // httpd task), not from within the class. The route engine, claims registry,
  // and automation table are loop-thread-only — never mutate them on the httpd task.
  void defer_to_loop(std::function<void()> &&f) { defer(std::move(f)); }

  // Snapshot fan-out — called from the publish_snapshot script (main loop) with the
  // same ControllerSnapshot JSON that goes to the MQTT state topic. Stored so a freshly
  // connected SSE client gets the current snapshot immediately.
  void push_snapshot(const char *json);

  void setup() override;
  void loop() override;
  // Same priority as web_server: the server must exist before WiFi connects so the
  // AP fallback can serve pages too.
  float get_setup_priority() const override { return setup_priority::WIFI - 1.0f; }
  void dump_config() override;

  bool canHandle(AsyncWebServerRequest *request) const override;
  void handleRequest(AsyncWebServerRequest *request) override;

 protected:
  // Hard caps. Bodies arrive on the httpd task stack budget, so they are read into
  // heap only after the length is checked.
  static constexpr size_t MAX_COMMAND_BODY = 2048;
  static constexpr int MAX_SSE_CLIENTS = 2;
  // ~4s of loop iterations with a full TCP send buffer before the peer is declared
  // dead (same role as web_server_idf's MAX_CONSECUTIVE_SEND_FAILURES, shorter —
  // our events are periodic full-state snapshots, never backlog-worthy).
  static constexpr uint16_t MAX_SEND_FAILURES = 250;
  // Hard session age cap. Write-error stall detection alone CANNOT see a
  // dead-but-unclosed peer (a phone asleep still ACKs nothing, yet send() succeeds
  // into the kernel buffer — and at ~1 frame per 5s the peer window takes hours to
  // fill). The cap bounds any ghost slot's life to 1h; a healthy client's
  // EventSource reconnects transparently, so the cap is invisible in practice.
  static constexpr uint32_t MAX_SSE_AGE_MS = 3600000;

  // One SSE connection. The slot's string/buffer state is main-loop only; the httpd
  // task touches fd (connect/destroy) and used (claim) — both atomic for that reason.
  // Lifecycle: handle_state_ claims a free slot (used=true LAST); a stall asks httpd to
  // close the session (httpd_sess_trigger_close); httpd's free_ctx (sse_destroy_, fired
  // exactly once per session) marks the fd dead; and only then does loop() reap the
  // slot — so a re-claimed slot can never be zeroed by a stale destroy from the
  // previous connection, and a stalled socket is actually closed, not leaked.
  struct SseSession {
    std::atomic<bool> used{false};
    std::atomic<int> fd{0};
    httpd_handle_t hd{nullptr};
    bool need_initial{false};    // send the stored snapshot on the next loop pass
    maji_localui::SseSlot slot;  // coalesce / partial-send / stall bookkeeping (core.h)
  };

  void handle_asset_(AsyncWebServerRequest *request);
  void handle_state_(AsyncWebServerRequest *request);
  void handle_command_(AsyncWebServerRequest *request);
  void handle_automations_(AsyncWebServerRequest *request);
  void handle_automations_get_(AsyncWebServerRequest *request);

  void sse_send_(SseSession &s, const char *json);  // offer (coalesce) + flush
  void sse_flush_(SseSession &s);                   // push pending bytes out (non-blocking)
  static void sse_destroy_(void *ptr);              // httpd free_ctx: the only slot release
  static int nonblocking_send_(httpd_handle_t hd, int sockfd, const char *buf, size_t buf_len, int flags);

  // esp-idf's server only pre-reads form-urlencoded POST bodies; our JSON/octet-stream
  // bodies are still on the socket when the handler runs — read + cap them here.
  static bool read_body_(AsyncWebServerRequest *request, std::string &out, size_t cap);
  static void send_json_(AsyncWebServerRequest *request, uint16_t code, const std::string &body);

  web_server_base::WebServerBase *base_;
  maji_control::MajiControl *control_{nullptr};
  maji_automations::MajiAutomations *autos_{nullptr};
  uint16_t port_{80};

  const maji_localui::LocalUiAsset *assets_{nullptr};
  size_t assets_count_{0};

  CommandHandler command_handler_{};
  AutomationsHandler automations_handler_{};

  std::string last_snapshot_;  // main-loop only
  SseSession sessions_[MAX_SSE_CLIENTS];
};

}  // namespace maji_local_ui
}  // namespace esphome
