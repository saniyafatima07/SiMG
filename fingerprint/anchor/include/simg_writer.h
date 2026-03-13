#pragma once
#include <string>
#include <cstdint>
#include "rings.h"

static constexpr size_t   SIMG_SIZE          = 760;
static constexpr uint32_t SIMG_MAGIC         = 0x53494D47;
static constexpr uint16_t SIMG_VERSION       = 0x0001;

static constexpr size_t SIMG_OFF_MAGIC       = 0;
static constexpr size_t SIMG_OFF_VERSION     = 4;
static constexpr size_t SIMG_OFF_FLAGS       = 6;
static constexpr size_t SIMG_OFF_PHASH       = 8;
static constexpr size_t SIMG_OFF_RINGS       = 16;
static constexpr size_t SIMG_OFF_HISTOGRAM   = 144;
static constexpr size_t SIMG_OFF_SHA256      = 656;
static constexpr size_t SIMG_OFF_SIGNATURE   = 688;
static constexpr size_t SIMG_SIG_MAXLEN      = 72;

struct SimgData {
    uint64_t            phash;
    RingDescriptor      rings;
    HistogramDescriptor histogram;
};

void write_simg(const SimgData& data,
                const std::string& private_key_pem,
                const std::string& output_path);
