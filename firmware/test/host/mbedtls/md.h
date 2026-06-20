#pragma once
// Host-test shim for the three mbedtls symbols wire.cpp uses, backed by OpenSSL.
// HMAC-SHA256 is a standard algorithm, so OpenSSL's output is byte-identical to the
// device's mbedtls — letting us compile the REAL wire.cpp unchanged for host tests.
#include <stddef.h>
#include <stdint.h>

typedef enum { MBEDTLS_MD_SHA256 = 6 } mbedtls_md_type_t;
typedef struct mbedtls_md_info_t mbedtls_md_info_t;

#ifdef __cplusplus
extern "C" {
#endif
const mbedtls_md_info_t *mbedtls_md_info_from_type(mbedtls_md_type_t type);
int mbedtls_md_hmac(const mbedtls_md_info_t *info, const uint8_t *key, size_t keylen,
                    const uint8_t *input, size_t ilen, uint8_t *output);
#ifdef __cplusplus
}
#endif
