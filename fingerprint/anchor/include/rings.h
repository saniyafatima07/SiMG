#pragma once
#include <cstdint>
#include <vector>
#include <array>

// ─────────────────────────────────────────────
//  Radial Ring Descriptor
//  8 concentric annular zones from center to corner.
//  Each zone: mean + std of pixel values → 16 floats total.
// ─────────────────────────────────────────────
struct RingDescriptor {
    float mean[8];   // mean per zone
    float stdv[8];   // std deviation per zone
};

// ─────────────────────────────────────────────
//  Histogram Descriptor
//  64 bins, normalised to sum = 1.0
// ─────────────────────────────────────────────
struct HistogramDescriptor {
    double bins[64];
};

RingDescriptor   compute_rings(const std::vector<uint8_t>& pixels, int width, int height);
HistogramDescriptor compute_histogram(const std::vector<uint8_t>& pixels);

// KL divergence: sum(p * log(p/q)), with epsilon smoothing
double kl_divergence(const HistogramDescriptor& p, const HistogramDescriptor& q);

// Max absolute deviation across all ring zones
float max_ring_deviation(const RingDescriptor& a, const RingDescriptor& b);
