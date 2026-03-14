#!/usr/bin/env bash
# run.sh — DICOM Guardian master controller
# Usage: ./simg.sh <dicom_path> [converter_mode]
#   converter_mode: 0 = clean (default), 1 = evil (attack simulation)
set -euo pipefail

PIPELINE_DIR="$(dirname "$0")/pipelines"

echo "╔══════════════════════════════════════════╗" >&2
echo "║        DICOM Guardian Pipeline           ║" >&2
echo "╚══════════════════════════════════════════╝" >&2

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <dicom_path> [0=clean|1=evil]" >&2
    exit 1
fi

DICOM_PATH="$1"
CONVERTER_MODE="${2:-0}"

if [[ ! -f "$DICOM_PATH" ]]; then
    echo "[RUN] ERROR: DICOM file not found: $DICOM_PATH" >&2
    exit 1
fi

echo "[RUN] DICOM     : $DICOM_PATH" >&2
echo "[RUN] Converter : $([ "$CONVERTER_MODE" == "0" ] && echo "clean" || echo "evil (attack sim)")" >&2
echo "" >&2

echo "[RUN] ── Step 1: Fingerprinting DICOM ──" >&2
SIMG_PATH=$(bash "$PIPELINE_DIR/anchor_trigger.sh" "$DICOM_PATH")
if [[ -z "$SIMG_PATH" ]]; then
    echo "[RUN] ERROR: Anchor returned no simg path" >&2
    exit 1
fi
echo "" >&2

echo "[RUN] ── Step 2: Converting DICOM → PNG ──" >&2
PNG_PATH=$(bash "$PIPELINE_DIR/converter_trigger.sh" "$DICOM_PATH" "$CONVERTER_MODE")
if [[ -z "$PNG_PATH" ]]; then
    echo "[RUN] ERROR: Converter returned no png path" >&2
    exit 1
fi
echo "" >&2

echo "[RUN] ── Step 3: Verifying integrity ──" >&2
CLEAN_PNG=$(bash "$PIPELINE_DIR/verification_sandbox_trigger.sh" "$PNG_PATH" "$SIMG_PATH") || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 2 ]]; then
        echo "" >&2
        echo "[RUN] ██  PIPELINE HALTED — ATTACK DETECTED  ██" >&2
        python3 -c "import json; print(json.dumps({'status':'HALTED','reason':'ATTACK_DETECTED','message':'Converter integrity check failed. Image rejected.'}, indent=2))"
    else
        echo "[RUN] ERROR: Verification error (exit $EXIT_CODE)" >&2
        python3 -c "import json; print(json.dumps({'status':'ERROR','reason':'VERIFICATION_ERROR'}, indent=2))"
    fi
    exit $EXIT_CODE
}
echo "" >&2

echo "[RUN] ── Step 4: Running inference ──" >&2
RESULT=$(bash "$PIPELINE_DIR/inference_trigger.sh" "$CLEAN_PNG")
echo "" >&2

echo "[RUN] ── Pipeline complete ──" >&2
echo "$RESULT"
