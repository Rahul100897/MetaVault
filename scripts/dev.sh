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
# The CLI runs in the FOREGROUND so its interactive UI works (press `p` to open
# the app, `q` to quit). A background job waits for the quick tunnel, then
# writes it into shopify.app.toml; the CLI applies toml changes live
# ("App config updated" -> "Updated dev preview" -> "Using URL: https://<tunnel>").
# The placeholder is restored on exit to keep git clean.
#
# Usage: npm run dev   (then press `p` to open the app once you see the ✅ line)

set -uo pipefail
cd "$(dirname "$0")/.."

TOML="shopify.app.toml"
PLACEHOLDER="https://example.com"
SYNC_PID=""

restore_placeholder() {
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"${PLACEHOLDER}\"|" "$TOML" 2>/dev/null || true
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ ]|" "$TOML" 2>/dev/null || true
}

set_url() {
  sed -i '' -E "s|^application_url = \".*\"|application_url = \"$1\"|" "$TOML"
}

set_redirects() {
  sed -i '' -E "s|^redirect_urls = \[.*\]|redirect_urls = [ \"$1/auth/callback\", \"$1/auth/shopify/callback\", \"$1/shopify/auth/callback\" ]|" "$TOML"
}

get_tunnel() {
  local cfpid port
  cfpid=$(pgrep -f "cloudflared tunnel" | head -1)
  [ -z "$cfpid" ] && return 0
  port=$(lsof -nP -p "$cfpid" 2>/dev/null | grep LISTEN | grep -oE '127\.0\.0\.1:[0-9]+' | grep -oE '[0-9]+$' | head -1)
  [ -z "$port" ] && return 0
  curl -s --max-time 5 "http://127.0.0.1:${port}/quicktunnel" 2>/dev/null | grep -oE '[a-z0-9-]+\.trycloudflare\.com'
}

# Runs in the background: detect the tunnel and write it into the toml. Forces a
# real content change (placeholder -> tunnel) so the CLI's file watcher fires,
# and does it twice in case the first attempt lands before the watcher is ready.
sync_tunnel() {
  local tunnel="" i
  for i in $(seq 1 90); do
    tunnel="$(get_tunnel)"
    [ -n "$tunnel" ] && break
    sleep 2
  done
  if [ -z "$tunnel" ]; then
    printf '\n[dev] ⚠️  no tunnel detected — if the app fails to load, open it from Shopify Admin › Apps.\n'
    return
  fi
  local attempt
  for attempt in 1 2; do
    sleep 4
    set_url "$PLACEHOLDER"; sleep 1
    set_url "https://${tunnel}"; set_redirects "https://${tunnel}"
  done
  printf '\n[dev] ✅ live tunnel synced: https://%s\n[dev]    Press '\''p'\'' to open it (or Shopify Admin › Apps › MetaVault).\n' "$tunnel"
}

cleanup() {
  [ -n "$SYNC_PID" ] && kill "$SYNC_PID" 2>/dev/null || true
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  restore_placeholder
}
trap cleanup EXIT INT TERM

echo "[dev] starting shopify app dev — the live tunnel will auto-sync shortly…"
sync_tunnel &
SYNC_PID=$!

# Foreground so the CLI owns the terminal: `p` (open) and `q` (quit) work.
shopify app dev "$@"
