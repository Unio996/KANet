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

// Pull real gamma top-volume markets, return the first eligible un-mirrored one (or null).
// Exported for standalone testing without the cron.
export async function pickGammaMarket() {
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
  for (const m of (markets || [])) {
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
    const dup = sqlite.prepare('SELECT 1 FROM pool_markets WHERE outcome_condition_id = ? LIMIT 1').get(condStr);
    if (dup) continue;                                // r247 ③: dedup by conditionId
    // Bettor 2026-06-03 钦定: 走 KANet 现有干净 JSON 格式 (= kanet_v07 markets 同 schema):
    // {title: 干净题干, data_source_canonical: <polymarket URL>, resolution_criteria: 干净规则}.
    // 用 sanitizeText strip URL/HTML/curly quotes 防 bot 显示乱码 (Owner 06-03 报).
    const { sanitizeText } = await import('../lib/market-spec-sanitizer.js');
    const cleanTitle = sanitizeText(String(question || '')).slice(0, 200);
    const cleanCriteria = sanitizeText(String(m.description || '')).slice(0, 1500);
    const cleanSource = String(m.resolutionSource || m.resolution_source || '').trim();
    // data_source_canonical: 链上独立判定源, mirror-able 市场 = polymarket gamma 条件 ID.
    const dataSource = `polymarket:${condStr}`;
    const specObj = { title: cleanTitle, data_source_canonical: dataSource, source: 'polymarket' };
    if (cleanCriteria) specObj.resolution_criteria = cleanCriteria;
    if (cleanSource) specObj.resolution_source_url = cleanSource;
    return {
      conditionId: condStr,
      question: cleanTitle,                           // short title (logging only)
      resolutionRule: JSON.stringify(specObj).slice(0, 2000),  // JSON spec → resolution_rule_spec
      endDateIso: new Date(endMs).toISOString(),
      category: categorizeMarket(question),           // r247①/r256: classify on TITLE only (desc false-matches country kw)
      volume24h: parseFloat(m.volume24hr || m.volume || 0),
    };
  }
  return null;
}

// Exported for deterministic testing (invoke one create+deposit cycle without waiting for the cron).
export async function tick() {
  const maker = process.env.POOL_SEEDER_MAKER_RELAY;
  const target = parseInt(process.env.POOL_SEED_TARGET, 10) || 5;
  const live = sqlite.prepare("SELECT COUNT(*) c FROM pool_markets WHERE protocol_status = 'pending_bettors'").get().c;
  if (live >= target) return;  // maintain target, no spam

  const gm = await pickGammaMarket();
  if (!gm) { console.log('[pool-seeder] no eligible gamma market this tick'); return; }

  const stakeKas = parseFloat(process.env.POOL_SEED_STAKE_KAS) || 5;
  const createRes = await fetch(`${BASE}/api/pool/market/create-v07`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maker_relay_id: maker,
      // S2 broker-fee wiring (Bettor r615 per-path): user-facing 市场设 gateway 为 broker (不塌 maker).
      // gateway relay env-可配 (默认 broker-1 15593e10, P2PK 过 create-v07 chokepoint, is_oracle=0 过互斥).
      broker_relay_id: process.env.GATEWAY_RELAY_ID || '15593e10-fe63-4806-a7b5-cae062699de8',
      broker_fee_pct: parseInt(process.env.GATEWAY_FEE_PCT, 10) || 200, // 2% (bp) of losing pool
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
  const created = await createRes.json();
  if (!created.ok) { console.warn(`[pool-seeder] create-v07 fail: ${created.error}`); return; }
  const marketId = created.market_id;
  console.log(`[pool-seeder] created ${marketId} [${gm.category}] vol=${Math.round(gm.volume24h)} "${gm.question.slice(0, 48)}" end=${gm.endDateIso} v0.7 → pending_bettors`);
  return;
  // v0.7 不需 oracle-deposit step (= committee VRF samples at settle 时, 非 create 时).
  // 下面是 v0.5 path 留 reference 不跑.
  // read the 3 server-sampled oracle_relay_ids back
  const mres = await fetch(`${BASE}/api/pool/market/${marketId}`);
  const mj = await mres.json();
  let oracles = [];
  try { oracles = JSON.parse(mj.market?.oracle_relay_ids || '[]'); } catch {}
  if (oracles.length !== 3) { console.warn(`[pool-seeder] ${marketId}: ${oracles.length} oracles, expected 3 — left pending_oracle_deposits`); return; }

  // auto-deposit each → market hits pending_bettors at the 3rd
  for (const oid of oracles) {
    const dres = await fetch(`${BASE}/api/pool/market/${marketId}/oracle/deposit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oracle_relay_id: oid }),
    });
    const dj = await dres.json();
    if (!dj.ok) { console.warn(`[pool-seeder]   oracle ${oid.slice(0, 8)} deposit fail: ${dj.error} — ${marketId} stuck pending_oracle_deposits`); return; }
    console.log(`[pool-seeder]   oracle ${oid.slice(0, 8)} deposited (${dj.deposits_received}/3 → ${dj.market_status})`);
  }
  console.log(`[pool-seeder] ${marketId} → pending_bettors ✓`);
}
