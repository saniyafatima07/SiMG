#!/usr/bin/env bash
# inference_trigger.sh
set -euo pipefail

CLEAN_PNG="$1"
PIPELINE_DIR="$(dirname "$0")/../inference-pipeline"

cd "$PIPELINE_DIR"

if [[ ! -d ".venv" ]]; then
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip -q
    .venv/bin/pip install -r requirements.txt -q
fi

.venv/bin/python3 app.py "$CLEAN_PNG"
