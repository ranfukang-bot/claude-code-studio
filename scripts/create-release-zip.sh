#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/.."
zip -r claude-code-studio.zip claude-code-studio \
  -x "claude-code-studio/node_modules/*" \
  -x "claude-code-studio/dist/*" \
  -x "claude-code-studio/release/*"
