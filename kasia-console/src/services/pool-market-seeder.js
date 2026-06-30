// Pool-market seeder — auto-mirrors real Polymarket top-volume markets into KANet pool prediction
// markets, then auto-deposits the 3 server-sampled oracles so each market reaches `pending_bettors`
// (a live, bettable market for the prediction-menu bot S-C + UI).
//
// WHY mirror real Polymarket (not self-made templates): Owner r93 钦定 — the testbed must look like
// real diverse hot markets (politics/economy/sports/crypto), not a self-made crypto bubble. Phase 1
// thesis = mirror real UMA/Polymarket demand.
//
// Design (Bettor r240 S-A + r246 + r247 de-risk):
//   - HTTP self-call to this console's own pool API (same pattern as market-seeder.js) — reuses the
//     fully-validated create + oracle/deposit endpoints, zero logic duplication / drift.
//   - Maintains POOL_SEED_TARGET live pending_bettors markets; creates only when below target (no spam).
//   - r247 ①: gamma has NO category/tags field → categorizeMarket(question) is the primary classifier.
//   - r247 ②: gamma endDate can be undefined OR already-past even for active top-volume markets →
//     filter is BOTH-bounds (now+minLead < endDate ≤ now+30d) with a null guard. Uses the REAL endDate
//     (r246: true mirror of resolution timing; 30d cap is area-8 E7 safety, do not raise it).
//   - r247 ③ (volume / quality): skip markets below POOL_SEED_MIN_VOL24H + dedup by conditionId so the
//     same real market is never mirrored twice.
//   - create omits oracle_relay_ids → server Fisher-Yates samples 3 is_oracle=1 relays; then read them
//     back and auto-deposit each → market transitions to pending_bettors at the 3rd deposit.
//
// Env gates (opt-in — OFF by default so it never auto-spends on a host that didn't ask for it):
//   POOL_SEEDER_ENABLED=1         enable (default off)
//   POOL_SEEDER_MAKER_RELAY=<id>  maker relay that locks stake (REQUIRED when enabled)
//   POOL_SEED_TARGET=5            target live pending_bettors markets to maintain
//   POOL_SEED_STAKE_KAS=5         maker stake per seeded market
//   POOL_SEED_INTERVAL_MIN=10     tick interval (minutes)
//   POOL_SEED_MIN_VOL24H=0        minimum gamma volume24hr to mirror (quality gate)

import { sqlite } from '../db/client.js';
import { categorizeMarket } from '../lib/market-category.js';

const PORT = parseInt(process.env.PORT || '3100');
const BASE = `http://127.0.0.1:${PORT}`;
const GAMMA_URL = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume24hr&ascending=false';

let _timer = null;

export function startPoolMarketSeeder() {
  if (process.env.POOL_SEEDER_ENABLED !== '1') {
    console.log('[pool-seeder] disabled (set POOL_SEEDER_ENABLED=1 to enable)');
    return;
  }
  const maker = process.env.POOL_SEEDER_MAKER_RELAY;
  if (!maker) {
    console.warn('[pool-seeder] POOL_SEEDER_ENABLED=1 but POOL_SEEDER_MAKER_RELAY unset — NOT started');
    return;
  }
  const intervalMs = (parseInt(process.env.POOL_SEED_INTERVAL_MIN, 10) || 10) * 60_000;
  setTimeout(() => tick().catch(e => console.error('[pool-seeder] initial tick error:', e.message)), 8000);
  _timer = setInterval(() => tick().catch(e => console.error('[pool-seeder] tick error:', e.message)), intervalMs);
  console.log(`[pool-seeder] started — maker=${maker.slice(0, 8)} target=${process.env.POOL_SEED_TARGET || 5} interval=${intervalMs / 60000}min`);
}

export function stopPoolMarketSeeder() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// Pull real gamma top-volume markets, return up to `limit` eligible un-mirrored ones (newest-volume order).
// One gamma fetch per call → bounded gamma load regardless of how many markets tick() creates this round.
// Dedup: DB (outcome_condition_id) + in-batch (seen set, guards any gamma-internal dup conditionIds).
// Exported for standalone testing. J2-tn 2026-06-14e: was single-pick (1/tick supply cap); now batched top-up.
export async function pickGammaMarkets(limit = 1) {
  const r = await fetch(GAMMA_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`gamma ${r.status}`);
  const markets = await r.json();
  const now = Date.now();
  const minMs = now + 60 * 60_000;          // ≥1h lead so oracles + bettors have time
  // Bettor 06-03 raise: r246 30day cap raised → POOL_SEED_MAX_DAY env (= seeder-specific).
  // 默认 30 兼容; testnet demo 凑 100 markets + World Cup 2026 远 deadline 调 90 钦定.
  const maxDay = parseInt(process.env.POOL_SEED_MAX_DAY, 10) || 30;
  const maxMs = now + maxDay * 86400_000;
  const minVol = parseFloat(process.env.POOL_SEED_MIN_VOL24H) || 0;
  // Bettor 2026-06-03 钦定: 走 KANet 现有干净 JSON 格式 (= kanet_v07 markets 同 schema):
  // {title, data_source_canonical, resolution_criteria}. sanitizeText strip URL/HTML/curly quotes 防 bot 乱码.
  const { sanitizeText } = await import('../lib/market-spec-sanitizer.js');
  const out = [];
  const seen = new Set();   // in-batch dedup (gamma 理论可返同 conditionId 两行)
  for (const m of (markets || [])) {
    if (out.length >= limit) break;
    const endRaw = m.endDate || m.end_date_iso || m.endDateIso;
    if (!endRaw) continue;                            // r247 ②: null guard
    const endMs = new Date(endRaw).getTime();
    if (!Number.isFinite(endMs)) continue;            // r247 ②: unparseable guard
    if (endMs <= minMs || endMs > maxMs) continue;    // r247 ②: both-bounds (skip past + >30d)
    const condId = m.conditionId || m.condition_id;
    const question = m.question;
    if (!condId || !question) continue;
    if (parseFloat(m.volume24hr || m.volume || 0) < minVol) continue;  // r247 ③: volume quality gate
    const condStr = String(condId);
    if (seen.has(condStr)) continue;                  // in-batch dedup
    const dup = sqlite.prepare('SELECT 1 FROM pool_markets WHERE outcome_condition_id = ? LIMIT 1').get(condStr);
    if (dup) continue;                                // r247 ③: dedup by conditionId (vs already-mirrored)
    // J2-tn 2026-06-14 Q1 fix (Bettor r979/r983, Owner 查): 宽松 cap 不死截丢语义 (criteria 4000/title 500
    // = 100% 不截实 criteria 保语义, 同时封病态多 KB 撑爆链上 create payload chunk 880 墙). condition ID = UMA 锚不动.
    const TITLE_CAP = 500, CRITERIA_CAP = 4000;
    const cleanTitle = sanitizeText(String(question || '')).slice(0, TITLE_CAP);
    const cleanCriteria = sanitizeText(String(m.description || '')).slice(0, CRITERIA_CAP);
    const cleanSource = String(m.resolutionSource || m.resolution_source || '').trim();
    // data_source_canonical: 链上独立判定源, mirror-able 市场 = polymarket gamma 条件 ID.
    const dataSource = `polymarket:${condStr}`;
    const specObj = { title: cleanTitle, data_source_canonical: dataSource, source: 'polymarket' };
    if (cleanCriteria) specObj.resolution_criteria = cleanCriteria;
    if (cleanSource) specObj.resolution_source_url = cleanSource;
    // UMA adapter fields (J1 ingestion 2026-06-30): negRisk→adapter 路由·questionID→UMA OO reader join key
    if (m.questionID) specObj.uma_question_id = m.questionID;
    if (m.negRisk != null) specObj.neg_risk = !!m.negRisk;
    if (m.negRiskMarketID) specObj.neg_risk_market_id = m.negRiskMarketID;
    // #27 层B (Owner 钦定 2026-06-30 母子盘): 存 Polymarket event_id (赛事原生分组·gamma events[0]·100% 覆盖)。
    //   bot 按 event_id 把同赛事多玩法子盘归并到母盘显示(非单列)。实证: "Will Morocco win WC?" events[0]=id 30615 "World Cup Winner"。
    //   覆盖 100% (每 market 都有 events) > 标题前缀 22%。event_title/slug 供 bot 母盘显示名。
    const _ev = (Array.isArray(m.events) && m.events[0]) ? m.events[0] : null;
    if (_ev && _ev.id) {
      specObj.event_id = String(_ev.id);
      if (_ev.title) specObj.event_title = String(_ev.title).trim().slice(0, 200);
      if (_ev.slug) specObj.event_slug = String(_ev.slug);
    }
    seen.add(condStr);
    out.push({
      conditionId: condStr,
      question: cleanTitle,                           // short title (logging only)
      resolutionRule: JSON.stringify(specObj),        // JSON spec → resolution_rule_spec (capped fields, valid)
      endDateIso: new Date(endMs).toISOString(),
      category: categorizeMarket(question),           // r247①/r256: classify on TITLE only (desc false-matches country kw)
      volume24h: parseFloat(m.volume24hr || m.volume || 0),
    });
  }
  return out;
}

// Backward-compat single-pick (exported, used in tests / one-off callers).
export async function pickGammaMarket() {
  return (await pickGammaMarkets(1))[0] || null;
}

// Exported for deterministic testing (invoke one create+deposit cycle without waiting for the cron).
export async function tick() {
  const maker = process.env.POOL_SEEDER_MAKER_RELAY;
  const target = parseInt(process.env.POOL_SEED_TARGET, 10) || 5;
  // J2-tn 2026-06-14e (Owner 12:03 钦定: 定时上单子不能老手动 + 量上不来): top-up to target,
  // 不再 1/tick。每 tick 建 min(target-live, MAX_PER_TICK) 个 (MAX_PER_TICK 安全帽防单 tick 灌爆
  // maker stake 资金/节点; 逐 tick 爬到 target). 即时 burst 由一次性 build agent 灌, 本 cron 长效维持。
  const maxPerTick = parseInt(process.env.POOL_SEED_MAX_PER_TICK, 10) || 10;
  const live = sqlite.prepare("SELECT COUNT(*) c FROM pool_markets WHERE protocol_status = 'pending_bettors'").get().c;
  if (live >= target) return;  // maintain target, no spam

  const need = Math.min(target - live, maxPerTick);
  const gms = await pickGammaMarkets(need);   // 1 gamma fetch, up to `need` eligible un-mirrored
  if (!gms.length) { console.log('[pool-seeder] no eligible gamma market this tick'); return; }

  const stakeKas = parseFloat(process.env.POOL_SEED_STAKE_KAS) || 5;
  let created = 0, consecFail = 0;
  for (const gm of gms) {
    const createRes = await fetch(`${BASE}/api/pool/market/create-v07`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maker_relay_id: maker,
        // S2 broker-fee wiring (Bettor r615 per-path): user-facing 市场设 gateway 为 broker (不塌 maker).
        // gateway relay env-可配 (默认 broker-1 15593e10, P2PK 过 create-v07 chokepoint, is_oracle=0 过互斥).
        broker_relay_id: process.env.GATEWAY_RELAY_ID || '15593e10-fe63-4806-a7b5-cae062699de8',
        // Lane③ r654: 省略 broker_fee_pct → create-v07 读 gateway default_broker_fee_pct (gateway /broker 自设 fee 生效).
        // env GATEWAY_FEE_PCT 显式覆盖; 否则 undefined → JSON.stringify 省略 → 走 gateway 默认.
        broker_fee_pct: process.env.GATEWAY_FEE_PCT ? parseInt(process.env.GATEWAY_FEE_PCT, 10) : undefined,
        outcome_side: 'YES',
        outcome_end_date: gm.endDateIso,
        resolution_rule_spec: gm.resolutionRule,
        maker_stake_kas: stakeKas,
        outcome_condition_id: gm.conditionId,
        outcome_market_source: 'polymarket',
        category: gm.category,
        pool_merkle_root: 'auto',
      }),
    });
    let createdJ; try { createdJ = await createRes.json(); } catch { createdJ = { ok: false, error: `HTTP ${createRes.status}` }; }
    if (!createdJ.ok) {
      console.warn(`[pool-seeder] create-v07 fail: ${createdJ.error}`);
      // 连续失败 (≥3) = 系统性 (资金耗尽/节点/create 路) → 本 tick 退避, 下 tick 重试 (防灌满 maxPerTick 次噪音)。
      if (++consecFail >= 3) { console.warn('[pool-seeder] 3 consecutive create fails — backing off this tick'); break; }
      continue;   // 单个市场失败 (脏 gamma 数据) 不阻塞其余 top-up
    }
    consecFail = 0;
    created++;
    console.log(`[pool-seeder] created ${createdJ.market_id} [${gm.category}] vol=${Math.round(gm.volume24h)} "${gm.question.slice(0, 48)}" end=${gm.endDateIso} (${live + created}/${target})`);
  }
  if (created) console.log(`[pool-seeder] tick: +${created} market(s), live ${live}→${live + created}/${target}`);
  // v0.7 不需 oracle-deposit step (committee VRF samples at settle 时, 非 create 时); 旧 v0.5 auto-deposit
  // reference 块已删 (unreachable + 引用已移除的 marketId, J2-tn 2026-06-14e top-up 重构顺手清)。
}
