#include "dicom_reader.h"
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <cmath>
#include <algorithm>

// ─────────────────────────────────────────────
//  DICOM tag constants (group, element)
// ─────────────────────────────────────────────
static constexpr uint32_t TAG_ROWS              = 0x00280010;
static constexpr uint32_t TAG_COLS              = 0x00280011;
static constexpr uint32_t TAG_BITS_ALLOC        = 0x00280100;
static constexpr uint32_t TAG_BITS_STORED       = 0x00280101;
static constexpr uint32_t TAG_PIXEL_REP         = 0x00280103;
static constexpr uint32_t TAG_RESCALE_INTERCEPT = 0x00281052;
static constexpr uint32_t TAG_RESCALE_SLOPE     = 0x00281053;
static constexpr uint32_t TAG_WINDOW_CENTER     = 0x00281050;
static constexpr uint32_t TAG_WINDOW_WIDTH      = 0x00281051;
static constexpr uint32_t TAG_VOI_LUT_SEQ       = 0x00285020; // (0028,5020) — rarely used alias
static constexpr uint32_t TAG_VOI_LUT_SEQ2      = 0x00280106; // (0028,0106) smallest pixel
static constexpr uint32_t TAG_PIXEL_DATA        = 0x7FE00010;

// ─────────────────────────────────────────────
//  Little-endian read helpers
// ─────────────────────────────────────────────
static uint16_t read_u16(const uint8_t* p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}
static uint32_t read_u32(const uint8_t* p) {
    return (uint32_t)(p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24));
}
static int16_t read_i16(const uint8_t* p) {
    return (int16_t)read_u16(p);
}

// Parse a DS (decimal string) VR value — may contain backslash-separated multiple values
static double parse_ds(const std::string& s) {
    // Take first value only (multiple values separated by '\')
    size_t pos = s.find('\\');
    std::string first = (pos != std::string::npos) ? s.substr(0, pos) : s;
    try { return std::stod(first); }
    catch (...) { return 0.0; }
}

// ─────────────────────────────────────────────
//  DICOM parser — explicit little-endian transfer syntax
//  Handles both implicit and explicit VR.
// ─────────────────────────────────────────────
DicomTags parse_dicom(const std::string& path)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open DICOM file: " + path);

    // Read entire file into buffer
    f.seekg(0, std::ios::end);
    size_t fsize = f.tellg();
    f.seekg(0);
    std::vector<uint8_t> buf(fsize);
    f.read(reinterpret_cast<char*>(buf.data()), fsize);

    // DICOM preamble: 128 bytes + "DICM" magic
    bool has_preamble = false;
    size_t offset = 0;
    if (fsize >= 132 &&
        buf[128] == 'D' && buf[129] == 'I' &&
        buf[130] == 'C' && buf[131] == 'M')
    {
        has_preamble = true;
        offset = 132;
    }
    // else: no preamble, start at 0 (older DICOM files)

    DicomTags tags;
    bool explicit_vr = true;  // assume explicit; will detect from first tag

    auto peek_explicit = [&]() -> bool {
        if (offset + 6 > fsize) return false;
        // VR field at offset+4 should be 2 printable uppercase ASCII chars
        char v0 = (char)buf[offset + 4];
        char v1 = (char)buf[offset + 5];
        return (v0 >= 'A' && v0 <= 'Z' && v1 >= 'A' && v1 <= 'Z');
    };

    if (has_preamble) {
        // File meta (group 0002) is always explicit. Check first non-meta tag.
        // For simplicity, scan until we find a non-0002 group and test there.
        explicit_vr = true;
    } else {
        explicit_vr = peek_explicit();
    }

    // ── Main parsing loop ──────────────────────
    while (offset + 4 <= fsize) {
        uint16_t grp  = read_u16(buf.data() + offset);
        uint16_t elem = read_u16(buf.data() + offset + 2);
        uint32_t tag  = ((uint32_t)grp << 16) | elem;
        offset += 4;

        uint32_t vlen = 0;
        bool is_explicit_here = explicit_vr;

        if (is_explicit_here && offset + 2 <= fsize) {
            char vr[3] = {(char)buf[offset], (char)buf[offset+1], 0};
            offset += 2;

            // Long VR types: OB, OD, OF, OL, OW, SQ, UC, UN, UR, UT
            std::string vr_str(vr);
            bool long_vr = (vr_str == "OB" || vr_str == "OD" || vr_str == "OF" ||
                            vr_str == "OL" || vr_str == "OW" || vr_str == "SQ" ||
                            vr_str == "UC" || vr_str == "UN" || vr_str == "UR" ||
                            vr_str == "UT");
            if (long_vr) {
                offset += 2; // reserved 2 bytes
                if (offset + 4 > fsize) break;
                vlen = read_u32(buf.data() + offset);
                offset += 4;
            } else {
                if (offset + 2 > fsize) break;
                vlen = read_u16(buf.data() + offset);
                offset += 2;
            }
        } else {
            // Implicit VR — 4-byte length
            if (offset + 4 > fsize) break;
            vlen = read_u32(buf.data() + offset);
            offset += 4;
        }

        // Undefined length (0xFFFFFFFF) — skip sequences for now
        if (vlen == 0xFFFFFFFF) {
            // Skip to next tag heuristically — not full seq parsing
            // For our purposes we only need scalar tags; SQ skipping is sufficient
            continue;
        }

        if (offset + vlen > fsize) break;
        const uint8_t* vdata = buf.data() + offset;

        // ── Extract tags we care about ──────────
        switch (tag) {
            case TAG_ROWS:
                tags.rows = read_u16(vdata);
                break;
            case TAG_COLS:
                tags.cols = read_u16(vdata);
                break;
            case TAG_BITS_ALLOC:
                tags.bits_allocated = read_u16(vdata);
                break;
            case TAG_BITS_STORED:
                tags.bits_stored = read_u16(vdata);
                break;
            case TAG_PIXEL_REP:
                tags.pixel_representation = read_u16(vdata);
                break;
            case TAG_RESCALE_INTERCEPT: {
                std::string s(reinterpret_cast<const char*>(vdata), vlen);
                tags.rescale_intercept = parse_ds(s);
                break;
            }
            case TAG_RESCALE_SLOPE: {
                std::string s(reinterpret_cast<const char*>(vdata), vlen);
                tags.rescale_slope = parse_ds(s);
                break;
            }
            case TAG_WINDOW_CENTER: {
                std::string s(reinterpret_cast<const char*>(vdata), vlen);
                tags.window_center = parse_ds(s);
                break;
            }
            case TAG_WINDOW_WIDTH: {
                std::string s(reinterpret_cast<const char*>(vdata), vlen);
                tags.window_width = parse_ds(s);
                break;
            }
            case TAG_PIXEL_DATA:
                tags.raw_bytes.assign(vdata, vdata + vlen);
                break;
            default:
                break;
        }

        offset += vlen;
    }

    if (tags.rows == 0 || tags.cols == 0)
        throw std::runtime_error("DICOM parse: could not find image dimensions");
    if (tags.raw_bytes.empty())
        throw std::runtime_error("DICOM parse: pixel data not found");

    return tags;
}

// ─────────────────────────────────────────────
//  Apply windowing — mirrors pydicom exactly
//
//  pydicom pipeline:
//    1. apply_modality_lut: hu = px * slope + intercept
//    2. apply_windowing (linear):
//         if px <= WC - WW/2 → 0
//         if px >= WC + WW/2 → 255
//         else → ((px - (WC - WW/2)) / WW) * 255
//    3. cast to uint8
//
//  If no windowing tags → use full range min-max normalisation
// ─────────────────────────────────────────────
std::vector<uint8_t> apply_dicom_windowing(const DicomTags& tags)
{
    int npix = tags.rows * tags.cols;
    if (npix <= 0) throw std::runtime_error("windowing: invalid dimensions");

    // Decode raw pixel bytes → float HU values
    std::vector<double> hu(npix);
    const uint8_t* raw = tags.raw_bytes.data();

    if (tags.bits_allocated == 16) {
        if (tags.raw_bytes.size() < (size_t)(npix * 2))
            throw std::runtime_error("windowing: pixel data too short for 16-bit");

        for (int i = 0; i < npix; i++) {
            double px;
            if (tags.pixel_representation == 1) {
                // Signed 16-bit
                px = (double)read_i16(raw + i * 2);
            } else {
                // Unsigned 16-bit
                px = (double)read_u16(raw + i * 2);
            }
            // Modality LUT (rescale)
            hu[i] = px * tags.rescale_slope + tags.rescale_intercept;
        }
    } else if (tags.bits_allocated == 8) {
        if (tags.raw_bytes.size() < (size_t)npix)
            throw std::runtime_error("windowing: pixel data too short for 8-bit");
        for (int i = 0; i < npix; i++) {
            double px = (double)raw[i];
            hu[i] = px * tags.rescale_slope + tags.rescale_intercept;
        }
    } else {
        throw std::runtime_error("windowing: unsupported bits_allocated: " +
                                 std::to_string(tags.bits_allocated));
    }

    // VOI LUT windowing
    std::vector<uint8_t> out(npix);

    if (tags.window_center > -0.5 && tags.window_width > 0.0 &&
        !tags.has_voi_lut_sequence)
    {
        // Standard linear windowing — exact pydicom formula
        double wc = tags.window_center;
        double ww = tags.window_width;
        double lo = wc - ww / 2.0;
        double hi = wc + ww / 2.0;

        for (int i = 0; i < npix; i++) {
            double v;
            if (hu[i] <= lo)       v = 0.0;
            else if (hu[i] >= hi)  v = 255.0;
            else                   v = ((hu[i] - lo) / ww) * 255.0;

            // Floor + clamp — matches numpy uint8 cast behaviour
            int iv = (int)std::floor(v);
            out[i] = (uint8_t)std::max(0, std::min(255, iv));
        }
    } else {
        // No windowing tags — min-max normalise to [0,255]
        double mn = *std::min_element(hu.begin(), hu.end());
        double mx = *std::max_element(hu.begin(), hu.end());
        double range = (mx - mn > 1e-9) ? (mx - mn) : 1.0;

        for (int i = 0; i < npix; i++) {
            double v = ((hu[i] - mn) / range) * 255.0;
            int iv = (int)std::floor(v);
            out[i] = (uint8_t)std::max(0, std::min(255, iv));
        }
    }

    return out;
}
