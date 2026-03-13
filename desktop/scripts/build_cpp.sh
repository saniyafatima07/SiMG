#!/bin/sh
# scripts/build_cpp.sh — Build anchor and verifier binaries for DICOM Guardian.
# Run from anywhere; paths are resolved relative to this script's location.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_ROOT/.." && pwd)"

if ! command -v cmake > /dev/null 2>&1; then
    echo "✗ cmake not found. Install with: sudo apt install cmake" >&2; exit 1
fi
if ! command -v make > /dev/null 2>&1; then
    echo "✗ make not found. Install with: sudo apt install build-essential" >&2; exit 1
fi

JOBS="$(nproc 2>/dev/null || echo 4)"
echo "=== Building C++ binaries ($JOBS jobs) ==="

echo "── Building anchor..."
mkdir -p "$REPO_ROOT/fingerprint/anchor/build"
cd "$REPO_ROOT/fingerprint/anchor/build" || exit 1
cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$JOBS" || { echo "✗ anchor FAILED" >&2; exit 1; }
echo "✓ anchor built: $REPO_ROOT/fingerprint/anchor/build/anchor"

echo "── Building verifier..."
mkdir -p "$REPO_ROOT/fingerprint/verifier/build"
cd "$REPO_ROOT/fingerprint/verifier/build" || exit 1
cmake .. -DCMAKE_BUILD_TYPE=Release && make -j"$JOBS" || { echo "✗ verifier FAILED" >&2; exit 1; }
echo "✓ verifier built: $REPO_ROOT/fingerprint/verifier/build/verifier"

echo "=== All binaries built ==="
