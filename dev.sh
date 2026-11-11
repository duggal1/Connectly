#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.config/lumen-termd/token"
ROOT_ID="$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-12)"
LOCK_DIR="${TMPDIR:-/tmp}/native-connect-dev-$(id -u)-${ROOT_ID}.lock"
LOCK_OWNER=0
DAEMON_BIN=""
DAEMON_PID=""

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Connectly dev is already running (PID $LOCK_PID). Stop that terminal with Ctrl+C before starting another." >&2
    exit 1
  fi
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR"
fi
LOCK_OWNER=1
printf '%s\n' "$$" > "$LOCK_DIR/pid"

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill -TERM "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
  if [[ -n "$DAEMON_BIN" ]]; then rm -f "$DAEMON_BIN"; fi
  if [[ "$LOCK_OWNER" == "1" ]] && [[ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$LOCK_DIR/pid"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TAILSCALE_IP="${TERMD_LISTEN_HOST:-$(tailscale ip -4 2>/dev/null || true)}"
if [[ -z "$TAILSCALE_IP" ]]; then
  echo "Tailscale is not connected. Connect Tailscale on this Mac before running bun dev." >&2
  exit 1
fi
LISTEN_ADDR="$TAILSCALE_IP:7681"

if lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1; then
  METRO_PIDS="$(lsof -nP -tiTCP:8081 -sTCP:LISTEN | paste -sd ',' -)"
  echo "Metro is already using port 8081 (PID $METRO_PIDS). Stop that Expo process before running bun dev." >&2
  exit 1
fi

if ! curl --silent --show-error --max-time 1 "http://$LISTEN_ADDR/healthz" 2>/dev/null | grep -qx 'ok'; then
  if lsof -nP -iTCP:7681 -sTCP:LISTEN >/dev/null 2>&1; then
    DAEMON_PIDS="$(lsof -nP -tiTCP:7681 -sTCP:LISTEN | paste -sd ',' -)"
    echo "Port 7681 is already in use (PID $DAEMON_PIDS), but termd did not answer at $LISTEN_ADDR. Stop that listener before running bun dev." >&2
    exit 1
  fi
  DAEMON_BIN="$(mktemp "${TMPDIR:-/tmp}/native-connect-termd.XXXXXX")"
  (cd "$ROOT/daemon" && go build -o "$DAEMON_BIN" .)
  env -u LUMEN_TOKEN "$DAEMON_BIN" --token-file "$TOKEN_FILE" --listen "$LISTEN_ADDR" &
  DAEMON_PID=$!
  DAEMON_READY=0
  for _ in {1..50}; do
    if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
      wait "$DAEMON_PID" || true
      echo "termd exited before becoming ready on $LISTEN_ADDR." >&2
      exit 1
    fi
    if curl --silent --max-time 1 -H 'X-Request-ID: dev-startup' "http://$LISTEN_ADDR/healthz" 2>/dev/null | grep -qx 'ok'; then
      DAEMON_READY=1
      break
    fi
    sleep 0.1
  done
  if [[ "$DAEMON_READY" != "1" ]]; then
    echo "termd did not become ready on $LISTEN_ADDR." >&2
    exit 1
  fi
fi

STATS_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 2 "http://$LISTEN_ADDR/api/stats" 2>/dev/null || true)"
if [[ "$STATS_STATUS" == "404" ]]; then
  echo "The daemon at $LISTEN_ADDR is an older build without /api/stats. Stop that daemon and restart bun dev to rebuild it from this source tree." >&2
  exit 1
fi

cd "$ROOT/app"
env -u NO_COLOR ./node_modules/.bin/expo start --tunnel ngrok --port 8081
