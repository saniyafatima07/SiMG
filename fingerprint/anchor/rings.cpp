#include "rings.h"
#include <cmath>
#include <stdexcept>
#include <numeric>
#include <algorithm>

// ─────────────────────────────────────────────
//  Radial Ring Descriptor
//  Divides image into 8 annular zones by normalized
//  distance from center. Zone 0 = center, zone 7 = corners.
// ─────────────────────────────────────────────
RingDescriptor compute_rings(const std::vector<uint8_t>& pixels, int width, int height)
{
    if (pixels.size() != (size_t)(width * height))
        throw std::invalid_argument("rings: pixel buffer size mismatch");

    const int ZONES = 8;
    float cx = (width  - 1) / 2.0f;
    float cy = (height - 1) / 2.0f;
    // max possible distance from center to corner
    float max_dist = std::sqrt(cx * cx + cy * cy);

    // Accumulate sum and sum-of-squares per zone
    std::vector<double> sum(ZONES, 0.0), sum2(ZONES, 0.0);
    std::vector<int>    count(ZONES, 0);

    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            float dx = x - cx;
            float dy = y - cy;
            float dist = std::sqrt(dx * dx + dy * dy);
            float norm = dist / max_dist;           // [0, 1]
            int zone = std::min((int)(norm * ZONES), ZONES - 1);

            double v = pixels[y * width + x] / 255.0;
            sum[zone]  += v;
            sum2[zone] += v * v;
            count[zone]++;
        }
    }

    RingDescriptor rd;
    for (int z = 0; z < ZONES; z++) {
        if (count[z] == 0) {
            rd.mean[z] = 0.0f;
            rd.stdv[z] = 0.0f;
        } else {
            double mean = sum[z] / count[z];
            double var  = (sum2[z] / count[z]) - (mean * mean);
            rd.mean[z] = (float)mean;
            rd.stdv[z] = (float)std::sqrt(std::max(0.0, var));
        }
    }
    return rd;
}

// ─────────────────────────────────────────────
//  Histogram — 64 bins, normalised
// ─────────────────────────────────────────────
HistogramDescriptor compute_histogram(const std::vector<uint8_t>& pixels)
{
    HistogramDescriptor hd;
    std::fill(hd.bins, hd.bins + 64, 0.0);

    for (uint8_t p : pixels) {
        int bin = p / 4;   // 256 values → 64 bins (4 values per bin)
        if (bin > 63) bin = 63;
        hd.bins[bin] += 1.0;
    }

    // Normalise
    double total = (double)pixels.size();
    for (int i = 0; i < 64; i++)
        hd.bins[i] /= total;

    return hd;
}

// ─────────────────────────────────────────────
//  KL Divergence D(P || Q)
//  Small epsilon added to avoid log(0)
// ─────────────────────────────────────────────
double kl_divergence(const HistogramDescriptor& p, const HistogramDescriptor& q)
{
    const double EPS = 1e-10;
    double kl = 0.0;
    for (int i = 0; i < 64; i++) {
        double pi = p.bins[i] + EPS;
        double qi = q.bins[i] + EPS;
        kl += pi * std::log(pi / qi);
    }
    return kl;
}

// ─────────────────────────────────────────────
//  Max absolute deviation across ring means
// ─────────────────────────────────────────────
float max_ring_deviation(const RingDescriptor& a, const RingDescriptor& b)
{
    float max_dev = 0.0f;
    for (int z = 0; z < 8; z++) {
        float dev = std::fabs(a.mean[z] - b.mean[z]);
        if (dev > max_dev) max_dev = dev;
    }
    return max_dev;
}
