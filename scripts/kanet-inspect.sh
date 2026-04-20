#!/usr/bin/env bash
# kanet-inspect.sh — 一键 dump KANet 运行时状态 (给 opencode / Claude Code 用)
#
# 输出 JSON 到 stdout. opencode 可 node --input-type=module 解析.
# 用法: bash /d/Anthropic/scripts/kanet-inspect.sh | jq 或 直接 node 读

CONSOLE="${CONSOLE:-http://localhost:3100}"
KANET_ROOT=/d/Anthropic
DB=D:/Anthropic/kasia-console/data/console.db

# helpers
safe_json() { node -e "try { const d=require('fs').readFileSync(0,'utf8'); const o=JSON.parse(d); process.stdout.write(JSON.stringify(o)); } catch { process.stdout.write('null'); }" 2>/dev/null; }
node_db() { node -e "const db=require('D:/Anthropic/kasia-console/node_modules/better-sqlite3')('$DB'); $1" 2>/dev/null || echo "null"; }
grep_n() { local n=$(grep -c "$1" "$2" 2>/dev/null | head -1); echo "${n:-0}"; }

echo "{"
# ── 1. headless status ────────────────────────────────────────
echo -n '  "headless_status": '
bash "$KANET_ROOT/kanet-status.sh" 2>/dev/null | safe_json
echo ","

# ── 2. RPC status ────────────────────────────────────────────
echo -n '  "rpc_status": '
curl -s --max-time 3 "$CONSOLE/api/config/rpc-status" | safe_json
echo ","

# ── 3. Agents 概览 ───────────────────────────────────────────
echo -n '  "agents": '
node_db "const rows = db.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all(); process.stdout.write(JSON.stringify(rows.map(r => ({ relay_id: r.id, name: r.name, kaspa: r.address }))));"
echo ","

# ── 4. 最新 dev-coord 消息 (链上直查) ───────────────────────
echo -n '  "dev_coord_recent": '
node --input-type=module -e "
import('file:///D:/Anthropic/scripts/chain-query.mjs').then(async m => {
  const peers = {
    Martin: 'kaspa:qptg465n4jedfujewj3hfgkxtysq40v2jakxp2w6uuvrhf6sajf0kzewvmcmv',
    J2:     'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
    NWT:    'kaspa:qzd2ktu49f4cqwy7f4s2kmd5m4j0l27gfghjenurypaum99qxz2w7ktl95grm',
  };
  const results = await Promise.all(Object.entries(peers).map(async ([who, addr]) => {
    try {
      const msgs = await m.queryAddressMessagesFromChain(addr, { limit: 5, channel: 'dev-coord' });
      msgs.sort((a, b) => (b.block_time || 0) - (a.block_time || 0));
      return [who, msgs.slice(0, 3).map(m => ({ t: new Date(m.block_time).toISOString(), tx: m.tx_id.slice(0, 14), content: m.content.slice(0, 180) }))];
    } catch { return [who, []]; }
  }));
  process.stdout.write(JSON.stringify(Object.fromEntries(results)));
}).catch(() => process.stdout.write('{}'));
" 2>/dev/null || echo 'null'
echo ","

# ── 5. Exchange active + recent (real columns: maker/taker/protocol_status) ───
echo -n '  "exchange": '
node_db "
const active = db.prepare(\"SELECT id, maker, taker, give_asset, give_amount, want_asset, want_amount, protocol_status as status, created_at FROM exchange_offers WHERE protocol_status IN ('open','matched','verifying','delivering') ORDER BY created_at DESC LIMIT 10\").all();
const recent = db.prepare(\"SELECT id, protocol_status as status, completed_at, payment_tx, taker_tx_id, delivery_tx FROM exchange_offers WHERE protocol_status IN ('completed','disputed','timed_out','cancelled') ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 5\").all();
const lock = db.prepare(\"SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as total FROM fund_locks WHERE status != 'released'\").get();
process.stdout.write(JSON.stringify({ active, recent, fund_locks_unreleased: { count: lock.c, total_amount: lock.total } }));
"
echo ","

# ── 6. 最新 broadcast_messages ───────────────────────────────
echo -n '  "broadcast_recent": '
node_db "
const rows = db.prepare(\"SELECT channel_name, sender_address, substr(content,1,120) as preview, tx_hash, created_at FROM broadcast_messages ORDER BY created_at DESC LIMIT 10\").all();
process.stdout.write(JSON.stringify(rows.map(r => ({ ch: r.channel_name, from: r.sender_address?.slice(6,14), tx: r.tx_hash?.slice(0,12), t: r.created_at, preview: r.preview }))));
"
echo ","

# ── 7. Mind 最近活动 ────────────────────────────────────────
echo -n '  "mind_recent": '
node_db "
try {
  const rows = db.prepare(\"SELECT agent_id, event_type, substr(details,1,100) as preview, created_at FROM events WHERE event_type LIKE 'mind_%' OR event_type LIKE 'health_%' ORDER BY created_at DESC LIMIT 10\").all();
  process.stdout.write(JSON.stringify(rows));
} catch (e) { process.stdout.write('[]'); }
"
echo ","

# ── 8. pending_actions (real columns: local_address/target_address) ──────────
echo -n '  "pending_actions": '
node_db "
const rows = db.prepare(\"SELECT id, action_type, direction, local_address, target_address, status, created_at FROM pending_actions WHERE status='pending' ORDER BY created_at DESC LIMIT 10\").all();
process.stdout.write(JSON.stringify(rows));
"
echo ","

# ── 9. Polymarket Sophie ─────────────────────────────────────
echo -n '  "polymarket_sophie": '
curl -s --max-time 5 "$CONSOLE/api/polymarket/a83c4b07-eaf7-4d21-972a-1265e0cdcfcf/status" | safe_json
echo ","

# ── 10. Relay 发送健康 ───────────────────────────────────────
echo -n '  "relay_health": '
LOG="$KANET_ROOT/logs/console.log"
RETRY=$(grep_n "RPC connect retry" "$LOG")
TIMEOUT=$(grep_n "Relay command timeout" "$LOG")
BROADCAST=$(grep_n "BROADCAST.*TX:" "$LOG")
printf '{"rpc_retry_total":%s,"command_timeout_total":%s,"broadcast_success_total":%s}\n' "$RETRY" "$TIMEOUT" "$BROADCAST"

echo "}"
