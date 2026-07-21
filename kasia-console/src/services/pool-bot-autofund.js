// pool-bot-autofund.js — #42 加大方案·治本 (Bettor 2026-07-04): AutoBetter/HouseAgent 反复"充一次跑几
// 单又干"(recurring low-balance stall)。根治: 自动巡检押注 bot 余额, 低于阈值就从 mining 储备
// (MiningRelay-tn12-new, #34 consolidate 出的 faucet reserve) 自动补——不用再每次手动 curl transfer.
//
// Tick: 查每个受监控 relay 余额, < REFILL_THRESHOLD_KAS 就从 SOURCE_RELAY_ID 转 REFILL_AMOUNT_KAS.
// 测试网花钱铁律 (Owner 2026-07-04 明确钦定"多多益善·不要怕"): 自动补币不设保守上限逻辑,
// 只靠 threshold+amount 两个数控节奏, 源头(mining reserve)余额够大不会枯竭.

import { sqlite } from '../db/client.js';

const TICK_INTERVAL_MS = Number(process.env.BOT_AUTOFUND_TICK_MS) || 180_000; // 3min
const REFILL_THRESHOLD_KAS = Number(process.env.BOT_AUTOFUND_THRESHOLD_KAS) || 500;
const REFILL_AMOUNT_KAS = Number(process.env.BOT_AUTOFUND_AMOUNT_KAS) || 3000;
const SOURCE_RELAY_ID = process.env.BOT_AUTOFUND_SOURCE_RELAY_ID || ''; // mining reserve relay
const CONSOLE_BASE = process.env.BOT_AUTOFUND_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_MS = 20_000;

let timer = null;
let running = false;

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function _monitoredRelayNames() {
  // AUTO_BET_RELAYS(auto-bet 用) + HOUSE_AGENT_RELAY_NAME + UNDERDOG_BOT_RELAY_NAME(house-agent.js
  // 用) 合集, 名字来源单一 env 别重复定义(跟各自 cron 的 relay 列表保持同源).
  const autoBetRelays = (process.env.AUTO_BET_RELAYS || 'AutoBetter-1,AutoBetter-2,AutoBetter-3').split(',').map(s => s.trim()).filter(Boolean);
  const houseAgentRelay = process.env.HOUSE_AGENT_RELAY_NAME || 'HouseAgent';
  const underdogRelay = process.env.UNDERDOG_BOT_RELAY_NAME || 'UnderdogBot';
  return [...new Set([...autoBetRelays, houseAgentRelay, underdogRelay])];
}

async function _getBalanceKas(relayId) {
  try {
    const r = await fetchWithTimeout(`${CONSOLE_BASE}/api/relay/${relayId}/balance`, {}, FETCH_TIMEOUT_MS);
    const j = await r.json();
    return typeof j?.balance === 'number' ? j.balance : null;
  } catch { return null; }
}

export async function botAutofundTick() {
  if (running) return { skipped: true };
  const sourceId = SOURCE_RELAY_ID.trim();
  if (!sourceId) return { skipped: true, reason: 'no_source_relay_id_configured' };
  running = true;
  try {
    const names = _monitoredRelayNames();
    const results = [];
    for (const name of names) {
      const row = sqlite.prepare('SELECT id, address FROM relay_nodes WHERE name = ?').get(name);
      if (!row) { results.push({ name, status: 'not_found' }); continue; }
      const balKas = await _getBalanceKas(row.id);
      if (balKas == null) { results.push({ name, status: 'balance_check_fail' }); continue; }
      if (balKas >= REFILL_THRESHOLD_KAS) { results.push({ name, status: 'ok', balance: balKas }); continue; }
      try {
        const r = await fetchWithTimeout(`${CONSOLE_BASE}/api/relay/${sourceId}/transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: row.address, amount: REFILL_AMOUNT_KAS }),
        }, FETCH_TIMEOUT_MS);
        const j = await r.json();
        if (j?.ok) {
          console.log(`[bot-autofund] refilled ${name}: ${balKas.toFixed(2)} → +${REFILL_AMOUNT_KAS} KAS, tx=${(j.txId || '').slice(0, 12)}`);
          results.push({ name, status: 'refilled', before: balKas, txId: j.txId });
        } else {
          console.warn(`[bot-autofund] refill ${name} failed: ${j?.error || 'unknown'}`);
          results.push({ name, status: 'refill_fail', error: j?.error });
        }
      } catch (e) {
        results.push({ name, status: 'refill_exception', error: e.message });
      }
    }
    return { ok: true, results };
  } catch (e) {
    console.warn(`[bot-autofund] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startBotAutofundCron() {
  if (timer) return;
  if (!SOURCE_RELAY_ID.trim()) {
    console.log('[bot-autofund] BOT_AUTOFUND_SOURCE_RELAY_ID not set — cron not started');
    return;
  }
  console.log(`[bot-autofund] started — tick=${TICK_INTERVAL_MS}ms threshold=${REFILL_THRESHOLD_KAS} amount=${REFILL_AMOUNT_KAS} source=${SOURCE_RELAY_ID.slice(0, 8)} monitoring=${_monitoredRelayNames().join(',')}`);
  timer = setInterval(() => { botAutofundTick().catch((e) => console.error('[bot-autofund] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopBotAutofundCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
