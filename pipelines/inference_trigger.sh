#!/usr/bin/env bash
# inference_trigger.sh — stub
set -euo pipefail
CLEAN_PNG="$1"
echo "[STEP 4] STUB — inference not yet implemented" >&2
python3 -c "import json; print(json.dumps({'status':'STUB','input':'$CLEAN_PNG','diagnosis':None}, indent=2))"
