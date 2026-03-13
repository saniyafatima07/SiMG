#!/usr/bin/env bash
# sandbox/verification-enclosure/run.sh
# Runs verifier inside seccomp-BPF sandbox via systemd-run
# Called by step3_verify.sh — do not call directly
# Usage: ./run.sh <png_path> <simg_path> <public_key_path>
# Output: verifier JSON to stdout, logs to stderr
set -euo pipefail

VERIFIER_BIN="$(dirname "$0")/../../fingerprint/verifier/build/verifier"

if [[ $# -lt 3 ]]; then
    echo "[SANDBOX] ERROR: Usage: $0 <png> <simg> <pubkey>" >&2
    exit 1
fi

PNG_PATH="$1"
SIMG_PATH="$2"
PUBKEY_PATH="$3"

# Verify all inputs exist before entering sandbox
for f in "$PNG_PATH" "$SIMG_PATH" "$PUBKEY_PATH" "$VERIFIER_BIN"; do
    if [[ ! -f "$f" ]]; then
        echo "[SANDBOX] ERROR: File not found: $f" >&2
        exit 1
    fi
done

echo "[SANDBOX] Entering seccomp-BPF verification enclosure" >&2

# systemd-run constraints:
#   --scope                  → run as transient scope unit
#   NoNewPrivileges          → cannot escalate privileges
#   PrivateTmp               → isolated /tmp
#   PrivateNetwork           → no network access
#   ProtectSystem=strict     → filesystem read-only except explicit paths
#   MemoryMax                → cap memory at 256MB
#   CPUQuota                 → cap CPU at 50%
#   SystemCallFilter         → whitelist only syscalls verifier needs
#     @basic-io              → read/write/open/close
#     @file-system           → stat/access/mmap
#     @process               → exit/wait
#     @crypto                → needed for OpenSSL ECDSA verify
#     mmap/mprotect          → needed by OpenSSL
#   BindReadOnlyPaths        → explicitly allow only the 3 input files

if command -v systemd-run &>/dev/null && systemd-run --scope echo "" &>/dev/null 2>&1; then
    systemd-run --scope \
        --property=NoNewPrivileges=yes \
        --property=PrivateTmp=yes \
        --property=PrivateNetwork=yes \
        --property=ProtectSystem=strict \
        --property=MemoryMax=256M \
        --property=CPUQuota=50% \
        --property=SystemCallFilter="@basic-io @file-system @process @crypto mmap mprotect" \
        --property=BindReadOnlyPaths="$PNG_PATH $SIMG_PATH $PUBKEY_PATH" \
        -- "$VERIFIER_BIN" "$PNG_PATH" "$SIMG_PATH" "$PUBKEY_PATH"
else
    # Fallback: systemd-run not available (e.g. Docker CI)
    # Still run verifier but without sandbox — log warning
    echo "[SANDBOX] WARNING: systemd-run not available, running without seccomp jail" >&2
    "$VERIFIER_BIN" "$PNG_PATH" "$SIMG_PATH" "$PUBKEY_PATH"
fi
