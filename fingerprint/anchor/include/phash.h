#pragma once
#include <cstdint>
#include <vector>

// Compute 64-bit DCT perceptual hash from an 8-bit grayscale pixel buffer.
// width/height: dimensions of the pixel buffer.
// Returns a 64-bit hash where each bit represents whether a DCT coefficient
// is above or below the median of the 8x8 top-left AC coefficients.
uint64_t compute_phash(const std::vector<uint8_t>& pixels, int width, int height);

// Hamming distance between two 64-bit hashes
int phash_hamming(uint64_t a, uint64_t b);
