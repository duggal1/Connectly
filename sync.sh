#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.config/lumen-termd/token"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale is not installed on this Mac." >&2
  exit 1
fi

HOST="$(tailscale ip -4 2>/dev/null || true)"
if [[ -z "$HOST" ]]; then
  echo "Tailscale is not connected on this Mac." >&2
  exit 1
fi

TOKEN="$(cd "$ROOT/daemon" && env -u LUMEN_TOKEN go run . --token-file "$TOKEN_FILE" --print-token)"
if [[ -z "$TOKEN" ]]; then
  echo "Could not read the persistent daemon token." >&2
  exit 1
fi

STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 3 \
  -H "Authorization: Bearer $TOKEN" \
  "http://$HOST:7681/api/sessions" 2>/dev/null || true)"

printf 'Host:  %s\nPort:  7681\nToken: %s\nTLS:   Off\n' "$HOST" "$TOKEN"
case "$STATUS" in
  200) echo "Daemon check: token accepted" ;;
  401) echo "Daemon check: token rejected; restart the daemon with bun dev" ;;
  429) echo "Daemon check: rate limited; restart the daemon with bun dev" ;;
  000|"") echo "Daemon check: stopped or unreachable; start bun dev and leave it running" ;;
  *) echo "Daemon check: HTTP $STATUS from the daemon" ;;
esac
