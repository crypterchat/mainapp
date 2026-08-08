#!/usr/bin/env bash
# Start ChatScan (X11 local chain) + CrypterChat messaging UI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHATSCAN_PORT="${CHATSCAN_PORT:-3000}"
MESSAGING_PORT="${MESSAGING_PORT:-8787}"

mkdir -p "$ROOT/chatscan/data" "$ROOT/messaging/data" "$ROOT/logs"

if ! curl -sf "http://127.0.0.1:${CHATSCAN_PORT}/api/v1/status" >/dev/null 2>&1; then
  echo "Starting ChatScan on :${CHATSCAN_PORT}…"
  (
    cd "$ROOT/chatscan"
    CHATSCAN_PORT="$CHATSCAN_PORT" \
    CHATSCAN_CHAIN_BACKEND=local \
    CHATSCAN_PERSIST=true \
    CHATSCAN_BLOCK_INTERVAL_MS=5000 \
    npm start >"$ROOT/logs/chatscan.log" 2>&1
  ) &
  echo $! >"$ROOT/logs/chatscan.pid"
  for i in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${CHATSCAN_PORT}/api/v1/status" >/dev/null; then break; fi
    sleep 0.25
  done
else
  echo "ChatScan already running on :${CHATSCAN_PORT}"
fi

if ! curl -sf "http://127.0.0.1:${MESSAGING_PORT}/api/health" >/dev/null 2>&1; then
  echo "Starting messaging on :${MESSAGING_PORT}…"
  (
    cd "$ROOT/messaging"
    MESSAGING_PORT="$MESSAGING_PORT" \
    CHATSCAN_URL="http://127.0.0.1:${CHATSCAN_PORT}" \
    DEMO_OTP=123456 \
    npm start >"$ROOT/logs/messaging.log" 2>&1
  ) &
  echo $! >"$ROOT/logs/messaging.pid"
  for i in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${MESSAGING_PORT}/api/health" >/dev/null; then break; fi
    sleep 0.25
  done
else
  echo "Messaging already running on :${MESSAGING_PORT}"
fi

echo
echo "CrypterChat UI     http://127.0.0.1:${MESSAGING_PORT}"
echo "ChatScan explorer  http://127.0.0.1:${CHATSCAN_PORT}"
echo "Demo OTP           123456"
curl -s "http://127.0.0.1:${MESSAGING_PORT}/api/health" | head -c 400
echo
