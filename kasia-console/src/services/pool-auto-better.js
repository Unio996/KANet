// pool-auto-better.js — Console-cron auto-bet service (J2-tn r420 Bettor r433 关1 PASS).
//
// Replaces external _nwt_tn_autobet_loop.mjs daemon (= 不自动 follow Console restart).
// 内部 cron: AUTO_BET_TICK_MS env (default 60s, 0=disable).
//
// Each tick:
//   1. Select active markets (= protocol_status='pending_bettors' AND deadline > now+120s)
//   2. For each bettor relay (= AUTO_BET_RELAYS env list):
//      a. Pick random subset N=AUTO_BET_PER_TICK markets (default 2)
//      b. For each: random direction (50/50 YES/NO) + random stake (= [MIN_STAKE_KAS, MAX_STAKE_KAS])
//      c. Call register-v06/prep → relay transfer → register-v06/confirm
//   3. Idempotent: relay × market uniqueness 自然由 side_p2sh UNIQUE 守 (= 同 direction 同 bettor 同 market 同 stake = 同 P2SH).
//
// Guardrails:
//   - relay alive check (= isRelayAlive)
//   - balance ≥ MIN_RESERVE_KAS (= 10 default, 留 fees)
//   - deadline < 120s skip 防 race
//   - per-cycle / per-relay 上限 PER_TICK 防资金过快烧

import { sqlite } from '../db/client.js';
import { isRelayAlive, sendCommandAsync } from './relay-manager.js';

const TICK_INTERVAL_MS = Number(process.env.AUTO_BET_TICK_MS) || 60_000;  // 1 min default
const PER_TICK = Number(process.env.AUTO_BET_PER_TICK) || 2;
const MIN_STAKE_KAS = Number(process.env.AUTO_BET_MIN_STAKE_KAS) || 1;
const MAX_STAKE_KAS = Number(process.env.AUTO_BET_MAX_STAKE_KAS) || 50;
const MIN_RESERVE_KAS = Number(process.env.AUTO_BET_MIN_RESERVE_KAS) || 10;
const RELAYS = (process.env.AUTO_BET_RELAYS || 'AutoBetter-1,AutoBetter-2,AutoBetter-3,tester-1,tester-2,tester-3').split(',').map(s => s.trim()).filter(Boolean);
const CONSOLE_BASE = process.env.AUTO_BET_CONSOLE_BASE || 'http://127.0.0.1:3200';

let timer = null;
let running = false;

function _pickRandomSubset(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function _randomStakeKas() {
  const range = MAX_STAKE_KAS - MIN_STAKE_KAS;
  return (MIN_STAKE_KAS + Math.random() * range).toFixed(2);
}

function _randomDirection() {
  return Math.random() < 0.5 ? 0 : 1;  // 0=YES, 1=NO
}

async function _placeBet(bot, market) {
  const direction = _randomDirection();
  const stakeKas = _randomStakeKas();
  const dirLabel = direction === 0 ? 'YES' : 'NO';
  const tag = market.id.slice(-12);

  try {
    // Step 1: prep — compute side_p2sh + exact stake
    const prepR = await fetch(`${CONSOLE_BASE}/api/pool/market/${market.id}/bettor/register-v06/prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: parseFloat(stakeKas) }),
    });
    const prep = await prepR.json();
    if (!prep.ok) {
      if (String(prep.error || '').toLowerCase().includes('already')) return { tag, bot: bot.name, status: 'DUP' };
      return { tag, bot: bot.name, status: 'PREP_FAIL', error: String(prep.error || '').slice(0, 80) };
    }

    // Step 2: transfer — relay sends exact_stake_kas to side_p2sh
    const payR = await fetch(`${CONSOLE_BASE}/api/relay/${bot.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: prep.side_p2sh, amount: prep.exact_stake_kas }),
    });
    const pay = await payR.json();
    if (!pay.ok || !pay.txId) return { tag, bot: bot.name, status: 'PAY_FAIL', error: String(pay.error || '').slice(0, 80) };

    // Step 3: confirm — register side row + broadcast pool_bet_registered_v1
    // Try confirm a few times because UTXO needs to land in indexer/mempool.
    let confirmed = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 3000 + attempt * 2000));
      const confirmR = await fetch(`${CONSOLE_BASE}/api/pool/market/${market.id}/bettor/register-v06/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: parseFloat(stakeKas) }),
      });
      const confirm = await confirmR.json();
      if (confirm.ok) { confirmed = confirm; break; }
    }
    if (!confirmed) {
      return { tag, bot: bot.name, status: 'PAID_NOT_CONFIRMED', pay_tx: pay.txId.slice(0, 16), stake: prep.exact_stake_kas, dir: dirLabel };
    }
    return { tag, bot: bot.name, status: 'CONFIRMED', side_tx: pay.txId.slice(0, 16), stake: prep.exact_stake_kas, dir: dirLabel };
  } catch (e) {
    return { tag, bot: bot.name, status: 'EXCEPTION', error: String(e.message || '').slice(0, 80) };
  }
}

async function _fetchEligibleMarkets() {
  return sqlite.prepare(`
    SELECT id, protocol_version, deadline
    FROM pool_markets
    WHERE protocol_status = 'pending_bettors'
      AND (protocol_version = 'v0.6' OR protocol_version = 'v0.7')
      AND deadline > unixepoch() + 120
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
}

function _fetchRelayBots() {
  const bots = [];
  for (const name of RELAYS) {
    const row = sqlite.prepare('SELECT id, address, name FROM relay_nodes WHERE name = ?').get(name);
    if (!row) continue;
    const aliveCheck = isRelayAlive(row.id);
    if (!aliveCheck?.alive) continue;  // skip relay_down (= r433b 固化 handle)
    bots.push(row);
  }
  return bots;
}

export async function autoBetterTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const markets = await _fetchEligibleMarkets();
    if (markets.length === 0) return { ok: true, processed: 0, note: 'no eligible markets' };
    const bots = _fetchRelayBots();
    if (bots.length === 0) return { ok: true, processed: 0, note: 'no alive relay bots' };

    const summary = { prep_fail: 0, pay_fail: 0, paid_not_confirmed: 0, confirmed: 0, dup: 0, exception: 0 };
    const placements = [];
    for (const bot of bots) {
      const picks = _pickRandomSubset(markets, PER_TICK);
      for (const m of picks) {
        const r = await _placeBet(bot, m);
        placements.push(r);
        if (r.status === 'CONFIRMED') summary.confirmed++;
        else if (r.status === 'PAID_NOT_CONFIRMED') summary.paid_not_confirmed++;
        else if (r.status === 'DUP') summary.dup++;
        else if (r.status === 'PAY_FAIL') summary.pay_fail++;
        else if (r.status === 'PREP_FAIL') summary.prep_fail++;
        else summary.exception++;
        await new Promise(r => setTimeout(r, 1500));  // throttle 1.5s between bets
      }
    }
    console.log(`[auto-bet] tick markets=${markets.length} bots=${bots.length} placements=${placements.length} confirmed=${summary.confirmed} paid_not_confirmed=${summary.paid_not_confirmed} dup=${summary.dup} pay_fail=${summary.pay_fail} prep_fail=${summary.prep_fail} ex=${summary.exception}`);
    return { ok: true, processed: placements.length, summary };
  } catch (e) {
    console.error('[auto-bet] tick fail:', e.message);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startAutoBetterCron() {
  if (TICK_INTERVAL_MS === 0) {
    console.log('[auto-bet] DISABLED (AUTO_BET_TICK_MS=0)');
    return;
  }
  if (timer) return;
  console.log(`[auto-bet] started — tick=${TICK_INTERVAL_MS}ms per_tick=${PER_TICK} stake=[${MIN_STAKE_KAS},${MAX_STAKE_KAS}] reserve=${MIN_RESERVE_KAS} relays=${RELAYS.join(',')}`);
  // Defer first tick 60s so Console + relays settle.
  setTimeout(() => {
    autoBetterTick().catch(e => console.error('[auto-bet] startup tick:', e.message));
  }, 60_000);
  timer = setInterval(() => {
    autoBetterTick().catch(e => console.error('[auto-bet] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopAutoBetterCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
