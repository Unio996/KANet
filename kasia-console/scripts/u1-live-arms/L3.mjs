// L3 · 写臂(带 --execute 闸; 实际期望零写) · replay of the same submission → reject with no additional identity rows。
// 前提: L2 已用同一文件成功过。期望 400 ok:false 且拒因是"挑战已用"——🔴 **顺序重放的拒因是 `POP_FAILED`(reason `CHALLENGE_USED`, pop.mjs:95 前置层)**,
// 不是 `CHALLENGE_ALREADY_USED`(那是【并发】两路都过了 PoP 之后事务内重读 :253 才出现, 见 u1-cas-concurrent.test.mjs 头注)。
// runbook v0.3 §4 (c) 写的 `CHALLENGE_ALREADY_USED` 是错的(自测 2026-08-28 抓出; e2e E4 只断言 ok===false 所以没暴露), v0.5 已改。两种都接受并记录是哪一层。
// 用法: node scripts/u1-live-arms/L3.mjs --submission <file> [--execute] [--db] [--console-url]
import { setArm, openDb, one, arg, loadSubmission, addrKeyOf, post, snapshot, banner, emit, fail, EXECUTE } from './common.mjs';
setArm('L3'); banner('L3');
const sub = loadSubmission(arg('--submission'));
const sqlite = await openDb();
const relay = one(sqlite, 'SELECT address FROM relay_nodes WHERE id = ?', sub.relayId);
if (!relay) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${sub.relayId}`);
const addrKey = await addrKeyOf(relay.address);
const pre = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
if (!EXECUTE) emit('L3', 'DRY', { plan: '再 POST 同一份 submission, 期望 400 CHALLENGE_ALREADY_USED 且两表行数不变', order_gate_would_block: pre.challenge_used_at === null, pre });
if (pre.challenge_used_at === null) fail('ORDER_GATE', '挑战还没被消费 ⇒ L2 还没成功跑过, L3 无意义', { pre });
const r = await post(sub);
const after = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const layer = r.payload?.code === 'CHALLENGE_ALREADY_USED' ? 'in-tx(:253, concurrent path)'
  : (r.payload?.code === 'POP_FAILED' && /CHALLENGE_USED/.test(String(r.payload?.reason))) ? 'pop-prelayer(pop.mjs:95, sequential path)' : null;
const ok = r.code === 400 && r.payload?.ok === false && layer !== null
  && after.a2_rows_relay === pre.a2_rows_relay && after.identity_rows_total === pre.identity_rows_total && after.identity_rows_key === pre.identity_rows_key;
emit('L3', ok ? 'PASS' : 'FAIL', { http: r.code, code: r.payload?.code, reason: r.payload?.reason, rejected_at_layer: layer, pre, after });
