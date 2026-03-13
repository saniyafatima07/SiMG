#pragma once
#include <string>
#include <cstdint>
#include "../../anchor/include/rings.h"
#include "../../anchor/include/simg_writer.h"

// Read and verify a .simg file.
// Throws std::runtime_error if:
//   - file is wrong size
//   - magic/version mismatch
//   - SHA-256 integrity check fails
//   - ECDSA signature is invalid
// Returns parsed SimgData on success.
SimgData read_and_verify_simg(const std::string& simg_path,
                               const std::string& public_key_pem);
