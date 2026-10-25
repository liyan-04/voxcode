#!/bin/sh
set -eu
SCRIPT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ "${1:-}" = '--help' ] || [ "${1:-}" = '-h' ]; then
  printf '%s\n' 'Usage: ./publish.sh --output NEW_BUNDLE [--qup QUP_BIN]'
  exit 0
fi
exec node "$SCRIPT_ROOT/scripts/control/upload-master.mjs" --root "$SCRIPT_ROOT" "$@"
