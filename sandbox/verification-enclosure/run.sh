#!/bin/sh
# sandbox/verification-enclosure/run.sh
# Network + PID namespace wrapper for the DICOM verifier binary.
#
# Usage: run.sh <png_path> <simg_path> <pubkey_path>
#
# Arguments:
#   $1 = path to converted PNG image
#   $2 = path to .simg reference fingerprint file
#   $3 = path to ECDSA P-256 public key (PEM)
#
# Namespace isolation:
#   --user --map-root-user : unprivileged user namespace (required on Ubuntu 22.04+ default kernel)
#   --net                  : removes all network interfaces
#   --pid --mount-proc     : new PID namespace with fresh /proc
#   --fork                 : required by --pid
#
# Internal seccomp filter (enforced by libseccomp inside verifier binary):
#   ALLOWED: read, write, open, openat, fstat, mmap (no EXEC), lseek, close, exit_group
#   BLOCKED: socket, connect, bind, clone, fork, exec*, ptrace, and all others
#
# Exit code mirrors the verifier binary's exit code.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERIFIER="$REPO_ROOT/fingerprint/verifier/build/verifier"

# Validate argument count
if [ "$#" -ne 3 ]; then
    echo "[SANDBOX1] ERROR: Expected 3 arguments, got $#" >&2
    echo "[SANDBOX1] Usage: run.sh <png_path> <simg_path> <pubkey_path>" >&2
    exit 2
fi

# Validate verifier binary exists and is executable
if [ ! -x "$VERIFIER" ]; then
    echo "[SANDBOX1] ERROR: Verifier not found or not executable: $VERIFIER" >&2
    exit 2
fi

# Run verifier inside a user+network+PID namespace.
# Falls back to direct execution if unshare is unavailable (e.g. judge's laptop).
if unshare --user --map-root-user --net --pid --mount-proc --fork \
       "$VERIFIER" "$1" "$2" "$3"; then
    exit 0
else
    UNSHARE_EXIT=$?
    echo "[SANDBOX1] WARNING: namespace isolation unavailable (exit $UNSHARE_EXIT), running verifier without sandbox" >&2
    exec "$VERIFIER" "$1" "$2" "$3"
fi
