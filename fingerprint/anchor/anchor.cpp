#include "include/dicom_reader.h"
#include "include/phash.h"
#include "include/rings.h"
#include "include/simg_writer.h"

#include <iostream>
#include <nlohmann/json.hpp>

int main(int argc, char* argv[]) {
    if (argc != 4) {
        std::cerr << "Usage: anchor <dicom_path> <output.simg> <private_key.pem>\n";
        return 1;
    }

    const std::string dicom_path  = argv[1];
    const std::string output_path = argv[2];
    const std::string key_path    = argv[3];

    try {
        // 1. Parse DICOM tags + raw pixel bytes
        DicomTags tags = parse_dicom(dicom_path);
        std::cerr << "[ANCHOR] DICOM parsed: " << tags.cols << "x" << tags.rows << "\n";

        // 2. Apply modality LUT + windowing → 8-bit grayscale
        std::vector<uint8_t> pixels = apply_dicom_windowing(tags);

        // 3. Compute descriptors
        SimgData data;
        data.phash     = compute_phash(pixels, tags.cols, tags.rows);
        data.rings     = compute_rings(pixels, tags.cols, tags.rows);
        data.histogram = compute_histogram(pixels);

        // 4. Write .simg
        write_simg(data, key_path, output_path);
        std::cerr << "[ANCHOR] SIMG written: " << output_path << "\n";

        // 5. JSON stdout
        nlohmann::json out;
        out["status"]    = "OK";
        out["simg_path"] = output_path;
        out["phash"]     = data.phash;
        out["dims"]      = { {"width", tags.cols}, {"height", tags.rows} };
        std::cout << out.dump(2) << "\n";

    } catch (const std::exception& e) {
        nlohmann::json err;
        err["status"]  = "ERROR";
        err["message"] = e.what();
        std::cout << err.dump(2) << "\n";
        std::cerr << "[ANCHOR] ERROR: " << e.what() << "\n";
        return 1;
    }

    return 0;
}
