// L5 · 写臂(带 --execute 闸) · controlled R7: claim relay C with another **controlled** key X → reject; then C's correct key → pass。
// 🔴 两把钥都 Owner 控(Codex 原文 "controlled"), 成功路只写 C 自己的行; 用【尚未注册过的】relay C(与 L2 的 relay 不同——A2 relay_id PK 会先撞)。
// 输入: --submission-x = 以 X 身份/X 地址钥对 relay C 的 relayId 生成的 submission(builder 对 X 的 relay 行生成后把 relayId 改成 C, 或手工造); --submission-c = C 自钥 builder 输出。
// 用法: node scripts/u1-live-arms/L5.mjs --submission-x <file> --submission-c <file> [--execute] [--db] [--console-url]
import { setArm, openDb, one, arg, loadSubmission, addrKeyOf, post, snapshot, banner, emit, fail, EXECUTE } from './common.mjs';
setArm('L5'); banner('L5');
const subX = loadSubmission(arg('--submission-x')); const subC = loadSubmission(arg('--submission-c'));
if (subX.relayId !== subC.relayId) fail('ARGS', '两份 submission 的 relayId 必须都是 relay C');
const sqlite = await openDb();
const relay = one(sqlite, 'SELECT address, name FROM relay_nodes WHERE id = ?', subC.relayId);
if (!relay) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${subC.relayId}`);
const addrKey = await addrKeyOf(relay.address);
if (subX.s10.relayPubkeyXOnly === addrKey) fail('ARGS', 'submission-x 的 s10 钥等于 C 的地址钥 —— 这不是 X 抢 C, 是 C 自己');
if (subC.s10.relayPubkeyXOnly !== addrKey) fail('PRECHECK', 'submission-c 的 s10 钥 ≠ fromAddress(C.address)');
const preX = snapshot(sqlite, subC.relayId, subX.challenge, addrKey);
if (!preX.challenge_exists || preX.challenge_used_at !== null) fail('CHALLENGE_STATE', 'X 的挑战不存在或已用', { preX });
if (!EXECUTE) emit('L5', 'DRY', { plan: `① POST X 抢 relay ${relay.name} ⇒ 期望 400 RELAY_NOT_OWNED 零写入; ② POST C 自钥 ⇒ 期望 200 + A2 行 + 身份行 = ${addrKey}`, preX });
const rx = await post(subX);
const afterX = snapshot(sqlite, subC.relayId, subX.challenge, addrKey);
const okX = rx.code === 400 && rx.payload?.code === 'RELAY_NOT_OWNED' && afterX.challenge_used_at === null && afterX.a2_rows_relay === 0 && afterX.identity_rows_total === preX.identity_rows_total;
if (!okX) emit('L5', 'FAIL', { stage: 'X', http: rx.code, code: rx.payload?.code, reason: rx.payload?.reason, preX, afterX });
const preC = snapshot(sqlite, subC.relayId, subC.challenge, addrKey);
const rc = await post(subC);
const afterC = snapshot(sqlite, subC.relayId, subC.challenge, addrKey);
const okC = rc.code === 200 && rc.payload?.ok === true && rc.payload?.relayPubkeyXOnly === addrKey && afterC.a2_rows_relay === 1 && afterC.identity_rows_key === 1 && afterC.challenge_used_at !== null;
emit('L5', okC ? 'PASS' : 'FAIL', { X: { http: rx.code, code: rx.payload?.code, afterX }, C: { http: rc.code, payload: rc.payload, preC, afterC }, address_key: addrKey });
