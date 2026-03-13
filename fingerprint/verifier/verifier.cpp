#include <iostream>
#include <string>
#include <stdexcept>

#include "simg_reader.h"
#include "compare.h"

// ─────────────────────────────────────────────
//  Usage: verifier <png_path> <simg_path> <public_key_pem>
//
//  Exit codes:
//    0 = PASS
//    1 = FAIL (integrity compromised)
//    2 = TAMPERED ANCHOR (SIMG sig invalid)
//    3 = ERROR (bad args, file not found, etc.)
//
//  Stdout JSON (always):
//  {
//    "verdict": "PASS" | "FAIL" | "TAMPERED_ANCHOR" | "ERROR",
//    "score": 0.97,
//    "hamming": 2,
//    "max_ring_dev": 0.011,
//    "kl_divergence": 0.023,
//    "phash_score": 0.98,
//    "ring_score": 0.99,
//    "hist_score": 0.95,
//    "threshold": 0.85,
//    "message": "..."
//  }
// ─────────────────────────────────────────────

static void print_json(
    const std::string& verdict,
    double score,
    int hamming,
    float ring_dev,
    double kl,
    double ps, double rs, double hs,
    const std::string& message)
{
    std::cout << "{"
        << "\"verdict\":\"" << verdict << "\","
        << "\"score\":"     << score   << ","
        << "\"hamming\":"   << hamming << ","
        << "\"max_ring_dev\":" << ring_dev << ","
        << "\"kl_divergence\":" << kl   << ","
        << "\"phash_score\":" << ps    << ","
        << "\"ring_score\":" << rs     << ","
        << "\"hist_score\":" << hs     << ","
        << "\"threshold\":" << SCORE_THRESHOLD << ","
        << "\"message\":\"" << message << "\""
        << "}" << std::endl;
}

static void print_json_error(const std::string& msg) {
    std::string safe = msg;
    for (auto& c : safe) if (c == '"') c = '\'';
    std::cout << "{\"verdict\":\"ERROR\",\"score\":0,\"hamming\":-1,"
              << "\"max_ring_dev\":-1,\"kl_divergence\":-1,"
              << "\"phash_score\":0,\"ring_score\":0,\"hist_score\":0,"
              << "\"threshold\":" << SCORE_THRESHOLD << ","
              << "\"message\":\"" << safe << "\"}" << std::endl;
}

int main(int argc, char* argv[])
{
    if (argc != 4) {
        print_json_error("Usage: verifier <png_path> <simg_path> <public_key_pem>");
        return 3;
    }

    std::string png_path    = argv[1];
    std::string simg_path   = argv[2];
    std::string pubkey_path = argv[3];

    std::cerr << "[VERIFIER] PNG:  " << png_path  << std::endl;
    std::cerr << "[VERIFIER] SIMG: " << simg_path << std::endl;

    // ── Step 1: Read + verify SIMG anchor ───
    SimgData ref;
    try {
        ref = read_and_verify_simg(simg_path, pubkey_path);
        std::cerr << "[VERIFIER] ECDSA signature: VALID" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "[VERIFIER] ECDSA signature: INVALID — " << e.what() << std::endl;
        print_json_error(std::string("TAMPERED_ANCHOR: ") + e.what());
        return 2;
    }

    // ── Step 2: Compare PNG against reference ─
    VerdictDetail v;
    try {
        v = compare(ref, png_path);
    } catch (const std::exception& e) {
        print_json_error(std::string("Comparison error: ") + e.what());
        return 3;
    }

    // ── Step 3: Log + emit verdict ──────────
    std::cerr << "[VERIFIER] pHash hamming distance: " << v.hamming_distance << std::endl;
    std::cerr << "[VERIFIER] Max ring deviation:     " << v.max_ring_dev      << std::endl;
    std::cerr << "[VERIFIER] Histogram KL divergence:" << v.kl_divergence     << std::endl;
    std::cerr << "[VERIFIER] Weighted score:          " << v.weighted_score
              << "  threshold: " << SCORE_THRESHOLD << std::endl;

    if (v.pass) {
        std::cerr << "[VERIFIER] Verdict: PASS" << std::endl;
        print_json("PASS",
            v.weighted_score, v.hamming_distance, v.max_ring_dev, v.kl_divergence,
            v.phash_score, v.ring_score, v.hist_score,
            "Integrity verified — image matches anchor");
        return 0;
    } else {
        std::cerr << "[VERIFIER] Verdict: FAIL — COMPROMISED CONVERTER DETECTED" << std::endl;
        print_json("FAIL",
            v.weighted_score, v.hamming_distance, v.max_ring_dev, v.kl_divergence,
            v.phash_score, v.ring_score, v.hist_score,
            "INTEGRITY FAILURE — structural fingerprint mismatch");
        return 1;
    }
}
