cmake_minimum_required(VERSION 3.20)
project(anchor CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ── Dependencies ─────────────────────────────
find_package(OpenSSL REQUIRED)

# nlohmann/json — single header, fetched into <binary_dir>/nlohmann/json.hpp
include(FetchContent)
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp
  DOWNLOAD_NO_EXTRACT TRUE
  DOWNLOAD_DIR ${CMAKE_BINARY_DIR}/include/nlohmann
)
FetchContent_MakeAvailable(nlohmann_json)

# ── Target ───────────────────────────────────
add_executable(anchor
    anchor.cpp
    dicom_reader.cpp
    phash.cpp
    rings.cpp
    simg_writer.cpp
)
target_include_directories(anchor PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_BINARY_DIR}/include
    ${OPENSSL_INCLUDE_DIR}
)
target_link_libraries(anchor PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
)
target_compile_options(anchor PRIVATE -O2 -Wall -Wextra)

# ── Install ──────────────────────────────────
install(TARGETS anchor DESTINATION bin)
