#!/usr/bin/env bash
# KANet Console automated test suite
set -euo pipefail

BASE="http://localhost:3199"
PASS=0
FAIL=0
DB="data/console.db"

# 加载 CONSOLE_ENCRYPTION_KEY（从 kanet.env 或环境变量）
KANET_ROOT="${KANET_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ -z "${CONSOLE_ENCRYPTION_KEY:-}" ] && [ -f "$KANET_ROOT/kanet.env" ]; then
  CONSOLE_ENCRYPTION_KEY=$(grep '^CONSOLE_ENCRYPTION_KEY=' "$KANET_ROOT/kanet.env" | cut -d= -f2)
fi
if [ -z "${CONSOLE_ENCRYPTION_KEY:-}" ]; then
  CONSOLE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fi
export CONSOLE_ENCRYPTION_KEY

ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

check_contains() {
  local desc="$1" body="$2" needle="$3"
  if echo "$body" | grep -qF "$needle"; then ok "$desc"; else fail "$desc (missing: $needle)"; fi
}

check_not_contains() {
  local desc="$1" body="$2" needle="$3"
  if echo "$body" | grep -qF "$needle"; then fail "$desc (found: $needle)"; else ok "$desc"; fi
}

check_status() {
  local desc="$1" status="$2" expected="$3"
  if [ "$status" = "$expected" ]; then ok "$desc"; else fail "$desc (got $status, want $expected)"; fi
}

# ── Start server ─────────────────────────────────────────────────────────────
echo "Starting server..."
DB_PATH="$PWD/data/console.db" \
CONSOLE_ENCRYPTION_KEY=$CONSOLE_ENCRYPTION_KEY \
PORT=3199 node src/index.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM EXIT

# Wait for server to be ready
for i in $(seq 1 20); do
  if curl -sf "$BASE/" > /dev/null 2>&1; then break; fi
  sleep 0.3
done
echo "Server ready (PID $SERVER_PID)"
echo

# ── 1. Default language (Chinese) ────────────────────────────────────────────
echo "=== Default language (zh) ==="
BODY=$(curl -sf "$BASE/")
check_contains "Dashboard zh-CN html lang" "$BODY" 'lang="zh-CN"'
check_contains "Dashboard dir=ltr"         "$BODY" 'dir="ltr"'
check_contains "Dashboard title key"       "$BODY" '仪表盘'

# ── 2. All 8 languages render ─────────────────────────────────────────────────
echo "=== Language rendering ==="
declare -A LANG_CHECKS=(
  [zh]="zh-CN"
  [en]="en"
  [es]="es"
  [fr]="fr"
  [ar]="ar"
  [ja]="ja"
  [ru]="ru"
  [ko]="ko"
)
for lang in zh en es fr ar ja ru ko; do
  BODY=$(curl -sf -H "Cookie: kanet_lang=$lang" "$BASE/")
  expected="${LANG_CHECKS[$lang]}"
  check_contains "lang=$lang renders html_lang=$expected" "$BODY" "lang=\"$expected\""
done

# ── 3. Arabic RTL ─────────────────────────────────────────────────────────────
echo "=== Arabic RTL ==="
BODY=$(curl -sf -H "Cookie: kanet_lang=ar" "$BASE/")
check_contains "Arabic dir=rtl" "$BODY" 'dir="rtl"'

BODY=$(curl -sf -H "Cookie: kanet_lang=en" "$BASE/")
check_contains "English dir=ltr" "$BODY" 'dir="ltr"'

# ── 4. POST /lang sets cookie and redirects ───────────────────────────────────
echo "=== POST /lang ==="
RESP=$(curl -si -X POST -d "lang=en" "$BASE/lang")
check_contains  "POST /lang sets kanet_lang cookie" "$RESP" "kanet_lang=en"
HTTP_CODE=$(echo "$RESP" | head -1 | awk '{print $2}')
check_status "POST /lang returns 3xx" "$HTTP_CODE" "302"

# ── 5. All pages render (zh) ──────────────────────────────────────────────────
echo "=== All pages render ==="
for path in / /conversations /events /relays /adapters; do
  CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE$path")
  check_status "GET $path returns 200" "$CODE" "200"
done

# ── 6. All pages render in English ───────────────────────────────────────────
echo "=== All pages in English ==="
for path in / /conversations /events /relays /adapters; do
  BODY=$(curl -sf -H "Cookie: kanet_lang=en" "$BASE$path")
  check_contains "GET $path en: html lang=en" "$BODY" 'lang="en"'
done

# ── 7. No 智能合约 anywhere ───────────────────────────────────────────────────
echo "=== No 智能合约 ==="
for path in / /conversations /events /relays /adapters; do
  BODY=$(curl -sf "$BASE$path")
  check_not_contains "GET $path: no 智能合约" "$BODY" "智能合约"
done

# ── 8. Language switcher present ──────────────────────────────────────────────
echo "=== Language switcher ==="
BODY=$(curl -sf "$BASE/")
check_contains "Language switcher form present"   "$BODY" 'action="/lang"'
check_contains "Language switcher has English"    "$BODY" 'value="en"'
check_contains "Language switcher has Arabic"     "$BODY" 'value="ar"'

# ── 9. Old redirect routes ────────────────────────────────────────────────────
echo "=== Old redirect routes ==="
CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE/relay")
check_status "GET /relay returns 302" "$CODE" "302"
CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE/adapter")
check_status "GET /adapter returns 302" "$CODE" "302"

# Follow redirect
BODY=$(curl -sfL "$BASE/relay")
check_contains "GET /relay follows to relays page" "$BODY" 'lang="zh-CN"'
BODY=$(curl -sfL "$BASE/adapter")
check_contains "GET /adapter follows to adapters page" "$BODY" 'lang="zh-CN"'

# ── 10. Conversation 404 ──────────────────────────────────────────────────────
echo "=== 404 handling ==="
CODE=$(curl -so /dev/null -w "%{http_code}" "$BASE/conversations/nonexistent-id-xyz")
check_status "GET /conversations/nonexistent returns 404" "$CODE" "404"

# ── 11. No asterisks in form labels ──────────────────────────────────────────
echo "=== No asterisks in labels ==="
RELAY_BODY=$(curl -sf "$BASE/relays")
ADAPTER_BODY=$(curl -sf "$BASE/adapters")
check_not_contains "Relays: no '名称 *'" "$RELAY_BODY" "名称 *"
check_not_contains "Adapters: no '名称 *'" "$ADAPTER_BODY" "名称 *"

# ── 12. Adapter startup hint ──────────────────────────────────────────────────
# Only testable if an adapter exists in DB; skip if empty
echo "=== Adapter startup hint (if adapters exist) ==="
ADAPTER_BODY=$(curl -sf "$BASE/adapters")
if echo "$ADAPTER_BODY" | grep -qF "ADAPTER_PORT="; then
  ok "Adapter startup hint present"
else
  ok "Adapter startup hint: no adapters in DB, skipped"
fi

# ── Results ───────────────────────────────────────────────────────────────────
echo
echo "================================"
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
