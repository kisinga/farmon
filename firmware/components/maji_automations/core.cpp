#include "core.h"
#include <cstring>
#include <cmath>

namespace maji_auto {

int dow_to_bit(int dow) { return (dow == 1) ? 6 : (dow - 2); }

bool persist_needed(ApplyResult r) { return r == APPLY_OK || r == APPLY_CLEARED; }

size_t consumed_blob_bytes(const uint8_t *data, size_t len) {
  if (data == nullptr || len < (size_t) AUTOMATION_HEADER_BYTES)
    return 0;
  AutomationSetHeader hdr;
  memcpy(&hdr, data, sizeof(hdr));
  if (hdr.magic_version != AUTOMATION_WIRE_MAGIC)
    return 0;
  uint8_t c = hdr.count;
  if (c > MAX_AUTOMATIONS)
    c = MAX_AUTOMATIONS;
  size_t need = (size_t) AUTOMATION_HEADER_BYTES + (size_t) c * AUTOMATION_RECORD_BYTES;
  if (len < need)
    return 0;
  // Trailing id block is optional (same rule as apply_set).
  if (c > 0 && len >= need + (size_t) c * AUTOMATION_ID_BYTES)
    need += (size_t) c * AUTOMATION_ID_BYTES;
  return need;
}

bool persisted_blob_valid(uint32_t magic, size_t len) {
  return magic == AUTOMATION_FLASH_MAGIC && len >= (size_t) AUTOMATION_HEADER_BYTES &&
         len <= MAX_AUTOMATION_SET_BYTES;
}

ApplyResult apply_set(const uint8_t *data, size_t len, uint16_t baked, RuntimeAutomation *table,
                      char ids[][AUTOMATION_ID_BYTES], uint8_t &count) {
  if (data == nullptr || len < (size_t) AUTOMATION_HEADER_BYTES)
    return APPLY_TOO_SMALL;  // keep last-good

  AutomationSetHeader hdr;
  memcpy(&hdr, data, sizeof(hdr));
  if (hdr.magic_version != AUTOMATION_WIRE_MAGIC)
    return APPLY_BAD_MAGIC;  // keep last-good

  uint8_t c = hdr.count;
  if (c > MAX_AUTOMATIONS)
    c = MAX_AUTOMATIONS;

  // An empty set always clears the table, version-agnostic — a delete-to-empty must take
  // effect even if route_set_version drifted (no indices to misapply).
  if (c == 0) {
    count = 0;
    memset(ids, 0, (size_t) MAX_AUTOMATIONS * AUTOMATION_ID_BYTES);
    return APPLY_CLEARED;
  }

  // A non-empty set is refused unless it was authored against this route table.
  if (hdr.route_set_version != baked)
    return APPLY_VERSION_REFUSED;  // keep last-good

  size_t need = (size_t) AUTOMATION_HEADER_BYTES + (size_t) c * AUTOMATION_RECORD_BYTES;
  if (len < need)
    return APPLY_TRUNCATED;  // keep last-good

  memcpy(table, data + AUTOMATION_HEADER_BYTES, (size_t) c * AUTOMATION_RECORD_BYTES);

  // Trailing id block (optional): one fixed AUTOMATION_ID_BYTES ascii field per record,
  // the automation's whole id (echoed as a route's origin actor). A sender without it
  // just stops after the records; we leave the ids zeroed.
  memset(ids, 0, (size_t) MAX_AUTOMATIONS * AUTOMATION_ID_BYTES);
  size_t ids_off = need;
  if (len >= ids_off + (size_t) c * AUTOMATION_ID_BYTES) {
    for (uint8_t i = 0; i < c; i++) {
      memcpy(ids[i], data + ids_off + (size_t) i * AUTOMATION_ID_BYTES, AUTOMATION_ID_BYTES);
      ids[i][AUTOMATION_ID_BYTES - 1] = '\0';
    }
  }

  count = c;
  return APPLY_OK;
}

size_t serialize_set(const RuntimeAutomation *table, const char ids[][AUTOMATION_ID_BYTES], uint8_t count,
                     uint16_t route_set_version, uint8_t *out, size_t out_len) {
  if (count > MAX_AUTOMATIONS)
    count = MAX_AUTOMATIONS;
  size_t need = (size_t) AUTOMATION_HEADER_BYTES +
                (size_t) count * (AUTOMATION_RECORD_BYTES + AUTOMATION_ID_BYTES);
  if (out == nullptr || out_len < need)
    return 0;
  AutomationSetHeader hdr;
  hdr.magic_version = AUTOMATION_WIRE_MAGIC;
  hdr.route_set_version = route_set_version;
  hdr.count = count;
  hdr._pad = 0;
  memcpy(out, &hdr, sizeof(hdr));
  if (count > 0) {
    memcpy(out + AUTOMATION_HEADER_BYTES, table, (size_t) count * AUTOMATION_RECORD_BYTES);
    memcpy(out + AUTOMATION_HEADER_BYTES + (size_t) count * AUTOMATION_RECORD_BYTES, ids,
           (size_t) count * AUTOMATION_ID_BYTES);
  }
  return need;
}

bool should_fire(const RuntimeAutomation &a, const TimeInputs &t, float level, EdgeState &edge) {
  if (!a.enabled)
    return false;

  if (a.trigger_type == 0) {  // TIME — needs TRUSTED time; fire once per matching day-minute.
    if (!t.time_ok)
      return false;
    bool day_ok = (a.days_mask == 0) || (a.days_mask & (1 << t.cur_bit));
    if (day_ok && t.cur_min == (int) a.time_min && edge.last_yday != t.cur_yday) {
      edge.last_yday = t.cur_yday;
      return true;
    }
    return false;
  }

  // LEVEL — fire on the rising edge above this automation's OWN threshold, re-arm below.
  if (std::isnan(level) || level < 0.0f)
    return false;  // no level source
  if (level > (float) a.level_threshold_pct) {
    bool fire = edge.armed;
    edge.armed = false;
    return fire;
  }
  edge.armed = true;
  return false;
}

}  // namespace maji_auto
