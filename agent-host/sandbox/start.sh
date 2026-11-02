#!/bin/sh
# The sandbox stays up, and each message runs `opencode run` in it (docker exec).
mkdir -p "$HOME/.cache/opencode" && cp -n /opt/agent/models.json "$HOME/.cache/opencode/models.json" 2>/dev/null
exec sleep infinity
