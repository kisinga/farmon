#include "meter.h"
#include "core.h"  // json_esc (shared with the control kernel)
#include <algorithm>
#include <cstdio>

namespace maji_meter {

void MeterState::init(int num_flow_sensors, int num_slots) {
  counters.assign(num_flow_sensors < 0 ? 0 : num_flow_sensors, Counter{});
  open.assign(num_slots < 0 ? 0 : num_slots, OpenRun{});
  outbox.clear();
  outbox.reserve(OUTBOX_CAP);
}

void stamp_epoch(MeterState &m, uint32_t trusted_epoch) {
  if (m.run_epoch == 0 && trusted_epoch > 0) m.run_epoch = trusted_epoch;
}

void on_reading(MeterState &m, int sensor, uint32_t raw_cumulative, uint32_t units_per_litre) {
  if (sensor < 0 || sensor >= (int) m.counters.size() || units_per_litre == 0) return;
  Counter &c = m.counters[sensor];
  if (!c.seeded) {  // first reading after a fresh provision: baseline, don't count history
    c.last_raw = raw_cumulative;
    c.seeded = true;
    return;
  }
  // A drop means the source reset (a local counter zeroing on reboot, a sensor reset, or
  // a rollover). Re-baseline; only the unread sub-sample is lost (bounded by the sample
  // interval — sub-litre at any sane rate). An external totalizer that kept counting
  // across our reboot does NOT drop, so its delta is captured with no loss.
  uint32_t delta = (raw_cumulative >= c.last_raw) ? (raw_cumulative - c.last_raw) : 0;
  c.last_raw = raw_cumulative;
  uint64_t units = (uint64_t) c.remainder + delta;
  c.litres += units / units_per_litre;
  c.remainder = (uint32_t) (units % units_per_litre);
}

uint64_t litres(const MeterState &m, int sensor) {
  return (sensor >= 0 && sensor < (int) m.counters.size()) ? m.counters[sensor].litres : 0;
}

bool open_run(MeterState &m, int slot, int route, int flow_sensor, const std::string &origin,
              const std::string &actor, uint32_t start_epoch, uint32_t run_start_ms) {
  if (slot < 0 || slot >= (int) m.open.size()) return false;
  if (m.run_epoch == 0) return false;  // no lineage stamp yet — an unbillable run
  OpenRun &o = m.open[slot];
  o = OpenRun{};
  o.active = true;
  o.epoch = m.run_epoch;
  o.seq = ++m.run_seq;
  o.route = route;
  o.flow_sensor = flow_sensor;
  o.origin = origin;
  o.actor = actor;
  o.start_epoch = start_epoch;
  o.run_start_ms = run_start_ms;
  o.start_litres = (flow_sensor >= 0) ? litres(m, flow_sensor) : 0;
  return true;
}

int64_t open_delivered(const MeterState &m, int slot) {
  if (slot < 0 || slot >= (int) m.open.size()) return -1;
  const OpenRun &o = m.open[slot];
  if (!o.active || o.flow_sensor < 0) return -1;
  return (int64_t) litres(m, o.flow_sensor) - (int64_t) o.start_litres;
}

void close_run(MeterState &m, int slot, const std::string &stop_reason, const std::string &fault,
               uint32_t end_epoch, uint32_t now_ms) {
  if (slot < 0 || slot >= (int) m.open.size()) return;
  OpenRun &o = m.open[slot];
  if (!o.active) return;  // PREPARING->IDLE (never ran) etc. — nothing billable opened
  RunRecord r;
  r.epoch = o.epoch;
  r.seq = o.seq;
  r.route = o.route;
  r.origin = o.origin;
  r.actor = o.actor;
  r.start_epoch = o.start_epoch;
  r.end_epoch = end_epoch;
  r.duration_s = (now_ms >= o.run_start_ms) ? (now_ms - o.run_start_ms) / 1000u : 0;
  r.stop_reason = stop_reason;
  r.fault = fault;
  r.metered = (o.flow_sensor >= 0);
  r.start_litres = o.start_litres;
  r.end_litres = r.metered ? litres(m, o.flow_sensor) : 0;
  if ((int) m.outbox.size() >= OUTBOX_CAP) {  // overflow: drop oldest, count it loudly
    m.outbox.erase(m.outbox.begin());
    m.dropped++;
  }
  m.outbox.push_back(r);
  o = OpenRun{};
}

void on_ack(MeterState &m, uint32_t epoch, uint32_t seq) {
  if (epoch > m.acked_epoch || (epoch == m.acked_epoch && seq > m.acked_seq)) {
    m.acked_epoch = epoch;
    m.acked_seq = seq;
  }
  const uint32_t ae = m.acked_epoch, as = m.acked_seq;
  m.outbox.erase(std::remove_if(m.outbox.begin(), m.outbox.end(), [ae, as](const RunRecord &r) {
                   return r.epoch < ae || (r.epoch == ae && r.seq <= as);
                 }),
                 m.outbox.end());
}

int serialize_runs(const MeterState &m, char *buf, int cap) {
  if (cap <= 0) return 0;
  int n = 0;
  buf[0] = '\0';
  for (size_t i = 0; i < m.outbox.size(); i++) {
    const RunRecord &r = m.outbox[i];
    const char *sep = (i == 0) ? "" : ",";
    // Field-by-field: json_esc returns a single shared static buffer, so each escaped
    // value must be consumed by its own snprintf before the next json_esc call.
    n += snprintf(buf + n, cap - n, "%s{\"run_id\":\"%u:%u\",\"route\":%d,\"epoch\":%u,\"seq\":%u,",
                  sep, r.epoch, r.seq, r.route, r.epoch, r.seq);
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n, "\"origin\":\"%s\",", maji_ctl::json_esc(r.origin.c_str()));
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n, "\"actor\":\"%s\",", maji_ctl::json_esc(r.actor.c_str()));
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n, "\"started_at\":%u,\"ended_at\":%u,\"duration_s\":%u,",
                  r.start_epoch, r.end_epoch, r.duration_s);
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n, "\"stop_reason\":\"%s\",", maji_ctl::json_esc(r.stop_reason.c_str()));
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n, "\"fault\":\"%s\",", maji_ctl::json_esc(r.fault.c_str()));
    if (n >= cap) break;
    n += snprintf(buf + n, cap - n,
                  "\"start_litres\":%llu,\"end_litres\":%llu,\"metered\":%s}",
                  (unsigned long long) r.start_litres, (unsigned long long) r.end_litres,
                  r.metered ? "true" : "false");
    if (n >= cap) break;
  }
  return n;
}

}  // namespace maji_meter
