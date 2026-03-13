cmake_minimum_required(VERSION 3.20)
project(verifier CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ── Dependencies ─────────────────────────────
find_package(OpenSSL REQUIRED)
find_package(PNG REQUIRED)

# ── Target ───────────────────────────────────
add_executable(verifier
    verifier.cpp
    simg_reader.cpp
    compare.cpp
    # Pull in shared implementation from anchor
    ../anchor/phash.cpp
    ../anchor/rings.cpp
)

target_include_directories(verifier PRIVATE
    # Verifier's own headers
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    # Anchor headers (rings.h, phash.h, simg_writer.h referenced by simg_reader.h)
    ${CMAKE_CURRENT_SOURCE_DIR}/../anchor/include
    ${OPENSSL_INCLUDE_DIR}
    ${PNG_INCLUDE_DIRS}
)

target_link_libraries(verifier PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
    ${PNG_LIBRARIES}
)

target_compile_options(verifier PRIVATE -O2 -Wall -Wextra)

# ── Install ──────────────────────────────────
install(TARGETS verifier DESTINATION bin)
