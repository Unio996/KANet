// faucet-utxo-health.mjs — 查漏补缺 (NWT 2026-07-04 挖到的 gap, Bettor 裁定 launch 必补): 公开
// FaucetRelay-tn 没有任何持续健康监控——它今早 G4 冒烟炸过一次(UTXO 碎片化, 手动 split 修好),
// 但退化了会对真实公开用户静默返回"未上链/余额不足", 没人盯就重演今早的运维负担, 这次是对着
// 真人而非内部 bot。
//
// 跟 mining-utxo-consolidate.mjs 的关键区别: 那个 relay 只被动累积 coinbase(consolidate 动作安全,
// 没有跟别人抢 UTXO 的风险); 这个 relay 是被公开用户主动"消耗"的(faucet grant 随时在发生的 transfer),
// 对它做 consolidate/split 这类改变 UTXO 集合的操作有跟正在进行的用户请求撞车的风险。所以这里只做
// 纯只读监控 + 告警(events 表), 不做任何自动 consolidate/split 动作——退化了让 operator 决定怎么处理,
// 不自动出手碰钱。
//
// Alert 触发两类: ①UTXO 条目数超过阈值(碎片化/临近今早那种崩溃区) ②余额低于阈值(即将发不出).
import { sqlite } from '../db/client.js';
import { getWorkingRpc } from '../services/rpc-health.js';
import { randomUUID } from 'crypto';

const TICK_INTERVAL_MS = Number(process.env.FAUCET_HEALTH_TICK_MS) || 60_000; // 1min
const STARTUP_GRACE_MS = 60_000;
const UTXO_COUNT_ALERT_THRESHOLD = Number(process.env.FAUCET_HEALTH_UTXO_ALERT_THRESHOLD) || 400; // 同 mining 那条已知安全线
const LOW_BALANCE_ALERT_KAS = Number(process.env.FAUCET_HEALTH_LOW_BALANCE_KAS) || 5000; // faucet 单笔 10000, 留一次的余量当告警线
const NETWORK = 'testnet-12';

let timer = null;
let running = false;
let _utxoAlerted = false;
let _balanceAlerted = false;
let _fetchFailAlerted = false;

function _faucetRelayId() {
  return (process.env.FAUCET_RELAY_ID || '').trim() || null;
}

function _writeAlertEvent(eventType, summary, payload, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'faucet-utxo-health', ?, ?, ?, datetime('now'))
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload));
  } catch (e) { console.warn(`[faucet-health] events insert fail (non-fatal): ${e.message}`); }
}

async function _readFaucetUtxoState(relayId) {
  const row = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayId);
  if (!row?.address) throw new Error(`relay ${relayId.slice(0, 8)} not found or no address`);
  const { url: rpcUrl } = await getWorkingRpc();
  if (!rpcUrl) throw new Error('no working RPC endpoint');
  const kaspa = await import('kaspa-wasm');
  const { RpcClient, Encoding, Address } = kaspa;
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: NETWORK });
  try {
    await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 5000))]);
    const { entries } = await rpc.getUtxosByAddresses([new Address(row.address)]);
    const utxoCount = (entries || []).length;
    const sompi = (entries || []).reduce((s, e) => s + BigInt(e.amount ?? e.utxoEntry?.amount ?? 0), 0n);
    const balanceKas = Number(sompi) / 1e8;
    return { utxoCount, balanceKas, address: row.address };
  } finally { try { await rpc.disconnect(); } catch {} }
}

function _checkThresholds(relayId, state) {
  if (state.utxoCount > UTXO_COUNT_ALERT_THRESHOLD) {
    if (!_utxoAlerted) {
      _utxoAlerted = true;
      console.warn(`[faucet-health] ALERT: ${relayId.slice(0, 8)} UTXO count ${state.utxoCount} > threshold ${UTXO_COUNT_ALERT_THRESHOLD} — fragmenting, may start rejecting faucet grants (今早 G4 同款问题)`);
      _writeAlertEvent('faucet_utxo_fragmentation',
        `Faucet relay ${relayId.slice(0, 8)} UTXO count (${state.utxoCount}) exceeded ${UTXO_COUNT_ALERT_THRESHOLD} tripwire — risk of repeating this morning's G4 fragmentation incident, this time against real public users. Consider a manual split_utxo before public grants start failing.`,
        { relayId, utxoCount: state.utxoCount, threshold: UTXO_COUNT_ALERT_THRESHOLD });
    }
  } else if (_utxoAlerted) { _utxoAlerted = false; }

  if (state.balanceKas < LOW_BALANCE_ALERT_KAS) {
    if (!_balanceAlerted) {
      _balanceAlerted = true;
      console.warn(`[faucet-health] ALERT: ${relayId.slice(0, 8)} balance ${state.balanceKas.toFixed(2)} KAS < threshold ${LOW_BALANCE_ALERT_KAS} — may run out before next manual top-up`);
      _writeAlertEvent('faucet_low_balance',
        `Faucet relay ${relayId.slice(0, 8)} balance (${state.balanceKas.toFixed(2)} KAS) below ${LOW_BALANCE_ALERT_KAS} tripwire — refill from mining reserve before public grants start failing.`,
        { relayId, balanceKas: state.balanceKas, threshold: LOW_BALANCE_ALERT_KAS });
    }
  } else if (_balanceAlerted) { _balanceAlerted = false; }
}

export async function faucetHealthTick() {
  if (running) return { skipped: true };
  const relayId = _faucetRelayId();
  if (!relayId) return { skipped: true, reason: 'no_faucet_relay_id_configured' };
  running = true;
  try {
    const state = await _readFaucetUtxoState(relayId);
    _checkThresholds(relayId, state);
    _fetchFailAlerted = false; // read succeeded — clear any prior failure-alert latch
    return { ok: true, ...state };
  } catch (e) {
    console.warn(`[faucet-health] tick fail (non-fatal, retry next cycle): ${e.message}`);
    if (!_fetchFailAlerted) {
      _fetchFailAlerted = true;
      _writeAlertEvent('faucet_health_check_failure',
        `Faucet relay UTXO health check threw (${String(e.message).slice(0, 160)}) instead of returning a result — same failure mode the fragmentation tripwire exists to catch (address may be getting too large to read). Investigate.`,
        { relayId, error: String(e.message).slice(0, 300) }, 'error');
    }
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startFaucetHealthCron() {
  if (timer) return;
  const relayId = _faucetRelayId();
  if (!relayId) {
    console.log('[faucet-health] FAUCET_RELAY_ID not set — cron not started');
    return;
  }
  console.log(`[faucet-health] started — tick=${TICK_INTERVAL_MS}ms utxoAlertThreshold=${UTXO_COUNT_ALERT_THRESHOLD} lowBalanceKas=${LOW_BALANCE_ALERT_KAS} target=${relayId.slice(0, 8)} (读写only, 不做consolidate/split, 只告警)`);
  setTimeout(() => { faucetHealthTick().catch(e => console.error('[faucet-health] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { faucetHealthTick().catch(e => console.error('[faucet-health] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopFaucetHealthCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
