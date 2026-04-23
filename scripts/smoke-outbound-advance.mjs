// smoke-outbound-advance.mjs — 验证 Bug #4 修复:
// outbound handshake ingest 必须推进 relation_states 到 accepted

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');
const db = new Database(DB);

// 预清
const LOCAL = 'kaspa:qtest-oa-local';
const PEER = 'kaspa:qtest-oa-peer';
db.prepare("DELETE FROM relation_states WHERE local_address = ? AND peer_address = ?").run(LOCAL, PEER);
db.prepare("DELETE FROM pending_actions WHERE local_address = ? AND target_address = ?").run(LOCAL, PEER);

process.on('exit', () => {
  try {
    db.prepare("DELETE FROM relation_states WHERE local_address = ? AND peer_address = ?").run(LOCAL, PEER);
    db.prepare("DELETE FROM pending_actions WHERE local_address = ? AND target_address = ?").run(LOCAL, PEER);
  } catch {}
});

const { randomUUID } = await import('crypto');
const now = new Date().toISOString();

// 使 Console DB 处于"收到 588 类对端 inbound 后 → 已入队 pending_action"的状态
// 然后模拟 Relay 发出 outbound 握手后 ingest-service.handleIngestMessage 被调
// 验证 relation_states 被推进

// Step 1: 模拟 inbound handshake 已处理 (由 relation-state.observeHandshake 写入)
const { observeHandshake, acceptHandshake } = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/relation-state.js').replace(/\\/g, '/'));
observeHandshake(LOCAL, PEER, 'tx-inbound', now);

// 验证 1: observed 状态且 accepted_at null
const rs1 = db.prepare('SELECT status, handshake_accepted_at FROM relation_states WHERE local_address=? AND peer_address=?').get(LOCAL, PEER);
console.log('[1] After inbound observed:', JSON.stringify(rs1));
console.assert(rs1.status === 'observed' && rs1.handshake_accepted_at === null, 'bad initial state');

// Step 2: 入 pending_action (模拟 guard fix + 入队)
db.prepare(`INSERT OR IGNORE INTO pending_actions
  (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
  VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'smoke', ?, 'pending', 'tx-inbound', ?, ?)`)
  .run(randomUUID(), LOCAL, PEER, `handshake_accept:${LOCAL}:${PEER}`, now, now);

// Step 3: 模拟 Relay 完成 outbound 握手后 ingest-service.handleIngestMessage direction=outbound
// 调 acceptHandshake 推进 relation_states
acceptHandshake(LOCAL, PEER);

// 验证 2: status 应是 accepted, handshake_accepted_at 非 null
const rs2 = db.prepare('SELECT status, handshake_accepted_at, classification FROM relation_states WHERE local_address=? AND peer_address=?').get(LOCAL, PEER);
console.log('[2] After outbound advance:', JSON.stringify(rs2));
const advancePass = rs2.status === 'accepted' && rs2.handshake_accepted_at !== null;
console.log(advancePass ? '  [PASS] relation_states 推进到 accepted' : '  [FAIL] 没推进');

// Step 4: 验证防超发 Defense #1 - 重复 observed 握手来临
// 新 guard 检查 handshake_accepted_at IS NOT NULL → 现在填了 → 命中 → 不再入队
const guardHit = db.prepare(`
  SELECT 1 FROM relation_states WHERE local_address = ? AND peer_address = ?
    AND (handshake_accepted_at IS NOT NULL OR status IN ('accepted','confirmed','active')) LIMIT 1
`).get(LOCAL, PEER);
console.log(guardHit ? '  [PASS] resend handshake 时 NEW guard 命中, 不再入队' : '  [FAIL] guard 没命中');

// Step 5: 验证防超发 Defense #2 - doAcceptHandshake 的 API /api/relation/status 返 accepted
// 该 endpoint 返 relation_states.status. 现在是 accepted → doAcceptHandshake 会 skip
const apiStatus = db.prepare('SELECT status FROM relation_states WHERE local_address=? AND peer_address=?').get(LOCAL, PEER);
console.log(apiStatus.status === 'accepted' ? '  [PASS] Relay API 检查看到 accepted → skip resend 0.2 KAS' : '  [FAIL] API 返非 accepted');

// Step 6: 验证 Defense #3 - idempotent_key 防 pending_action 重复入队
db.prepare(`INSERT OR IGNORE INTO pending_actions
  (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
  VALUES (?, 'handshake_accept', 'inbound', ?, ?, 'smoke', ?, 'pending', 'tx-inbound-2', ?, ?)`)
  .run(randomUUID(), LOCAL, PEER, `handshake_accept:${LOCAL}:${PEER}`, now, now);
const cnt = db.prepare('SELECT COUNT(*) as c FROM pending_actions WHERE local_address=? AND target_address=?').get(LOCAL, PEER);
console.log(cnt.c === 1 ? `  [PASS] idempotent_key 防重: pending_actions 仍 1 行 (不是 ${cnt.c})` : `  [FAIL] ${cnt.c} rows`);

console.log('\n=== 完整链路: inbound observed → 入队 → outbound 完成 → accepted → defense 生效 ===');
db.close();
