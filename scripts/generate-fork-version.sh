#!/usr/bin/env bash
# Generates server/fork-version.json with current git commit info.
# Run before build or as part of CI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$ROOT_DIR/server/fork-version.json"

HASH=$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
DATE=$(git -C "$ROOT_DIR" log -1 --format=%cI 2>/dev/null || echo "unknown")
BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

cat > "$OUT" <<EOF
{
  "commitHash": "$HASH",
  "commitDate": "$DATE",
  "branch": "$BRANCH"
}
EOF

echo "Generated $OUT: $HASH (${DATE})"
