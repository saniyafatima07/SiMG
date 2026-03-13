#include "phash.h"
#include <cmath>
#include <algorithm>
#include <numeric>
#include <stdexcept>

// ─────────────────────────────────────────────
//  Bilinear downsample to 32x32
// ─────────────────────────────────────────────
static std::vector<float> downsample_32x32(
    const std::vector<uint8_t>& src, int sw, int sh)
{
    std::vector<float> dst(32 * 32);
    float sx = (float)sw / 32.0f;
    float sy = (float)sh / 32.0f;

    for (int dy = 0; dy < 32; dy++) {
        for (int dx = 0; dx < 32; dx++) {
            float fx = (dx + 0.5f) * sx - 0.5f;
            float fy = (dy + 0.5f) * sy - 0.5f;

            int x0 = std::max(0, (int)fx);
            int y0 = std::max(0, (int)fy);
            int x1 = std::min(sw - 1, x0 + 1);
            int y1 = std::min(sh - 1, y0 + 1);

            float wx = fx - x0;
            float wy = fy - y0;

            float v = src[y0 * sw + x0] * (1 - wx) * (1 - wy)
                    + src[y0 * sw + x1] * wx       * (1 - wy)
                    + src[y1 * sw + x0] * (1 - wx) * wy
                    + src[y1 * sw + x1] * wx       * wy;

            dst[dy * 32 + dx] = v;
        }
    }
    return dst;
}

// ─────────────────────────────────────────────
//  2D DCT-II on 32x32 block, return 8x8 top-left
// ─────────────────────────────────────────────
static std::vector<float> dct2d_8x8(const std::vector<float>& block32)
{
    // 1D DCT-II on rows of 32x32
    const int N = 32;
    std::vector<float> tmp(N * N, 0.0f);

    // Row DCT
    for (int y = 0; y < N; y++) {
        for (int u = 0; u < N; u++) {
            float sum = 0.0f;
            for (int x = 0; x < N; x++) {
                sum += block32[y * N + x] *
                       std::cos((2.0f * x + 1.0f) * u * M_PI / (2.0f * N));
            }
            float cu = (u == 0) ? 1.0f / std::sqrt(2.0f) : 1.0f;
            tmp[y * N + u] = std::sqrt(2.0f / N) * cu * sum;
        }
    }

    // Column DCT
    std::vector<float> dct(N * N, 0.0f);
    for (int x = 0; x < N; x++) {
        for (int v = 0; v < N; v++) {
            float sum = 0.0f;
            for (int y = 0; y < N; y++) {
                sum += tmp[y * N + x] *
                       std::cos((2.0f * y + 1.0f) * v * M_PI / (2.0f * N));
            }
            float cv = (v == 0) ? 1.0f / std::sqrt(2.0f) : 1.0f;
            dct[v * N + x] = std::sqrt(2.0f / N) * cv * sum;
        }
    }

    // Extract top-left 8x8 (skip DC at [0,0], use [0..7][0..7])
    std::vector<float> out(64);
    for (int r = 0; r < 8; r++)
        for (int c = 0; c < 8; c++)
            out[r * 8 + c] = dct[r * N + c];

    // Zero out DC component — we only care about AC
    out[0] = 0.0f;
    return out;
}

// ─────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────
uint64_t compute_phash(const std::vector<uint8_t>& pixels, int width, int height)
{
    if (pixels.size() != (size_t)(width * height))
        throw std::invalid_argument("phash: pixel buffer size mismatch");

    auto small = downsample_32x32(pixels, width, height);
    auto coeffs = dct2d_8x8(small);

    // Median of 63 AC coefficients (skip index 0 = DC)
    std::vector<float> ac(coeffs.begin() + 1, coeffs.end());
    std::nth_element(ac.begin(), ac.begin() + ac.size() / 2, ac.end());
    float median = ac[ac.size() / 2];

    // Build 64-bit hash: bit i = 1 if coeffs[i] > median
    uint64_t hash = 0;
    for (int i = 0; i < 64; i++) {
        if (coeffs[i] > median)
            hash |= (1ULL << i);
    }
    return hash;
}

int phash_hamming(uint64_t a, uint64_t b)
{
    return __builtin_popcountll(a ^ b);
}
