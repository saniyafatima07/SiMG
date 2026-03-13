#!/usr/bin/env bash
# verification_sandbox_trigger.sh
# Usage: ./verification_sandbox_trigger.sh <png_path> <simg_path>
# Output: prints clean png path to stdout if PASS, exits 2 if FAIL
set -euo pipefail

VERIFIER_BIN="$(dirname "$0")/../fingerprint/verifier/build/verifier"
PUBLIC_KEY="$(dirname "$0")/../keys/public.pem"

if [[ $# -lt 2 ]]; then
    echo "[STEP 3] Usage: $0 <png_path> <simg_path>" >&2
    exit 1
fi

PNG_PATH="$1"
SIMG_PATH="$2"

echo "[STEP 3] Launching verification enclosure" >&2
echo "[STEP 3] PNG:  $PNG_PATH" >&2
echo "[STEP 3] SIMG: $SIMG_PATH" >&2

# Run verifier — disable pipefail temporarily so non-zero exit doesn't kill us
# stderr (logs) go to terminal, stdout (JSON) goes to file
set +e
"$VERIFIER_BIN" "$PNG_PATH" "$SIMG_PATH" "$PUBLIC_KEY" \
    2>&1 1>/tmp/verifier_out.json | cat >&2
VERIFIER_EXIT=$?
set -e

VERDICT_JSON=$(cat /tmp/verifier_out.json)
echo "[STEP 3] Verdict JSON: $VERDICT_JSON" >&2

VERDICT=$(echo "$VERDICT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['verdict'])")
SCORE=$(echo "$VERDICT_JSON"   | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])")

if [[ "$VERDICT" == "PASS" ]]; then
    echo "[STEP 3] PASS — score: $SCORE — image integrity verified" >&2
    echo "$PNG_PATH"

elif [[ "$VERDICT" == "FAIL" ]]; then
    echo "[STEP 3] ATTACK DETECTED — pipeline halted" >&2
    echo "[STEP 3] Score: $SCORE (threshold: 0.85)" >&2
    HAMMING=$(echo "$VERDICT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['hamming'])")
    KL=$(echo "$VERDICT_JSON"      | python3 -c "import sys,json; print(json.load(sys.stdin)['kl_divergence'])")
    RING=$(echo "$VERDICT_JSON"    | python3 -c "import sys,json; print(json.load(sys.stdin)['max_ring_dev'])")
    echo "[STEP 3] Hamming: $HAMMING  KL: $KL  Ring dev: $RING" >&2
    exit 2

else
    echo "[STEP 3] ERROR: unexpected verdict: $VERDICT_JSON" >&2
    exit 3
fi
