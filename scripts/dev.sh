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
# This script launches dev, detects the live quick-tunnel hostname, and writes
# it into shopify.app.toml. The CLI applies shopify.app.toml changes live
# ("App config updated" → "Updated dev preview"), so the dashboard URL is
# corrected to the live tunnel automatically. On exit it restores the
# placeholder so git stays clean.
#
# Usage: npm run dev   (then press `p` in the Shopify CLI UI to open the app)

set -uo pipefail
cd "$(dirname "$0")/.."

TOML="shopify.app.toml"
PLACEHOLDER="https://example.com"
DEV_PID=""

restore_placeholder() {
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"${PLACEHOLDER}\"|" "$TOML" 2>/dev/null || true
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ ]|" "$TOML" 2>/dev/null || true
}

cleanup() {
  [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null || true
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  restore_placeholder
}
trap cleanup EXIT INT TERM

echo "[dev] starting shopify app dev…"
shopify app dev "$@" &
DEV_PID=$!

echo "[dev] waiting for the Cloudflare quick tunnel…"
TUNNEL=""
for _ in $(seq 1 60); do
  CFPID=$(pgrep -f "cloudflared tunnel" | head -1)
  if [ -n "$CFPID" ]; then
    PORT=$(lsof -nP -p "$CFPID" 2>/dev/null | grep LISTEN | grep -oE '127\.0\.0\.1:[0-9]+' | grep -oE '[0-9]+$' | head -1)
    if [ -n "$PORT" ]; then
      TUNNEL=$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/quicktunnel" 2>/dev/null | grep -oE '[a-z0-9-]+\.trycloudflare\.com')
      [ -n "$TUNNEL" ] && break
    fi
  fi
  kill -0 "$DEV_PID" 2>/dev/null || { echo "[dev] shopify app dev exited early."; exit 1; }
  sleep 2
done

if [ -n "$TUNNEL" ]; then
  echo "[dev] live tunnel: https://${TUNNEL} — syncing into ${TOML}"
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"https://${TUNNEL}\"|" "$TOML"
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ \"https://${TUNNEL}/auth/callback\", \"https://${TUNNEL}/auth/shopify/callback\", \"https://${TUNNEL}/shopify/auth/callback\" ]|" "$TOML"
  echo "[dev] ✅ app URL is now the live tunnel. Press 'p' in the CLI UI to open the app."
else
  echo "[dev] ⚠️  couldn't detect a tunnel; the embedded app may load a stale URL."
fi

wait "$DEV_PID"
