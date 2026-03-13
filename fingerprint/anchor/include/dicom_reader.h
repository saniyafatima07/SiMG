#pragma once
#include <cstdint>
#include <string>
#include <vector>

// ─────────────────────────────────────────────
//  Minimal DICOM tags we need for windowing
// ─────────────────────────────────────────────
struct DicomTags {
    // Modality LUT
    double rescale_slope     = 1.0;
    double rescale_intercept = 0.0;

    // VOI LUT windowing
    double window_center = -1.0;   // -1 = not present
    double window_width  = -1.0;   // -1 = not present

    // Pixel data
    int rows    = 0;
    int cols    = 0;
    int bits_allocated = 16;
    int bits_stored    = 16;
    int pixel_representation = 0;  // 0 = unsigned, 1 = signed
    bool has_voi_lut_sequence = false;  // if true, skip windowing

    std::vector<uint8_t>  raw_bytes;  // raw pixel bytes from file
};

// Parse DICOM file and extract tags + raw pixel data.
// Throws std::runtime_error on malformed input.
DicomTags parse_dicom(const std::string& path);

// Apply modality LUT + VOI windowing → produce 8-bit grayscale output.
// Mirrors pydicom's apply_modality_lut + apply_windowing pipeline exactly.
// Returns vector of width*height uint8_t values in row-major order.
std::vector<uint8_t> apply_dicom_windowing(const DicomTags& tags);
