// L6 · 只读列(端点在事务外拒 ⇒ 零写入)但走 HTTP · cross-network negative against the live local network authority。
// 输入 = builder 以 KASPA_NETWORK=mainnet 生成的 submission(s10.network='mainnet', 合法签名) —— **只为造反例, 放 scratch 不入库**(Bettor 条件);
// 端点侧配置不改。期望 400 S10_INVALID(reason 含 NETWORK_MISMATCH), 挑战未消费、零新行。
// 用法: node scripts/u1-live-arms/L6.mjs --submission <mainnet-signed file> [--db] [--console-url]
import { setArm, openDb, one, arg, loadSubmission, addrKeyOf, post, snapshot, emit, fail } from './common.mjs';
setArm('L6');
const sub = loadSubmission(arg('--submission'));
if (sub.s10.network === 'testnet-12') fail('ARGS', 'L6 的 submission 须是 mainnet 域签名件(s10.network=mainnet), 这份是 testnet-12');
const sqlite = await openDb();
const relay = one(sqlite, 'SELECT address FROM relay_nodes WHERE id = ?', sub.relayId);
if (!relay) fail('RELAY_UNKNOWN', `relay_nodes 无 id=${sub.relayId}`);
const addrKey = await addrKeyOf(relay.address);
const pre = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const r = await post(sub);
const after = snapshot(sqlite, sub.relayId, sub.challenge, addrKey);
const ok = r.code === 400 && r.payload?.code === 'S10_INVALID' && /NETWORK_MISMATCH/.test(String(r.payload?.reason))
  && after.challenge_used_at === pre.challenge_used_at && after.a2_rows_relay === pre.a2_rows_relay && after.identity_rows_total === pre.identity_rows_total;
emit('L6', ok ? 'PASS' : 'FAIL', { http: r.code, code: r.payload?.code, reason: r.payload?.reason, s10_network: sub.s10.network, pre, after });
