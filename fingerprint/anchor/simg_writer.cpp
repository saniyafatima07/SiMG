#include "simg_writer.h"
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <openssl/evp.h>
#include <openssl/ec.h>
#include <openssl/pem.h>
#include <openssl/sha.h>
#include <openssl/err.h>

// ─────────────────────────────────────────────
//  Little-endian write helpers
// ─────────────────────────────────────────────
static void write_u16(uint8_t* p, uint16_t v) {
    p[0] = v & 0xFF;
    p[1] = (v >> 8) & 0xFF;
}
static void write_u32(uint8_t* p, uint32_t v) {
    p[0] = v & 0xFF;
    p[1] = (v >> 8) & 0xFF;
    p[2] = (v >> 16) & 0xFF;
    p[3] = (v >> 24) & 0xFF;
}
static void write_u64(uint8_t* p, uint64_t v) {
    for (int i = 0; i < 8; i++)
        p[i] = (v >> (8 * i)) & 0xFF;
}
static void write_f32(uint8_t* p, float v) {
    static_assert(sizeof(float) == 4, "float must be 4 bytes");
    std::memcpy(p, &v, 4);
}
static void write_f64(uint8_t* p, double v) {
    static_assert(sizeof(double) == 8, "double must be 8 bytes");
    std::memcpy(p, &v, 8);
}

// ─────────────────────────────────────────────
//  ECDSA P-256 sign with OpenSSL
// ─────────────────────────────────────────────
static std::vector<uint8_t> ecdsa_sign(
    const uint8_t* digest, size_t digest_len,
    const std::string& pem_path)
{
    FILE* fp = fopen(pem_path.c_str(), "r");
    if (!fp) throw std::runtime_error("Cannot open private key: " + pem_path);

    EVP_PKEY* pkey = PEM_read_PrivateKey(fp, nullptr, nullptr, nullptr);
    fclose(fp);
    if (!pkey) throw std::runtime_error("Failed to read private key PEM");

    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new(pkey, nullptr);
    if (!ctx) { EVP_PKEY_free(pkey); throw std::runtime_error("EVP_PKEY_CTX_new failed"); }

    if (EVP_PKEY_sign_init(ctx) <= 0)
        throw std::runtime_error("EVP_PKEY_sign_init failed");

    // Determine output length
    size_t siglen = 0;
    if (EVP_PKEY_sign(ctx, nullptr, &siglen, digest, digest_len) <= 0)
        throw std::runtime_error("EVP_PKEY_sign (len query) failed");

    std::vector<uint8_t> sig(siglen);
    if (EVP_PKEY_sign(ctx, sig.data(), &siglen, digest, digest_len) <= 0)
        throw std::runtime_error("EVP_PKEY_sign failed");

    sig.resize(siglen);
    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return sig;
}

// ─────────────────────────────────────────────
//  Public: write_simg
// ─────────────────────────────────────────────
void write_simg(const SimgData& data,
                const std::string& private_key_pem,
                const std::string& output_path)
{
    uint8_t buf[SIMG_SIZE];
    std::memset(buf, 0, SIMG_SIZE);

    // Magic
    write_u32(buf + SIMG_OFF_MAGIC, SIMG_MAGIC);

    // Version
    write_u16(buf + SIMG_OFF_VERSION, SIMG_VERSION);

    // Flags (reserved)
    write_u16(buf + SIMG_OFF_FLAGS, 0x0000);

    // DCT-pHash
    write_u64(buf + SIMG_OFF_PHASH, data.phash);

    // Radial rings: mean[0..7] then stdv[0..7]
    for (int z = 0; z < 8; z++)
        write_f32(buf + SIMG_OFF_RINGS + z * 4, data.rings.mean[z]);
    for (int z = 0; z < 8; z++)
        write_f32(buf + SIMG_OFF_RINGS + 32 + z * 4, data.rings.stdv[z]);

    // Histogram: 64 × double
    for (int i = 0; i < 64; i++)
        write_f64(buf + SIMG_OFF_HISTOGRAM + i * 8, data.histogram.bins[i]);

    // SHA-256 of bytes 0–655
    uint8_t sha[32];
    SHA256(buf, SIMG_OFF_SHA256, sha);
    std::memcpy(buf + SIMG_OFF_SHA256, sha, 32);

    // ECDSA sign over SHA-256
    auto sig = ecdsa_sign(sha, 32, private_key_pem);
    if (sig.size() > SIMG_SIG_MAXLEN)
        throw std::runtime_error("ECDSA signature too large: " + std::to_string(sig.size()));

    std::memcpy(buf + SIMG_OFF_SIGNATURE, sig.data(), sig.size());

    // Write to file
    std::ofstream f(output_path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot write SIMG: " + output_path);
    f.write(reinterpret_cast<const char*>(buf), SIMG_SIZE);
    if (!f) throw std::runtime_error("SIMG write failed: " + output_path);
}
