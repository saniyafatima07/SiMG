#pragma once
#include <string>
#include <cstdint>
#include "../../anchor/include/rings.h"
#include "../../anchor/include/simg_writer.h"

struct VerdictDetail {
    int     hamming_distance;   // pHash hamming distance (0-64)
    float   max_ring_dev;       // max absolute ring mean deviation
    double  kl_divergence;      // KL divergence of histograms

    double  phash_score;        // 0.0–1.0 component score
    double  ring_score;         // 0.0–1.0 component score
    double  hist_score;         // 0.0–1.0 component score
    double  weighted_score;     // final weighted score

    bool    pass;               // true if weighted_score >= THRESHOLD
};

static constexpr double SCORE_THRESHOLD = 0.85;

// Weights
static constexpr double W_PHASH = 0.4;
static constexpr double W_RINGS = 0.3;
static constexpr double W_HIST  = 0.3;

// Tolerances (calibrated for pydicom's ±1 uint8 rounding noise)
static constexpr int    HAMMING_TOLERANCE  = 10;   // bits
static constexpr float  RING_TOLERANCE     = 0.05f; // normalised mean delta
static constexpr double KL_TOLERANCE       = 0.10;  // KL divergence units

// Load a grayscale PNG and return pixel buffer + dimensions.
// Throws on failure.
std::vector<uint8_t> load_png_grayscale(const std::string& path, int& width, int& height);

// Compare PNG-derived fingerprints against SIMG reference.
VerdictDetail compare(const SimgData& ref, const std::string& png_path);
