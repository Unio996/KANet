// pool-house-agent.js — #42 头号2 主路 (Bettor 2026-07-04 派工·qzdh7nar 预测源+KANet-UI 下注执行).
//
// "击败 Agent" 玩法: house agent 对每场世界杯淘汰赛盘赛前公开预测(晋级方向)+真实下注(链上可查),
// 玩家可以选跟它同边或反着押,赛后可能被打脸(upset)="击败 Agent"的乐趣所在。跟 pool-auto-better.js
// (随机方向, 多 relay, 全市场)是两回事: house agent 只押世界杯盘(card_group_id LIKE 'fifa-2026%'),
// 单一固定身份(HouseAgent relay), 每盘只押一次(去重)。
//
// 预测≠结算(Bettor 2026-07-04 红线, 关键): house-judgment 接口两种 verdict, 不可混用——
//   - PREDICTED_YES/PREDICTED_NO = 赛前预测(qzdh7nar predictPreMatch: ESPN pickcenter 赔率主,
//     KANet-UI FIFA 排名 fallback) → 触发下注的信号, Agent 在这里才可能猜错。
//   - YES/NO = 赛后真结果(judgeWinDir, 跟结算同源) → 不触发下注(比赛已定, 押已无意义),
//     只用于日后对账"Agent 预测 vs 真结果"算战绩/上榜。
//
// Tick:
//   1. 找世界杯盘(pending_bettors + v0.7 + card_group_id fifa-2026% + deadline > now+120s)
//   2. 排除 HouseAgent 已经押过的(pool_bettor_sides 查 bettor_relay_id=HouseAgent)
//   3. 对每盘调用 house-judgment; 只 PREDICTED_YES/PREDICTED_NO 下注, ABSTAIN/YES/NO 跳过
//   4. 复用 auto-bet 同一套 register-v07 prep→transfer→confirm 三步(shard-aware, 非重造)

import { randomBytes } from 'node:crypto';
import { sqlite } from '../db/client.js';
import { isRelayAlive } from './relay-manager.js';

const TICK_INTERVAL_MS = Number(process.env.HOUSE_AGENT_TICK_MS) || 300_000; // 5min default
const STAKE_KAS = Number(process.env.HOUSE_AGENT_STAKE_KAS) || 20;
const RELAY_NAME = process.env.HOUSE_AGENT_RELAY_NAME || 'HouseAgent';
const CONSOLE_BASE = process.env.HOUSE_AGENT_CONSOLE_BASE || 'http://127.0.0.1:3200';
const FETCH_TIMEOUT_FAST_MS = 10_000;
const FETCH_TIMEOUT_TX_MS = 30_000;

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

function _fetchHouseAgentRelay() {
  const row = sqlite.prepare('SELECT id, address, name FROM relay_nodes WHERE name = ?').get(RELAY_NAME);
  if (!row) return null;
  const aliveCheck = isRelayAlive(row.id);
  if (!aliveCheck?.alive) return null;
  return row;
}

// 世界杯盘 + 排除 HouseAgent 已押过的(去重, 每盘只判断+押一次).
function _fetchUnjudgedWorldCupMarkets(relayId) {
  return sqlite.prepare(`
    SELECT id, deadline
    FROM pool_markets
    WHERE protocol_status = 'pending_bettors'
      AND protocol_version = 'v0.7'
      AND deadline > unixepoch() + 120
      AND resolution_rule_spec LIKE '%"card_group_id":"fifa-2026%'
      AND id NOT IN (
        SELECT market_id FROM pool_bettor_sides WHERE bettor_relay_id = ?
      )
  `).all(relayId);
}

async function _getJudgment(marketId) {
  const r = await fetchWithTimeout(`${CONSOLE_BASE}/api/oracle-pool/house-judgment/${marketId}`, {}, FETCH_TIMEOUT_FAST_MS);
  return r.json();
}

// 复用 pool-auto-better.js 同一套 register-v07 三步(prep→transfer→confirm, shard-aware) — 非重造.
async function _placeJudgedBet(bot, marketId, direction) {
  const tag = marketId.slice(-12);
  const betId = randomBytes(8).toString('hex');
  try {
    const prepR = await fetchWithTimeout(`${CONSOLE_BASE}/api/pool/market/${marketId}/bettor/register-v07/prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: STAKE_KAS, bet_id: betId }),
    }, FETCH_TIMEOUT_FAST_MS);
    const prep = await prepR.json();
    if (!prep.ok) return { tag, status: 'PREP_FAIL', error: String(prep.error || '').slice(0, 80) };

    const payR = await fetchWithTimeout(`${CONSOLE_BASE}/api/relay/${bot.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: prep.side_p2sh, amount: prep.exact_stake_kas }),
    }, FETCH_TIMEOUT_TX_MS);
    const pay = await payR.json();
    if (!pay.ok || !pay.txId) return { tag, status: 'PAY_FAIL', error: String(pay.error || '').slice(0, 80) };

    let confirmed = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((res) => setTimeout(res, 3000 + attempt * 2000));
      const confirmR = await fetchWithTimeout(`${CONSOLE_BASE}/api/pool/market/${marketId}/bettor/register-v07/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: STAKE_KAS, bet_id: betId }),
      }, FETCH_TIMEOUT_TX_MS);
      const confirm = await confirmR.json();
      if (confirm.registered) { confirmed = confirm; break; }
      if (confirm.ambiguous) return { tag, status: 'AMBIGUOUS', pay_tx: pay.txId.slice(0, 16) };
    }
    if (!confirmed) return { tag, status: 'PAID_NOT_CONFIRMED', pay_tx: pay.txId.slice(0, 16) };
    return { tag, status: 'CONFIRMED', side_tx: pay.txId.slice(0, 16), shard: confirmed.shard_market_id || confirmed.shardMarketId || '?' };
  } catch (e) {
    return { tag, status: 'EXCEPTION', error: String(e.message || '').slice(0, 80) };
  }
}

export async function houseAgentTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const bot = _fetchHouseAgentRelay();
    if (!bot) return { ok: true, processed: 0, note: 'house agent relay not found or not alive' };
    const markets = _fetchUnjudgedWorldCupMarkets(bot.id);
    if (markets.length === 0) return { ok: true, processed: 0, note: 'no unjudged world cup markets' };

    // #42 预测≠结算红线 (Bettor 2026-07-04): 下注只对 PREDICTED_YES/PREDICTED_NO(赛前预测, house-judgment
    // 的 predictPreMatch, ESPN pickcenter 赔率或 FIFA 排名 fallback) 反应. 'YES'/'NO'(judgeWinDir 赛后
    // 真结果)不触发下注——那时比赛已经/接近结束, 再"押"没有预测意义, 只用于以后对账 Agent 战绩.
    const results = [];
    for (const m of markets) {
      const j = await _getJudgment(m.id);
      if (!j?.ok || j.verdict === 'ABSTAIN' || j.verdict === 'YES' || j.verdict === 'NO') {
        results.push({ market: m.id.slice(-12), verdict: j?.verdict || 'ERROR', bet: false });
        continue;
      }
      const direction = j.verdict === 'PREDICTED_YES' ? 0 : 1;
      const r = await _placeJudgedBet(bot, m.id, direction);
      results.push({ market: m.id.slice(-12), verdict: j.verdict, bet: true, favored: j.favored, provider: j.provider, ...r });
      if (r.status === 'CONFIRMED') {
        console.log(`[house-agent] predicted+bet ${m.id.slice(-12)} → ${j.verdict} (favored=${j.favored}, ${j.provider}) ${STAKE_KAS} KAS tx=${r.side_tx}`);
      }
    }
    return { ok: true, processed: results.length, results };
  } catch (e) {
    console.warn(`[house-agent] tick fail (non-fatal, retry next cycle): ${e.message}`);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startHouseAgentCron() {
  if (timer) return;
  console.log(`[house-agent] started — tick=${TICK_INTERVAL_MS}ms stake=${STAKE_KAS} relay=${RELAY_NAME} (#42 击败Agent 玩法: 判断+真押世界杯盘)`);
  timer = setInterval(() => { houseAgentTick().catch((e) => console.error('[house-agent] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopHouseAgentCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
