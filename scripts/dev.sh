#!/usr/bin/env bash
#
# Wrapper around `shopify app dev` for local development (macOS).
#
# Why this exists: on this setup the Shopify CLI serves the embedded app at
# whatever `application_url` is in shopify.app.toml instead of substituting the
# Cloudflare *quick tunnel* it spins up — and quick tunnels get a new random
# hostname every run. So application_url is always stale on the next start and
# the embedded app fails to load ("server IP address could not be found").
#
# This script launches dev, waits until the quick tunnel exists AND the CLI is
# watching for changes, then writes the live tunnel into shopify.app.toml. The
# CLI applies shopify.app.toml changes live ("App config updated" -> "Updated
# dev preview" -> "Using URL: https://<tunnel>"), so the dashboard URL is
# corrected automatically. Restores the placeholder on exit to keep git clean.
#
# Usage: npm run dev   (then press `p` in the Shopify CLI UI to open the app)

set -uo pipefail
cd "$(dirname "$0")/.."

TOML="shopify.app.toml"
PLACEHOLDER="https://example.com"
DEV_PID=""
TAIL_PID=""
LOG="$(mktemp -t mv-dev.XXXXXX)"

restore_placeholder() {
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"${PLACEHOLDER}\"|" "$TOML" 2>/dev/null || true
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ ]|" "$TOML" 2>/dev/null || true
}

cleanup() {
  [ -n "$TAIL_PID" ] && kill "$TAIL_PID" 2>/dev/null || true
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  restore_placeholder
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

set_url() {
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"$1\"|" "$TOML"
}

get_tunnel() {
  local cfpid port
  cfpid=$(pgrep -f "cloudflared tunnel" | head -1)
  [ -z "$cfpid" ] && return 0
  port=$(lsof -nP -p "$cfpid" 2>/dev/null | grep LISTEN | grep -oE '127\.0\.0\.1:[0-9]+' | grep -oE '[0-9]+$' | head -1)
  [ -z "$port" ] && return 0
  curl -s --max-time 5 "http://127.0.0.1:${port}/quicktunnel" 2>/dev/null | grep -oE '[a-z0-9-]+\.trycloudflare\.com'
}

echo "[dev] starting shopify app dev…"
shopify app dev "$@" >"$LOG" 2>&1 &
DEV_PID=$!
tail -f "$LOG" & TAIL_PID=$!   # stream the CLI UI to this terminal

# Wait until BOTH the tunnel is up AND the CLI is watching for changes, so the
# toml write is reliably picked up as a live change (this avoids the race where
# the CLI reads application_url before we've written the tunnel).
TUNNEL=""
for _ in $(seq 1 90); do
  [ -z "$TUNNEL" ] && TUNNEL="$(get_tunnel)"
  if [ -n "$TUNNEL" ] && grep -q "Ready, watching for changes" "$LOG"; then break; fi
  kill -0 "$DEV_PID" 2>/dev/null || { echo "[dev] shopify app dev exited early."; exit 1; }
  sleep 2
done

if [ -n "$TUNNEL" ]; then
  echo "[dev] live tunnel: https://${TUNNEL} — syncing into ${TOML}"
  # Force a real content change (placeholder -> tunnel) so the watcher fires.
  set_url "$PLACEHOLDER"
  sleep 1
  set_url "https://${TUNNEL}"
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ \"https://${TUNNEL}/auth/callback\", \"https://${TUNNEL}/auth/shopify/callback\", \"https://${TUNNEL}/shopify/auth/callback\" ]|" "$TOML"
  # Confirm the CLI applied it.
  for _ in $(seq 1 12); do
    if grep -q "Using URL: https://${TUNNEL}" "$LOG"; then
      echo "[dev] ✅ app is served at https://${TUNNEL} — press 'p' in the CLI UI to open it."
      break
    fi
    sleep 1
  done
else
  echo "[dev] ⚠️  couldn't detect a tunnel; the embedded app may load a stale URL."
fi

wait "$DEV_PID"
