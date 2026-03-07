#!/bin/bash
# Backward-compatible wrapper. The real script is sync-prod.sh.
exec "$(dirname "$0")/sync-prod.sh" "$@"
