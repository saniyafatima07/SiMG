#include "dicom_reader.h"
#include <fstream>
#include <stdexcept>
#include <cstring>
#include <cmath>
#include <algorithm>

#include <jpeglib.h>
#include <cstdio>

// ─────────────────────────────────────────────
//  DICOM tag constants (group, element)
// ─────────────────────────────────────────────
static constexpr uint32_t TAG_TRANSFER_SYNTAX    = 0x00020010;
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

// Sequence delimiters
static constexpr uint32_t TAG_ITEM              = 0xFFFEE000;
static constexpr uint32_t TAG_ITEM_DELIM        = 0xFFFEE00D;
static constexpr uint32_t TAG_SEQ_DELIM         = 0xFFFEE0DD;

// Known JPEG transfer syntax UIDs
static bool is_jpeg_transfer_syntax(const std::string& ts) {
    // JPEG Baseline  : 1.2.840.10008.1.2.4.50
    // JPEG Extended   : 1.2.840.10008.1.2.4.51
    // JPEG Lossless   : 1.2.840.10008.1.2.4.57
    // JPEG Lossless FP: 1.2.840.10008.1.2.4.70
    // JPEG 2000       : 1.2.840.10008.1.2.4.90 / .91
    return (ts.find("1.2.840.10008.1.2.4.") == 0);
}

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
    // Take first value only (multiple values separated by '\\')
    size_t pos = s.find('\\');
    std::string first = (pos != std::string::npos) ? s.substr(0, pos) : s;
    try { return std::stod(first); }
    catch (...) { return 0.0; }
}

// Trim trailing whitespace/nulls from a DICOM string
static std::string trim_dicom_string(const uint8_t* data, uint32_t len) {
    std::string s(reinterpret_cast<const char*>(data), len);
    while (!s.empty() && (s.back() == ' ' || s.back() == '\0'))
        s.pop_back();
    return s;
}

// ─────────────────────────────────────────────
//  JPEG decompression via libjpeg
//  Input: raw JPEG bytes
//  Output: grayscale uint8 pixel values
// ─────────────────────────────────────────────
static std::vector<uint8_t> decompress_jpeg(const uint8_t* jpeg_data, size_t jpeg_size,
                                             int& out_width, int& out_height)
{
    struct jpeg_decompress_struct cinfo;
    struct jpeg_error_mgr jerr;

    cinfo.err = jpeg_std_error(&jerr);
    jpeg_create_decompress(&cinfo);

    jpeg_mem_src(&cinfo, jpeg_data, jpeg_size);

    if (jpeg_read_header(&cinfo, TRUE) != JPEG_HEADER_OK) {
        jpeg_destroy_decompress(&cinfo);
        throw std::runtime_error("JPEG decompression: invalid JPEG header in DICOM pixel data");
    }

    // Force grayscale output
    cinfo.out_color_space = JCS_GRAYSCALE;
    jpeg_start_decompress(&cinfo);

    out_width  = (int)cinfo.output_width;
    out_height = (int)cinfo.output_height;
    int row_stride = cinfo.output_width * cinfo.output_components;

    std::vector<uint8_t> pixels(out_width * out_height);

    while (cinfo.output_scanline < cinfo.output_height) {
        uint8_t* row_ptr = pixels.data() + cinfo.output_scanline * out_width;
        jpeg_read_scanlines(&cinfo, &row_ptr, 1);
    }

    jpeg_finish_decompress(&cinfo);
    jpeg_destroy_decompress(&cinfo);

    return pixels;
}

// ─────────────────────────────────────────────
//  Extract JPEG frame from encapsulated pixel data
//  DICOM encapsulated format:
//    Item tag (FFFE,E000) + 4-byte length → offset table (usually empty/zero)
//    Item tag (FFFE,E000) + 4-byte length → JPEG frame bytes
//    ...
//    Sequence Delimiter (FFFE,E0DD)
// ─────────────────────────────────────────────
static std::vector<uint8_t> extract_first_jpeg_frame(const uint8_t* buf, size_t buf_size,
                                                      size_t start_offset)
{
    size_t off = start_offset;

    // 1. Read the offset table item (we skip it)
    if (off + 8 > buf_size) throw std::runtime_error("Encapsulated pixel data: truncated offset table");
    uint32_t item_tag = ((uint32_t)read_u16(buf + off) << 16) | read_u16(buf + off + 2);
    uint32_t item_len = read_u32(buf + off + 4);
    off += 8;

    if (item_tag != TAG_ITEM)
        throw std::runtime_error("Encapsulated pixel data: expected Item tag for offset table");

    // Skip offset table contents
    off += item_len;

    // 2. Read the first actual JPEG frame item
    if (off + 8 > buf_size) throw std::runtime_error("Encapsulated pixel data: no JPEG frame found");
    item_tag = ((uint32_t)read_u16(buf + off) << 16) | read_u16(buf + off + 2);
    item_len = read_u32(buf + off + 4);
    off += 8;

    if (item_tag == TAG_SEQ_DELIM)
        throw std::runtime_error("Encapsulated pixel data: sequence delimiter before any frame");

    if (item_tag != TAG_ITEM)
        throw std::runtime_error("Encapsulated pixel data: expected Item tag for JPEG frame");

    if (off + item_len > buf_size)
        throw std::runtime_error("Encapsulated pixel data: JPEG frame extends past EOF");

    return std::vector<uint8_t>(buf + off, buf + off + item_len);
}

// ─────────────────────────────────────────────
//  DICOM parser — explicit little-endian transfer syntax
//  Handles both implicit and explicit VR.
//  Now also handles JPEG-compressed encapsulated pixel data.
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
    bool is_jpeg = false;     // set after parsing transfer syntax

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

        // Undefined length (0xFFFFFFFF) — could be encapsulated pixel data
        if (vlen == 0xFFFFFFFF) {
            if (tag == TAG_PIXEL_DATA && is_jpeg) {
                // ── Encapsulated JPEG pixel data ──
                std::vector<uint8_t> jpeg_frame = extract_first_jpeg_frame(
                    buf.data(), fsize, offset);

                int jpeg_w = 0, jpeg_h = 0;
                tags.raw_bytes = decompress_jpeg(jpeg_frame.data(), jpeg_frame.size(),
                                                  jpeg_w, jpeg_h);
                tags.compressed = true;

                // Update dims from JPEG if not already set
                if (tags.rows == 0) tags.rows = jpeg_h;
                if (tags.cols == 0) tags.cols = jpeg_w;

                // Override to 8-bit since JPEG baseline produces 8-bit output
                tags.bits_allocated = 8;
                tags.bits_stored = 8;
                tags.pixel_representation = 0;  // unsigned

                // Skip past the encapsulated sequence to find the delimiter
                while (offset + 8 <= fsize) {
                    uint32_t itag = ((uint32_t)read_u16(buf.data() + offset) << 16) |
                                     read_u16(buf.data() + offset + 2);
                    uint32_t ilen = read_u32(buf.data() + offset + 4);
                    offset += 8;
                    if (itag == TAG_SEQ_DELIM) break;
                    if (ilen != 0xFFFFFFFF) offset += ilen;
                }
                continue;
            }

            // Other undefined-length tags (sequences) — skip items until delimiter
            while (offset + 8 <= fsize) {
                uint32_t itag = ((uint32_t)read_u16(buf.data() + offset) << 16) |
                                 read_u16(buf.data() + offset + 2);
                uint32_t ilen = read_u32(buf.data() + offset + 4);
                offset += 8;
                if (itag == TAG_SEQ_DELIM) break;
                if (ilen != 0xFFFFFFFF) offset += ilen;
            }
            continue;
        }

        if (offset + vlen > fsize) break;
        const uint8_t* vdata = buf.data() + offset;

        // ── Extract tags we care about ──────────
        switch (tag) {
            case TAG_TRANSFER_SYNTAX: {
                tags.transfer_syntax = trim_dicom_string(vdata, vlen);
                is_jpeg = is_jpeg_transfer_syntax(tags.transfer_syntax);
                break;
            }
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
                if (!tags.compressed) {
                    tags.raw_bytes.assign(vdata, vdata + vlen);
                }
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
//
//  For JPEG-decompressed data, pixels are already 8-bit grayscale,
//  so windowing typically acts as a passthrough (slope=1, intercept=0).
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
