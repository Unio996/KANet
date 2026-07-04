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
//      c. Call register-v07/prep (+bet_id nonce) → relay transfer exact → register-v07/confirm (shard-aware)
//   3. Idempotent: relay × market uniqueness 自然由 side_p2sh UNIQUE 守 (= 同 direction 同 bettor 同 market 同 stake = 同 P2SH).
//
// Guardrails:
//   - relay alive check (= isRelayAlive)
//   - balance ≥ MIN_RESERVE_KAS (= 10 default, 留 fees)
//   - deadline < 120s skip 防 race
//   - per-cycle / per-relay 上限 PER_TICK 防资金过快烧

import { randomBytes } from 'node:crypto';
import { sqlite } from '../db/client.js';
import { isRelayAlive, sendCommandAsync } from './relay-manager.js';
import { getSidesByLogicalMarket } from '../lib/pool-bettor-sides-query.mjs';

// #42 加大方案 cap 安全 (Bettor 2026-07-04): 8+ bot 高频押·世界杯盘会很快填满 900 叶子上限
// (G3 register-v07/prep 的硬顶, pool.js MARKET_MAX_LEAVES_G3)。满的盘该自动被 bot 跳过换下一个,
// 不是撞 PREP_FAIL 空转。跟 create-v07 cap-check 同一个 shard-aware helper(非裸查 market_id,
// 防 shard-blind 漏计——bshard 押注按 shard_market_id 存, 裸查 logical id 会漏, 见 ANTI-PATTERNS).
const AUTO_BET_MAX_LEAVES = 900;

// J2-tn r428 (Bettor r466 Owner 钦定火力全开): tick 60s→20s, PER_TICK 2→50 (= 押所有开放市场).
// 8 单并发 0-bet 饿死 surface → 调猛 3x 频率 + 每 tick 全市场扫.
// J2-tn #27c (Bettor r529/r532 sprint): `|| 20_000` / `|| default` 是 falsy bug — Number('0')=0 与 ''
// 都 falsy → 退回默认, 所以 AUTO_BET_TICK_MS=0 永远无法 disable (startAutoBetterCron L187 ===0 成死码;
// demo 期只能用 999999999 绕停) + AUTO_BET_RELAYS='' 无法清空。抽成纯函数 export 供 regression 单测
// (test-framework/standalone/test_autobet_config_parse.mjs)。
export function parseTickMs(raw) {
  const n = Number(raw);
  return (Number.isFinite(n) && n >= 0) ? n : 20_000;  // 显式 0 = disabled (L187); NaN/unset/负 → 20s 默认
}
export function parseRelays(raw) {
  // `??` (非 `||`): 显式 '' → [] (filter(Boolean) 后) = 彻底清空; 只 null/undefined(unset) → 默认串。
  // #27b (KANet-UI sprint): 默认串移除 oracle relays (tester-1/2/3) — 它们既是委员池成员又被 auto-bet
  // 押注 → 制造 oracle∩bettor 重叠 (#27a J1 sampler 要排除的)。auto-bet 只用非-oracle 押注 bot。
  // ⚠ 同批部署 (#27a + #27b): 单上 #27a (排除 bettor-oracle) 会饿死委员若 oracle 仍在押; 必跟此 land。
  return (raw ?? 'AutoBetter-1,AutoBetter-2,AutoBetter-3').split(',').map(s => s.trim()).filter(Boolean);
}
const TICK_INTERVAL_MS = parseTickMs(process.env.AUTO_BET_TICK_MS);
const PER_TICK = Number(process.env.AUTO_BET_PER_TICK) || 50;  // 押所有开放市场 (每个 relay 每 tick 上限 50 单, 实际看 markets.length)
const MIN_STAKE_KAS = Number(process.env.AUTO_BET_MIN_STAKE_KAS) || 1;
const MAX_STAKE_KAS = Number(process.env.AUTO_BET_MAX_STAKE_KAS) || 50;
const MIN_RESERVE_KAS = Number(process.env.AUTO_BET_MIN_RESERVE_KAS) || 10;
const RELAYS = parseRelays(process.env.AUTO_BET_RELAYS);
const CONSOLE_BASE = process.env.AUTO_BET_CONSOLE_BASE || 'http://127.0.0.1:3200';
// NEAR_DEADLINE_SEC: only bet on markets expiring within this window. Default 6h (prod focus); testnet
// can set AUTO_BET_NEAR_DEADLINE_H env to cover longer-horizon markets.
const NEAR_DEADLINE_SEC = (Number(process.env.AUTO_BET_NEAR_DEADLINE_H) || 6) * 3600;

let timer = null;
let running = false;

// J2 2026-06-28 (Bettor 派·稳定性): self-call fetch + AbortController timeout. 无 timeout 时·event-loop 饱和期
//   self-call(打同一 console)挂死 → await 永挂 → running 卡 true → auto-bet 静默停 + 挂的连接占用放大饱和
//   (Bettor 裁: auto-bet=amplifier 非 root)。timeout fail-fast → throw AbortError → _placeBet catch 接住 →
//   释放 running → 下 tick 重试。robustness: auto-bet 扛过 transient 饱和不卡死。
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
const FETCH_TIMEOUT_FAST_MS = Number(process.env.AUTO_BET_FETCH_TIMEOUT_FAST_MS) || 10_000;   // prep / balance (轻查询)
const FETCH_TIMEOUT_TX_MS = Number(process.env.AUTO_BET_FETCH_TIMEOUT_TX_MS) || 30_000;       // transfer / confirm (链上 TX)

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

// J2-tn 2026-06-30 (Owner "删老代码" + Bettor commingle 根治): auto-bet 改走 register-v07/prep+confirm
//   (shard-aware 路·第一注 open_new 建 shard·满 32 自动滚片)。**删 v06 logical 押注路** = commingling 物理
//   不可能(v07 永远落 shard·pool_bettor_sides.market_id = shard_market_id·非 logical)。
//   v07 与 v06 的关键差异: ① 必带 bet_id(nonce 熵源·解同 relay 同向复押碰撞)② confirm 返 `registered`(非 `ok`·
//   ok:true 仍可能 registered:false/pending/ambiguous)③ prep 返 exact_stake_kas 已含 nonce(8 位精度·KAS↔sompi 精确往返)。
//   验收(Bettor): 1 注 → market_shards 出记录 + pool_bettor_sides.market_id = shard_market_id(-s0)。
async function _placeBet(bot, market) {
  const direction = _randomDirection();
  const stakeKas = _randomStakeKas();
  const dirLabel = direction === 0 ? 'YES' : 'NO';
  const tag = market.id.slice(-12);
  const betId = randomBytes(8).toString('hex');   // 每笔唯一 nonce 熵源 (复押去碰撞)

  try {
    // Step 1: prep (v07) — compute side_p2sh + exact stake (含 nonce)
    const prepR = await fetchWithTimeout(`${CONSOLE_BASE}/api/pool/market/${market.id}/bettor/register-v07/prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: parseFloat(stakeKas), bet_id: betId }),
    }, FETCH_TIMEOUT_FAST_MS);
    const prep = await prepR.json();
    if (!prep.ok) {
      if (String(prep.error || '').toLowerCase().includes('already')) return { tag, bot: bot.name, status: 'DUP' };
      return { tag, bot: bot.name, status: 'PREP_FAIL', error: String(prep.error || '').slice(0, 80) };
    }

    // Step 2: transfer — relay sends exact_stake_kas (含 nonce·8 位精度) to side_p2sh
    const payR = await fetchWithTimeout(`${CONSOLE_BASE}/api/relay/${bot.id}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: prep.side_p2sh, amount: prep.exact_stake_kas }),
    }, FETCH_TIMEOUT_TX_MS);
    const pay = await payR.json();
    if (!pay.ok || !pay.txId) return { tag, bot: bot.name, status: 'PAY_FAIL', error: String(pay.error || '').slice(0, 80) };

    // Step 3: confirm (v07) — detect payment → registerBettorOnShard splice (落 shard·非 logical)
    // Try confirm a few times because UTXO needs to land in indexer/mempool.
    // v07: 检 `registered`(非 `ok`); ambiguous=同额多 UTXO 碰撞→停(bet_id 唯一时不该发生)。
    let confirmed = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 3000 + attempt * 2000));
      const confirmR = await fetchWithTimeout(`${CONSOLE_BASE}/api/pool/market/${market.id}/bettor/register-v07/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_addr: bot.address, direction, stake_kas: parseFloat(stakeKas), bet_id: betId }),
      }, FETCH_TIMEOUT_TX_MS);
      const confirm = await confirmR.json();
      if (confirm.registered) { confirmed = confirm; break; }
      if (confirm.ambiguous) return { tag, bot: bot.name, status: 'AMBIGUOUS', pay_tx: pay.txId.slice(0, 16) };
    }
    if (!confirmed) {
      return { tag, bot: bot.name, status: 'PAID_NOT_CONFIRMED', pay_tx: pay.txId.slice(0, 16), stake: prep.exact_stake_kas, dir: dirLabel };
    }
    const shardId = confirmed.shard_market_id || confirmed.shardMarketId || '?';
    return { tag, bot: bot.name, status: 'CONFIRMED', side_tx: pay.txId.slice(0, 16), stake: prep.exact_stake_kas, dir: dirLabel, shard: shardId };
  } catch (e) {
    return { tag, bot: bot.name, status: 'EXCEPTION', error: String(e.message || '').slice(0, 80) };
  }
}

// J2-tn r433 (Bettor r471 真解): 聚焦 near-deadline 单, 不均摊 97+ 远期单 → 押注稀释.
// 排序 deadline ASC (= 最早过期优先) + LIMIT 20 (= 仅最临近 20 个市场).
// NEAR_DEADLINE_SEC 通过 AUTO_BET_NEAR_DEADLINE_H env 可调(默认 6h; testnet 常设更大覆盖远期盘).
// FINDING-2 ③ 止血 (KANet-UI 2026-06-28): 排 commingled-spine v0.7 盘 (spine_p2sh 被 >1 市场共享).
// 根治=J1 assertNotCommingled 入口闸 (register-v06/register-v07/register); 此处防 auto-bet 持续灌.
// NULL spine (v0.6 盘) 不受影响 (IS NULL 分支 pass).
// #42 (Bettor 2026-07-04, KANet-UI 二次根因 + Bettor union 方案): 世界杯盘(卡片洞见/公开 demo 活跃度命脉)
// deadline 40-68h·排在 top-20-by-deadline 之外, 永远抽不到. 不改 r433 的防稀释设计(top-20 仍是主池)——
// 加一路 UNION: card_group_id LIKE 'fifa-2026%' 的市场无条件补进候选池(不受 deadline 排名限制, 但仍走
// 同一套 pending_bettors/v0.7/deadline-window/非-commingled 安全过滤), 世界杯盘永远在池里能被随机抽到.
async function _fetchEligibleMarkets() {
  const rows = sqlite.prepare(`
    SELECT id, protocol_version, deadline FROM (
      SELECT id, protocol_version, deadline
      FROM pool_markets
      WHERE protocol_status = 'pending_bettors'
        AND protocol_version = 'v0.7'
        AND deadline > unixepoch() + 120
        AND deadline < unixepoch() + ?
        AND (spine_p2sh IS NULL OR spine_p2sh NOT IN (
          SELECT spine_p2sh FROM pool_markets
          WHERE protocol_version = 'v0.7' AND spine_p2sh IS NOT NULL
          GROUP BY spine_p2sh HAVING COUNT(*) > 1
        ))
      ORDER BY deadline ASC
      LIMIT 20
    )
    UNION
    SELECT id, protocol_version, deadline FROM (
      SELECT id, protocol_version, deadline
      FROM pool_markets
      WHERE protocol_status = 'pending_bettors'
        AND protocol_version = 'v0.7'
        AND deadline > unixepoch() + 120
        AND deadline < unixepoch() + ?
        AND resolution_rule_spec LIKE '%"card_group_id":"fifa-2026%'
        AND (spine_p2sh IS NULL OR spine_p2sh NOT IN (
          SELECT spine_p2sh FROM pool_markets
          WHERE protocol_version = 'v0.7' AND spine_p2sh IS NOT NULL
          GROUP BY spine_p2sh HAVING COUNT(*) > 1
        ))
    )
  `).all(NEAR_DEADLINE_SEC, NEAR_DEADLINE_SEC);
  // cap 安全: 跳过已达 900 叶子上限的盘(shard-aware 跨 shard 计数, 非裸 market_id 查).
  return rows.filter((r) => getSidesByLogicalMarket(r.id, sqlite).length < AUTO_BET_MAX_LEAVES);
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

// J2-tn r431 (NWT r362 audit catch): r428 commit 声称 balance guardrail 实际 0 ref.
// 真 guardrail: 每 relay 每 tick 查一次 balance, < MIN_RESERVE_KAS 则跳过整 relay 本 tick.
async function _getBalanceKas(relayId) {
  try {
    const r = await fetchWithTimeout(`${CONSOLE_BASE}/api/relay/${relayId}/balance`, {}, FETCH_TIMEOUT_FAST_MS);
    const j = await r.json();
    if (!j?.ok) return null;
    // /api/relay/:id/balance 返 { ok, total_sompi, ... } 通常. 兼容 multiple shapes.
    const sompi = j.total_sompi ?? j.balance_sompi ?? j.totalSompi ?? null;
    if (typeof sompi === 'number') return sompi / 1e8;
    if (typeof sompi === 'string') return parseInt(sompi, 10) / 1e8;
    return null;
  } catch { return null; }
}

export async function autoBetterTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const markets = await _fetchEligibleMarkets();
    if (markets.length === 0) return { ok: true, processed: 0, note: 'no eligible markets' };
    const bots = _fetchRelayBots();
    if (bots.length === 0) return { ok: true, processed: 0, note: 'no alive relay bots' };

    const summary = { prep_fail: 0, pay_fail: 0, paid_not_confirmed: 0, confirmed: 0, dup: 0, exception: 0, low_balance_skip: 0 };
    const placements = [];
    for (const bot of bots) {
      // r431 (NWT r362 audit catch): real balance guardrail. < MIN_RESERVE 整 relay skip 本 tick.
      const balKas = await _getBalanceKas(bot.id);
      if (balKas !== null && balKas < MIN_RESERVE_KAS) {
        summary.low_balance_skip++;
        console.warn(`[auto-bet] ${bot.name} balance ${balKas.toFixed(2)} KAS < MIN_RESERVE_KAS=${MIN_RESERVE_KAS} → skip relay this tick`);
        continue;
      }
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
