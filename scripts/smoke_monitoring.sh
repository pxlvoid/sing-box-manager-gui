#!/usr/bin/env bash
set -u

# Monitoring smoke test for sing-box-manager.
# Usage:
#   BASE_URL=http://127.0.0.1:9090 scripts/smoke_monitoring.sh
# Optional:
#   MIXED_PORT=2080 MIXED_HOST=127.0.0.1 DB_PATH=~/.singbox-manager/data.db scripts/smoke_monitoring.sh

BASE_URL="${BASE_URL:-http://127.0.0.1:9090}"
MIXED_PORT="${MIXED_PORT:-}"
MIXED_HOST="${MIXED_HOST:-127.0.0.1}"
DATA_DIR="${DATA_DIR:-$HOME/.singbox-manager}"
DB_PATH="${DB_PATH:-$DATA_DIR/data.db}"
CURL_MAX_TIME="${CURL_MAX_TIME:-10}"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

SERVICE_STATUS_BODY=""

log() {
  printf '%s\n' "$*"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[WARN] %s\n' "$*" >&2
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$*" >&2
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required command not found: $1"
    return 1
  fi
  return 0
}

http_get() {
  local path="$1"
  local out_file="$2"
  local code
  code="$(curl -sS --max-time "$CURL_MAX_TIME" -o "$out_file" -w '%{http_code}' "${BASE_URL}${path}" 2>/dev/null || true)"
  printf '%s' "$code"
}

check_json_endpoint() {
  local name="$1"
  local path="$2"
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(http_get "$path" "$tmp")"
  if [[ "$code" != "200" ]]; then
    fail "$name: expected HTTP 200, got ${code:-<no response>}"
    rm -f "$tmp"
    return 1
  fi
  if ! grep -q '"data"' "$tmp"; then
    fail "$name: response does not look like API JSON with data field"
    rm -f "$tmp"
    return 1
  fi
  pass "$name: HTTP 200"
  if [[ "$path" == "/api/service/status" ]]; then
    SERVICE_STATUS_BODY="$(cat "$tmp")"
  fi
  rm -f "$tmp"
  return 0
}

ws_handshake_status() {
  local path="$1"
  local headers
  headers="$(
    curl --http1.1 -sS --max-time 4 -D - -o /dev/null \
      -H "Connection: Upgrade" \
      -H "Upgrade: websocket" \
      -H "Sec-WebSocket-Version: 13" \
      -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
      "${BASE_URL}${path}" 2>/dev/null || true
  )"
  printf '%s' "$headers" | head -n 1 | awk '{print $2}'
}

extract_mixed_port_from_settings() {
  local tmp
  tmp="$(mktemp)"
  local code
  code="$(http_get "/api/settings" "$tmp")"
  if [[ "$code" != "200" ]]; then
    rm -f "$tmp"
    return 1
  fi
  local port
  port="$(sed -n 's/.*"mixed_port":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$tmp" | head -n 1)"
  rm -f "$tmp"
  if [[ -n "$port" ]]; then
    printf '%s' "$port"
    return 0
  fi
  return 1
}

sqlite_count() {
  local table="$1"
  sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM ${table};" 2>/dev/null || printf '0'
}

generate_proxy_traffic() {
  local proxy_url="$1"
  log "Generating test traffic via ${proxy_url}"
  curl -sS --max-time 30 --proxy "$proxy_url" -L "https://speed.hetzner.de/1MB.bin" -o /dev/null >/dev/null 2>&1 || true
  printf 'monitoring-smoke-%s' "$(date +%s)" | \
    curl -sS --max-time 30 --proxy "$proxy_url" -X POST "https://httpbin.org/post" --data-binary @- -o /dev/null >/dev/null 2>&1 || true
}

main() {
  need_cmd curl || exit 1

  log "== Monitoring Smoke Test =="
  log "BASE_URL: ${BASE_URL}"
  log

  check_json_endpoint "Service status" "/api/service/status"
  check_json_endpoint "Monitoring overview" "/api/monitoring/overview"
  check_json_endpoint "Monitoring history" "/api/monitoring/history?limit=5"
  check_json_endpoint "Monitoring clients" "/api/monitoring/clients?limit=10"
  check_json_endpoint "Monitoring resources" "/api/monitoring/resources?limit=10"

  local ws_traffic_code
  ws_traffic_code="$(ws_handshake_status "/api/monitoring/ws/traffic")"
  if [[ "$ws_traffic_code" == "101" ]]; then
    pass "WS handshake traffic endpoint"
  else
    fail "WS handshake traffic endpoint failed (status: ${ws_traffic_code:-none})"
  fi

  local ws_connections_code
  ws_connections_code="$(ws_handshake_status "/api/monitoring/ws/connections?interval=1000")"
  if [[ "$ws_connections_code" == "101" ]]; then
    pass "WS handshake connections endpoint"
  else
    fail "WS handshake connections endpoint failed (status: ${ws_connections_code:-none})"
  fi

  if [[ -z "$MIXED_PORT" ]]; then
    MIXED_PORT="$(extract_mixed_port_from_settings || true)"
  fi

  local before_samples="0"
  local after_samples="0"
  local before_clients="0"
  local after_clients="0"

  if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_PATH" ]]; then
    before_samples="$(sqlite_count "traffic_samples")"
    before_clients="$(sqlite_count "traffic_clients")"
    pass "SQLite available (${DB_PATH})"
  else
    warn "sqlite3 not found or DB not found at ${DB_PATH}; DB growth checks will be skipped"
  fi

  if [[ -n "$MIXED_PORT" && "$MIXED_PORT" != "0" ]]; then
    local proxy_url
    proxy_url="http://${MIXED_HOST}:${MIXED_PORT}"
    generate_proxy_traffic "$proxy_url"
    sleep 4

    local tmp_overview
    tmp_overview="$(mktemp)"
    local code
    code="$(http_get "/api/monitoring/overview" "$tmp_overview")"
    if [[ "$code" == "200" ]]; then
      local active_conn
      active_conn="$(sed -n 's/.*"active_connections":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$tmp_overview" | head -n 1)"
      local up_bps
      up_bps="$(sed -n 's/.*"up_bps":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$tmp_overview" | head -n 1)"
      local down_bps
      down_bps="$(sed -n 's/.*"down_bps":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$tmp_overview" | head -n 1)"
      pass "Overview after traffic fetched"
      log "  Observed: active_connections=${active_conn:-0}, up_bps=${up_bps:-0}, down_bps=${down_bps:-0}"
    else
      fail "Failed to fetch overview after traffic (HTTP ${code:-none})"
    fi
    rm -f "$tmp_overview"
  else
    warn "MIXED_PORT is empty/zero; traffic generation step skipped"
  fi

  if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_PATH" ]]; then
    after_samples="$(sqlite_count "traffic_samples")"
    after_clients="$(sqlite_count "traffic_clients")"
    if [[ "$after_samples" -gt "$before_samples" ]]; then
      pass "traffic_samples increased (${before_samples} -> ${after_samples})"
    else
      warn "traffic_samples did not increase (${before_samples} -> ${after_samples})"
    fi
    if [[ "$after_clients" -gt "$before_clients" ]]; then
      pass "traffic_clients increased (${before_clients} -> ${after_clients})"
    else
      warn "traffic_clients did not increase (${before_clients} -> ${after_clients})"
    fi
  fi

  log
  log "== Summary =="
  log "PASS: ${PASS_COUNT}"
  log "WARN: ${WARN_COUNT}"
  log "FAIL: ${FAIL_COUNT}"

  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
