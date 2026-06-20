// OpenSSL-backed implementation of the mbedtls HMAC shim (host tests only).
#include "mbedtls/md.h"
#include <openssl/hmac.h>
#include <openssl/evp.h>

static const int SHA256_MARKER = 1;

const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t type) {
  return type == MBEDTLS_MD_SHA256 ? reinterpret_cast<const mbedtls_md_info_t *>(&SHA256_MARKER) : nullptr;
}

int mbedtls_md_hmac(const mbedtls_md_info_t *info, const uint8_t *key, size_t keylen,
                    const uint8_t *input, size_t ilen, uint8_t *output) {
  if (info == nullptr)
    return -1;
  unsigned int len = 0;
  unsigned char *r = HMAC(EVP_sha256(), key, static_cast<int>(keylen), input, ilen, output, &len);
  return (r != nullptr && len == 32) ? 0 : -1;
}
