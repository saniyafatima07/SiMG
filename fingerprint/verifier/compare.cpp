#include "compare.h"
#include "../../anchor/include/phash.h"
#include "../../anchor/include/rings.h"
#include <stdexcept>
#include <cmath>
#include <algorithm>
#include <png.h>

// ─────────────────────────────────────────────
//  Load PNG → grayscale uint8 buffer using libpng
// ─────────────────────────────────────────────
std::vector<uint8_t> load_png_grayscale(const std::string& path, int& width, int& height)
{
    FILE* fp = fopen(path.c_str(), "rb");
    if (!fp) throw std::runtime_error("Cannot open PNG: " + path);

    // Check PNG signature
    uint8_t sig[8];
    fread(sig, 1, 8, fp);
    if (png_sig_cmp(sig, 0, 8)) {
        fclose(fp);
        throw std::runtime_error("Not a valid PNG file: " + path);
    }

    png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING,
                                              nullptr, nullptr, nullptr);
    if (!png) { fclose(fp); throw std::runtime_error("png_create_read_struct failed"); }

    png_infop info = png_create_info_struct(png);
    if (!info) {
        png_destroy_read_struct(&png, nullptr, nullptr);
        fclose(fp);
        throw std::runtime_error("png_create_info_struct failed");
    }

    if (setjmp(png_jmpbuf(png))) {
        png_destroy_read_struct(&png, &info, nullptr);
        fclose(fp);
        throw std::runtime_error("libpng read error: " + path);
    }

    png_init_io(png, fp);
    png_set_sig_bytes(png, 8);
    png_read_info(png, info);

    width  = (int)png_get_image_width(png, info);
    height = (int)png_get_image_height(png, info);
    int color_type = png_get_color_type(png, info);
    int bit_depth  = png_get_bit_depth(png, info);

    // Normalise to 8-bit grayscale regardless of input format
    if (bit_depth == 16)
        png_set_strip_16(png);
    if (color_type == PNG_COLOR_TYPE_PALETTE)
        png_set_palette_to_rgb(png);
    if (color_type == PNG_COLOR_TYPE_RGB ||
        color_type == PNG_COLOR_TYPE_RGB_ALPHA)
        png_set_rgb_to_gray(png, 1, 0.299, 0.587);  // BT.601 luma
    if (color_type & PNG_COLOR_MASK_ALPHA)
        png_set_strip_alpha(png);
    if (bit_depth < 8)
        png_set_expand_gray_1_2_4_to_8(png);

    png_read_update_info(png, info);

    int rowbytes = (int)png_get_rowbytes(png, info);
    std::vector<uint8_t> pixels(width * height);
    std::vector<png_bytep> rows(height);
    for (int y = 0; y < height; y++)
        rows[y] = pixels.data() + y * width;

    png_read_image(png, rows.data());
    png_read_end(png, nullptr);
    png_destroy_read_struct(&png, &info, nullptr);
    fclose(fp);

    (void)rowbytes;
    return pixels;
}

// ─────────────────────────────────────────────
//  Component scorers
// ─────────────────────────────────────────────
static double score_phash(int hamming) {
    return std::max(0.0, 1.0 - (double)hamming / HAMMING_TOLERANCE);
}

static double score_rings(float max_dev) {
    return std::max(0.0, 1.0 - (double)max_dev / RING_TOLERANCE);
}

static double score_hist(double kl) {
    return std::max(0.0, 1.0 - kl / KL_TOLERANCE);
}

// ─────────────────────────────────────────────
//  Public: compare
// ─────────────────────────────────────────────
VerdictDetail compare(const SimgData& ref, const std::string& png_path)
{
    // Load PNG as grayscale
    int w = 0, h = 0;
    auto pixels = load_png_grayscale(png_path, w, h);

    // Re-derive the same three descriptors from the PNG
    uint64_t png_phash = compute_phash(pixels, w, h);
    RingDescriptor png_rings = compute_rings(pixels, w, h);
    HistogramDescriptor png_hist = compute_histogram(pixels);

    VerdictDetail v;

    // pHash
    v.hamming_distance = phash_hamming(ref.phash, png_phash);
    v.phash_score = score_phash(v.hamming_distance);

    // Rings
    v.max_ring_dev = max_ring_deviation(ref.rings, png_rings);
    v.ring_score = score_rings(v.max_ring_dev);

    // Histogram KL divergence (symmetric: average both directions)
    double kl_fwd = kl_divergence(ref.histogram, png_hist);
    double kl_rev = kl_divergence(png_hist, ref.histogram);
    v.kl_divergence = (kl_fwd + kl_rev) / 2.0;
    v.hist_score = score_hist(v.kl_divergence);

    // Weighted composite score
    v.weighted_score = W_PHASH * v.phash_score
                     + W_RINGS * v.ring_score
                     + W_HIST  * v.hist_score;

    v.pass = (v.weighted_score >= SCORE_THRESHOLD);

    return v;
}
