#include "simg_reader.h"
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/sha.h>
#include <openssl/err.h>

// ─────────────────────────────────────────────
//  Little-endian read helpers
// ─────────────────────────────────────────────
static uint16_t rd_u16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd_u32(const uint8_t* p) {
    return (uint32_t)(p[0] | (p[1]<<8) | (p[2]<<16) | (p[3]<<24));
}
static uint64_t rd_u64(const uint8_t* p) {
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) v |= ((uint64_t)p[i] << (8*i));
    return v;
}
static float rd_f32(const uint8_t* p) {
    float v; std::memcpy(&v, p, 4); return v;
}
static double rd_f64(const uint8_t* p) {
    double v; std::memcpy(&v, p, 8); return v;
}

// ─────────────────────────────────────────────
//  ECDSA verify with OpenSSL
// ─────────────────────────────────────────────
static bool ecdsa_verify(
    const uint8_t* digest, size_t digest_len,
    const uint8_t* sig, size_t sig_len,
    const std::string& pem_path)
{
    FILE* fp = fopen(pem_path.c_str(), "r");
    if (!fp) throw std::runtime_error("Cannot open public key: " + pem_path);

    EVP_PKEY* pkey = PEM_read_PUBKEY(fp, nullptr, nullptr, nullptr);
    fclose(fp);
    if (!pkey) throw std::runtime_error("Failed to read public key PEM");

    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(pkey, nullptr);
    if (!ctx) { EVP_PKEY_free(pkey); throw std::runtime_error("EVP_PKEY_CTX_new failed"); }

    bool ok = false;
    if (EVP_PKEY_verify_init(ctx) > 0) {
        int ret = EVP_PKEY_verify(ctx, sig, sig_len, digest, digest_len);
        ok = (ret == 1);
    }

    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return ok;
}

// ─────────────────────────────────────────────
//  Public: read_and_verify_simg
// ─────────────────────────────────────────────
SimgData read_and_verify_simg(const std::string& simg_path,
                               const std::string& public_key_pem)
{
    std::ifstream f(simg_path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open SIMG file: " + simg_path);

    uint8_t buf[SIMG_SIZE];
    f.read(reinterpret_cast<char*>(buf), SIMG_SIZE);
    if (f.gcount() != SIMG_SIZE)
        throw std::runtime_error("SIMG file is wrong size (expected 760 bytes)");

    // ── Magic + version check ───────────────
    uint32_t magic = rd_u32(buf + SIMG_OFF_MAGIC);
    if (magic != SIMG_MAGIC)
        throw std::runtime_error("SIMG magic mismatch — not a valid SIMG file");

    uint16_t version = rd_u16(buf + SIMG_OFF_VERSION);
    if (version != SIMG_VERSION)
        throw std::runtime_error("SIMG version mismatch: " + std::to_string(version));

    // ── SHA-256 integrity check ─────────────
    uint8_t computed_sha[32];
    SHA256(buf, SIMG_OFF_SHA256, computed_sha);

    if (std::memcmp(computed_sha, buf + SIMG_OFF_SHA256, 32) != 0)
        throw std::runtime_error("SIMG SHA-256 integrity check FAILED — anchor file tampered");

    // ── ECDSA signature verification ────────
    // Signature is DER-encoded, stored at offset 688, max 72 bytes.
    // Find actual sig length by reading DER length byte.
    const uint8_t* sig_ptr = buf + SIMG_OFF_SIGNATURE;
    size_t sig_len = 0;

    // DER SEQUENCE: 0x30 <length> ...
    if (sig_ptr[0] == 0x30 && sig_ptr[1] > 0) {
        sig_len = (size_t)sig_ptr[1] + 2;  // tag + length + content
        if (sig_len > SIMG_SIG_MAXLEN) sig_len = SIMG_SIG_MAXLEN;
    } else {
        throw std::runtime_error("SIMG signature field malformed");
    }

    bool sig_ok = ecdsa_verify(
        buf + SIMG_OFF_SHA256, 32,
        sig_ptr, sig_len,
        public_key_pem
    );

    if (!sig_ok)
        throw std::runtime_error("SIMG ECDSA signature INVALID — anchor was not signed by trusted key");

    // ── Parse fields ─────────────────────────
    SimgData data;

    data.phash = rd_u64(buf + SIMG_OFF_PHASH);

    for (int z = 0; z < 8; z++)
        data.rings.mean[z] = rd_f32(buf + SIMG_OFF_RINGS + z * 4);
    for (int z = 0; z < 8; z++)
        data.rings.stdv[z] = rd_f32(buf + SIMG_OFF_RINGS + 32 + z * 4);

    for (int i = 0; i < 64; i++)
        data.histogram.bins[i] = rd_f64(buf + SIMG_OFF_HISTOGRAM + i * 8);

    return data;
}
