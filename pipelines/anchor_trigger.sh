#!/usr/bin/env bash
# step1_anchor.sh
# Usage: ./step1_anchor.sh <dicom_path>
# Output: prints simg path to stdout
set -euo pipefail

ANCHOR_BIN="$(dirname "$0")/../fingerprint/anchor/build/anchor"
PRIVATE_KEY="$(dirname "$0")/../keys/private.pem"
TMP_SIMG="/tmp/ref.simg"

if [[ $# -lt 1 ]]; then
    echo "[STEP 1] Usage: $0 <dicom_path>" >&2
    exit 1
fi

DICOM_PATH="$1"

if [[ ! -f "$DICOM_PATH" ]]; then
    echo "[STEP 1] ERROR: DICOM not found: $DICOM_PATH" >&2
    exit 1
fi

echo "[STEP 1] Running anchor on $DICOM_PATH" >&2

OUTPUT=$("$ANCHOR_BIN" "$DICOM_PATH" "$TMP_SIMG" "$PRIVATE_KEY")

# Anchor logs go to stderr, JSON to stdout
STATUS=$(echo "$OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

if [[ "$STATUS" != "OK" ]]; then
    echo "[STEP 1] ERROR: Anchor failed — $OUTPUT" >&2
    exit 1
fi

echo "[STEP 1] SIMG written: $TMP_SIMG" >&2

# Output simg path for next step
echo "$TMP_SIMG"
