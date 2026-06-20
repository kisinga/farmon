#include "wire.h"
#include "mbedtls/md.h"
#include <cstdio>
#include <cstring>

namespace maji_wire {

static std::vector<uint8_t> to_bytes(const std::string &s) { return std::vector<uint8_t>(s.begin(), s.end()); }

std::string hmac(const std::string &key, const std::string &msg) {
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == nullptr)
    return "";
  uint8_t mac[32];
  if (mbedtls_md_hmac(info, (const uint8_t *) key.data(), key.size(), (const uint8_t *) msg.data(), msg.size(),
                      mac) != 0)
    return "";
  static const char HX[] = "0123456789abcdef";
  std::string out;
  out.reserve(16);
  for (int i = 0; i < 8; i++) {
    out += HX[mac[i] >> 4];
    out += HX[mac[i] & 0x0F];
  }
  return out;
}

std::string sig(const char *t, const std::string &node, const std::string &from, uint32_t c,
                const std::string &extra) {
  std::string s;
  s.reserve(96);
  s += t;
  s += '|';
  s += node;
  s += '|';
  s += from;
  s += '|';
  s += std::to_string(c);
  if (!extra.empty()) {
    s += '|';
    s += extra;
  }
  return s;
}

// claim and release share a shape: {"t":<type>,"node_id":..,"from":..,"c":..,"mac":..}.
static std::vector<uint8_t> encode_simple(const char *type, const std::string &self, const std::string &key,
                                          uint32_t &ctr, const std::string &node) {
  uint32_t c = ++ctr;
  std::string mac = hmac(key, sig(type, node, self, c, ""));
  std::string j = std::string("{\"t\":\"") + type + "\",\"node_id\":\"" + node + "\",\"from\":\"" + self +
                  "\",\"c\":" + std::to_string(c) + ",\"mac\":\"" + mac + "\"}";
  return to_bytes(j);
}

std::vector<uint8_t> encode_claim(const std::string &self, const std::string &key, uint32_t &ctr,
                                  const std::string &node) {
  return encode_simple("claim", self, key, ctr, node);
}

std::vector<uint8_t> encode_release(const std::string &self, const std::string &key, uint32_t &ctr,
                                    const std::string &node) {
  return encode_simple("release", self, key, ctr, node);
}

std::vector<uint8_t> encode_reading(const std::string &self, const std::string &key, uint32_t &ctr,
                                    const std::string &node, const std::string &role, float value) {
  uint32_t c = ++ctr;
  char vbuf[24];
  snprintf(vbuf, sizeof(vbuf), "%.4f", value);
  std::string mac = hmac(key, sig("reading", node, self, c, role + "|" + vbuf));
  std::string j = std::string("{\"t\":\"reading\",\"node_id\":\"") + node + "\",\"from\":\"" + self +
                  "\",\"c\":" + std::to_string(c) + ",\"role\":\"" + role + "\",\"value\":" + vbuf +
                  ",\"mac\":\"" + mac + "\"}";
  return to_bytes(j);
}

std::vector<uint8_t> encode_held(const std::string &self, const std::string &key, uint32_t &ctr,
                                 const std::string &node, const std::string &who) {
  uint32_t c = ++ctr;
  std::string mac = hmac(key, sig("held", node, self, c, who));
  std::string j = std::string("{\"t\":\"held\",\"node_id\":\"") + node + "\",\"from\":\"" + self +
                  "\",\"c\":" + std::to_string(c) + ",\"who\":\"" + who + "\",\"mac\":\"" + mac + "\"}";
  return to_bytes(j);
}

bool verify(const std::string &key, const std::string &self, const std::string &from, uint32_t c,
            const char *t, const std::string &node, const std::string &extra, const std::string &mac,
            std::map<std::string, uint32_t> &seen) {
  if (from.empty() || from == self)
    return false;
  std::string want = hmac(key, sig(t, node, from, c, extra));
  if (want.empty() || want != mac)
    return false;
  auto it = seen.find(from);
  if (it != seen.end()) {
    uint32_t last = it->second;
    if (!(c > last || last - c > 4096u))
      return false;  // replay
  }
  seen[from] = c;
  return true;
}

}  // namespace maji_wire
