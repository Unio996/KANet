// L4 · 写臂(带 --execute 闸) · missing-S10 HTTP negative → RELAY_NOT_OWNED, no A2/S10 row, challenge not consumed。
// 🔴 顺序闸: 必须在 L2 之前跑(同一活挑战); 若挑战已被消费 ⇒ 拒跑(ORDER_GATE), 免得把"已用挑战"读成"S10 闸"。
// 🔴 --execute 须 Owner D-005 GO 之后由 operator 跑。用法: node scripts/u1-live-arms/L4.mjs --submission <file> [--execute] [--db] [--console-url]
import { setArm, openDb, one, arg, loadSubmission, addrKeyOf, post, snapshot, banner, emit, fail, EXECUTE } from './common.mjs';
setArm('L4'); banner('L4');
const sub = loadSubmission(arg('--submission'));
const sqlite = await openDb();
const relay = one(sqlite, 'SELECT address FROM relay_nodes WHERE id = ?', sub.relayId);
if (!relay) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${sub.relayId}`);
const addrKey = await addrKeyOf(relay.address);
const pre = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const body = { ...sub }; delete body.s10;
const orderGateBlocks = !pre.challenge_exists || pre.challenge_used_at !== null;
// dry-run 只报状态不判 FAIL(run-all 无 --execute 时要能走完); --execute 下顺序闸真拦
if (!EXECUTE) emit('L4', 'DRY', { plan: 'POST 去掉 s10 的同 submission, 期望 400 RELAY_NOT_OWNED 且零写入', order_gate_would_block: orderGateBlocks, pre, body_keys: Object.keys(body) });
if (!pre.challenge_exists) fail('CHALLENGE_UNKNOWN', '挑战不在表里(先 u1-issue-challenge.mjs --commit)');
if (pre.challenge_used_at !== null) fail('ORDER_GATE', 'challenge 已被消费 ⇒ L4 必须在 L2 之前跑; 本次拒跑', { pre });
const r = await post(body);
const after = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const ok = r.code === 400 && r.payload?.code === 'RELAY_NOT_OWNED' && after.challenge_used_at === null
  && after.a2_rows_relay === pre.a2_rows_relay && after.identity_rows_total === pre.identity_rows_total;
emit('L4', ok ? 'PASS' : 'FAIL', { http: r.code, code: r.payload?.code, reason: r.payload?.reason, pre, after });
