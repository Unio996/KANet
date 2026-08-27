// L2 · 写臂(带 --execute 闸) · positive S10 registration on an Owner-controlled relay: A2 行 + u1_relay_identity 行 + 挑战消费。
// 🔴 --execute 须 Owner D-005 GO 之后由 operator 跑; 成功 = live 库 +1 A2 行 +1 身份行 +1 已用挑战(回滚 SQL 见 run-all / runbook §6)。
// 用法: node scripts/u1-live-arms/L2.mjs --submission <file> [--execute] [--db] [--console-url]
import { setArm, openDb, one, arg, loadSubmission, addrKeyOf, post, snapshot, banner, emit, fail, EXECUTE } from './common.mjs';
setArm('L2'); banner('L2');
const sub = loadSubmission(arg('--submission'));
const sqlite = await openDb();
const relay = one(sqlite, 'SELECT address, name FROM relay_nodes WHERE id = ?', sub.relayId);
if (!relay) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${sub.relayId}`);
const addrKey = await addrKeyOf(relay.address);
if (sub.s10.relayPubkeyXOnly !== addrKey) fail('PRECHECK', `submission.s10.relayPubkeyXOnly ≠ fromAddress(relay.address)(端点会拒 RELAY_NOT_OWNED); 用 builder 对【这个 relay】重生成`, { addrKey });
const pre = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
if (!pre.challenge_exists || pre.challenge_used_at !== null) fail('CHALLENGE_STATE', '挑战不存在或已用', { pre });
if (!EXECUTE) emit('L2', 'DRY', { plan: `POST 七字段 submission(relay ${relay.name}), 期望 200 ok + A2 行 + 身份行 = ${addrKey} + 挑战 used_at 非空`, pre });
const r = await post(sub);
const after = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const idRow = one(sqlite, 'SELECT network, operation, epoch FROM u1_relay_identity WHERE relay_pubkey_xonly = ?', addrKey);
const a2 = one(sqlite, 'SELECT custody, identity_pubkey_xonly FROM u1_identity_registration WHERE relay_id = ?', sub.relayId);
const ok = r.code === 200 && r.payload?.ok === true && r.payload?.relayPubkeyXOnly === addrKey
  && after.a2_rows_relay === 1 && a2?.custody === 'mnemonic'
  && after.identity_rows_key === 1 && idRow?.epoch === sub.challenge && idRow?.operation === 'register' && idRow?.network === sub.s10.network
  && after.challenge_used_at !== null;
emit('L2', ok ? 'PASS' : 'FAIL', { http: r.code, payload: r.payload, address_key: addrKey, a2, identity_row: idRow, pre, after });
