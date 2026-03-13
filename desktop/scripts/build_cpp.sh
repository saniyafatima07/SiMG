#!/bin/sh
# scripts/build_cpp.sh — Build all C++ binaries for DICOM Guardian.
# Run from the Desktop root directory: bash scripts/build_cpp.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check for required build tools
if ! command -v cmake > /dev/null 2>&1; then
    echo "✗ cmake not found. Install with: sudo apt install cmake" >&2
    exit 1
fi
if ! command -v make > /dev/null 2>&1; then
    echo "✗ make not found. Install with: sudo apt install build-essential" >&2
    exit 1
fi

JOBS="$(nproc 2>/dev/null || echo 4)"
echo "=== Building C++ binaries for DICOM Guardian (using $JOBS jobs) ==="

# ── Anchor (fingerprint generator) ──────────────────────────────────────────
echo ""
echo "── Building anchor..."
mkdir -p "$DESKTOP_ROOT/cpp/anchor/build"
cd "$DESKTOP_ROOT/cpp/anchor/build" || exit 1
cmake .. -DCMAKE_BUILD_TYPE=Release
if make -j"$JOBS"; then
    echo "✓ anchor built successfully: $DESKTOP_ROOT/cpp/anchor/build/anchor"
else
    echo "✗ anchor build FAILED" >&2
    exit 1
fi

# ── Verifier ─────────────────────────────────────────────────────────────────
cd "$DESKTOP_ROOT" || exit 1
echo ""
echo "── Building verifier..."
mkdir -p "$DESKTOP_ROOT/cpp/verifier/build"
cd "$DESKTOP_ROOT/cpp/verifier/build" || exit 1
cmake .. -DCMAKE_BUILD_TYPE=Release
if make -j"$JOBS"; then
    echo "✓ verifier built successfully: $DESKTOP_ROOT/cpp/verifier/build/verifier"
else
    echo "✗ verifier build FAILED" >&2
    exit 1
fi

echo ""
echo "=== All C++ binaries built successfully ==="
