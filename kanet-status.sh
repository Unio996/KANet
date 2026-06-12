#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
PID_DIR="$KANET_ROOT/logs/pids"

# r-portconverge (J1 DoD-E E5, 2026-06-12): Console 端口单一源 = kanet.env PORT
# (同 kanet-start.sh/headless/supervisor 收敛). 原硬编码 3100 是从主网脚本拷来的错值 →
# 对 tn12 (PORT=3300) status 全错(探 3100 永远 false). 从 kanet.env 派生, env override 优先.
ENV_FILE="$KANET_ROOT/kanet.env"
ENV_PORT=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
fi
CONSOLE_PORT=${CONSOLE_PORT:-${ENV_PORT:-3100}}

ALL_ALIVE="true"
ALL_READY="true"
HAS_SERVICES=0
FIRST=1
SERVICES_JSON=""

check_endpoint() {
  local port="$1"
  local path="$2"
  if curl -sf "http://localhost:${port}${path}" > /dev/null 2>&1; then
    echo "true"
  else
    echo "false"
  fi
}

if [ -d "$PID_DIR" ]; then
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue

    name=$(basename "$pidfile" .pid)
    pid=$(cat "$pidfile" 2>/dev/null || echo "")
    [ -z "$pid" ] && continue

    HAS_SERVICES=1
    alive="false"
    if kill -0 "$pid" 2>/dev/null; then
      alive="true"
    else
      ALL_ALIVE="false"
    fi

    case "$name" in
      console)
        if [ "$alive" = "true" ]; then
          ready=$(check_endpoint "$CONSOLE_PORT" "/")
          [ "$ready" = "false" ] && ALL_READY="false"
          svc_json="\"${name}\":{\"pid\":${pid},\"port\":${CONSOLE_PORT},\"alive\":${alive},\"ready\":${ready},\"url\":\"http://localhost:${CONSOLE_PORT}\"}"
        else
          ALL_READY="false"
          svc_json="\"${name}\":{\"pid\":${pid},\"port\":${CONSOLE_PORT},\"alive\":false,\"ready\":false}"
        fi
        ;;
      llama-server)
        if [ "$alive" = "true" ]; then
          ready=$(check_endpoint 8000 "/health")
          [ "$ready" = "false" ] && ALL_READY="false"
          svc_json="\"${name}\":{\"pid\":${pid},\"port\":8000,\"alive\":${alive},\"ready\":${ready}}"
        else
          ALL_READY="false"
          svc_json="\"${name}\":{\"pid\":${pid},\"port\":8000,\"alive\":false,\"ready\":false}"
        fi
        ;;
      *)
        svc_json="\"${name}\":{\"pid\":${pid},\"alive\":${alive}}"
        ;;
    esac

    if [ "$FIRST" -eq 1 ]; then
      SERVICES_JSON="$svc_json"
      FIRST=0
    else
      SERVICES_JSON="${SERVICES_JSON},${svc_json}"
    fi
  done
fi

if [ "$HAS_SERVICES" -eq 0 ]; then
  printf '{"ok":false,"services":{}}\n'
  exit 2
elif [ "$ALL_ALIVE" = "true" ] && [ "$ALL_READY" = "true" ]; then
  printf '{"ok":true,"services":{%s}}\n' "$SERVICES_JSON"
  exit 0
else
  printf '{"ok":false,"services":{%s}}\n' "$SERVICES_JSON"
  exit 1
fi
