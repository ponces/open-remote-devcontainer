#!/usr/bin/env bash
# Added by openremotedevcontainer: entrypoint
set -euo pipefail

# Stop file written by remote extension deactivate()
STOP_FILE="${CODIUM_WS:-/workspace}/.open-remote-devcontainer-stop"

CHECK_INTERVAL=${CHECK_INTERVAL:-2}

# Poll for stop file
while true; do
  if [ -f "$STOP_FILE" ]; then
    rm -f "$STOP_FILE" || true
  fi
  sleep "$CHECK_INTERVAL"
done
