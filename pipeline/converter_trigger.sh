#!/usr/bin/env bash
# converter_trigger.sh
# Usage: ./converter_trigger.sh <dicom_path> <mode 0|1>
# Output: prints png path to stdout
set -euo pipefail

CLEAN_CONVERTER="$(dirname "$0")/../converter/converter.py"
EVIL_CONVERTER="$(dirname "$0")/../converter/evil_converter.py"
TMP_PNG="/tmp/converted.png"

if [[ $# -lt 2 ]]; then
    echo "[STEP 2] Usage: $0 <dicom_path> <mode 0|1>" >&2
    exit 1
fi

DICOM_PATH="$1"
MODE="$2"

if [[ "$MODE" == "0" ]]; then
    echo "[STEP 2] Using clean converter" >&2
    python3 "$CLEAN_CONVERTER" "$DICOM_PATH" "$TMP_PNG" >&2
elif [[ "$MODE" == "1" ]]; then
    echo "[STEP 2] Using evil converter (linf attack)" >&2
    python3 "$EVIL_CONVERTER" "$DICOM_PATH" "$TMP_PNG" >&2
else
    echo "[STEP 2] ERROR: mode must be 0 or 1" >&2
    exit 1
fi

if [[ ! -f "$TMP_PNG" ]]; then
    echo "[STEP 2] ERROR: PNG not written" >&2
    exit 1
fi

echo "[STEP 2] PNG written: $TMP_PNG" >&2
echo "$TMP_PNG"
