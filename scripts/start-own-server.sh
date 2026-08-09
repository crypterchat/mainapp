#!/usr/bin/env bash
# Start YOUR own CrypterChat chat server.
# Chat data stays on this machine; message hashes go to ChatScan.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

MESSAGING_PORT="${MESSAGING_PORT:-8787}"
CHATSCAN_URL="${CHATSCAN_URL:-http://127.0.0.1:3000}"
SERVER_NAME="${SERVER_NAME:-My CrypterChat Server}"
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:${MESSAGING_PORT}}"
DEMO_OTP="${DEMO_OTP:-123456}"

mkdir -p "$ROOT/messaging/data" "$ROOT/logs"

# Start a local ChatScan if the configured URL is local and offline.
if [[ "$CHATSCAN_URL" == http://127.0.0.1:* ]] || [[ "$CHATSCAN_URL" == http://localhost:* ]]; then
  if ! curl -sf "${CHATSCAN_URL%/}/api/v1/status" >/dev/null 2>&1; then
    echo "Starting local ChatScan (shared hash chain)…"
    (
      cd "$ROOT/chatscan"
      CHATSCAN_PORT="${CHATSCAN_URL##*:}"
      CHATSCAN_PORT="${CHATSCAN_PORT%%/*}"
      CHATSCAN_PORT="${CHATSCAN_PORT:-3000}"
      CHATSCAN_CHAIN_BACKEND=local CHATSCAN_PERSIST=true CHATSCAN_BLOCK_INTERVAL_MS=5000 \
        npm start >"$ROOT/logs/chatscan.log" 2>&1
    ) &
    echo $! >"$ROOT/logs/chatscan.pid"
    for _ in $(seq 1 40); do
      curl -sf "${CHATSCAN_URL%/}/api/v1/status" >/dev/null && break
      sleep 0.25
    done
  fi
fi

if curl -sf "http://127.0.0.1:${MESSAGING_PORT}/api/health" >/dev/null 2>&1; then
  echo "Chat server already running on :${MESSAGING_PORT}"
else
  echo "Starting your chat server “${SERVER_NAME}” on :${MESSAGING_PORT}…"
  (
    cd "$ROOT/messaging"
    MESSAGING_PORT="$MESSAGING_PORT" \
    CHATSCAN_URL="$CHATSCAN_URL" \
    SERVER_NAME="$SERVER_NAME" \
    PUBLIC_URL="$PUBLIC_URL" \
    DEMO_OTP="$DEMO_OTP" \
      npm start >"$ROOT/logs/messaging.log" 2>&1
  ) &
  echo $! >"$ROOT/logs/messaging.pid"
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:${MESSAGING_PORT}/api/health" >/dev/null && break
    sleep 0.25
  done
fi

echo
echo "Your chat server is up."
echo "  Server name : ${SERVER_NAME}"
echo "  Base URL    : ${PUBLIC_URL}"
echo "  Chat data   : stored on THIS server (${ROOT}/messaging/data)"
echo "  ChatScan    : ${CHATSCAN_URL}  (hashes only)"
echo
echo "In the CrypterChat app:"
echo "  1. Open Server settings (or the login “Chat server URL” field)"
echo "  2. Paste: ${PUBLIC_URL}"
echo "  3. Sign in with your phone number (demo OTP ${DEMO_OTP})"
echo
curl -s "http://127.0.0.1:${MESSAGING_PORT}/api/server"
echo
