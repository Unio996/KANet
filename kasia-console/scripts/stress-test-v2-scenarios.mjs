// stress-test-v2-scenarios.mjs — KI 65 Step 2 Phase 2.2 (NWT N19.245)
//
// 17 scenario dryRun impl. Each returns { ok, plan, preconditions[], would_trigger[] }.
// Phase 5 (= 24h real-money execute) wires real fire — Phase 2.2 真 plan + check only.
//
// dryRun semantics (per scenario):
//   1. Pick relay(s) via rng (deterministic per seed)
//   2. Verify preconditions (= relay exists, broker config OK, etc) — no balance read (= post-Phase 1B fund)
//   3. Build `would_trigger` list (= ordered step descriptors)
//   4. Return plan — caller decides real-fire vs report only

import { sqlite } from '../src/db/client.js';
import { getBrokerRelayIdOrThrow } from '../src/services/broker-config-resolver.js';
import cnSellerReal from '../test-framework/personas/real-chain/cn_seller_real.mjs';
import cnBuyerReal from '../test-framework/personas/real-chain/cn_buyer_real.mjs';

function pickRelay(ctx, type = 'user') {
  const pool = ctx.relays.filter(r => r.name.startsWith(`stress-${type}-`));
  const idx = Math.floor(ctx.rng() * pool.length);
  return pool[idx] || ctx.relays[0];
}

function pickNRelays(ctx, n, type = 'user') {
  const pool = ctx.relays.filter(r => r.name.startsWith(`stress-${type}-`));
  const out = [];
  const seen = new Set();
  while (out.length < n && seen.size < pool.length) {
    const idx = Math.floor(ctx.rng() * pool.length);
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(pool[idx]);
  }
  return out;
}

function getBrokerInfo() {
  const brokerId = getBrokerRelayIdOrThrow();
  const broker = sqlite.prepare('SELECT name, address FROM relay_nodes WHERE id = ?').get(brokerId);
  return { id: brokerId, ...broker };
}

// Phase 5.0 — load stress relay full info (Kasia + BSC) for real-mode invocation.
function loadRelayWalletInfo(relayId) {
  const relay = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE id = ?').get(relayId);
  if (!relay) return null;
  const bnb = sqlite.prepare(`SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1`).get(relayId);
  return {
    relayId: relay.id,
    name: relay.name,
    kasia: relay.address,
    bsc: bnb?.address || null,
  };
}

// Phase 5.0 — wrap persona invoke with real chain flow. Returns { ok, tx_hashes, persona_stage }.
// Phase 5 only A1 wired; other scenarios fall back to plan-only via planOnly arg in caller.
export async function invokeSellReal({ user, broker, kasAmount }) {
  if (!user.kasia || !user.bsc) return { ok: false, error: `user ${user.name} missing kasia/bsc address` };
  try {
    const result = await cnSellerReal.run(
      { id: `stress_${user.name}` },
      {
        relayId: user.relayId,
        userKasia: user.kasia,
        brokerKasia: broker.address,
        userEvmAddr: user.bsc,
        qty: kasAmount,
        chain: 'BSC',
      },
    );
    return { ok: result.stage === 'completed_flow', persona_stage: result.stage, quote: result.quote, error: result.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function invokeBuyReal({ user, broker, kasAmount }) {
  if (!user.kasia || !user.bsc) return { ok: false, error: `user ${user.name} missing kasia/bsc address` };
  try {
    const result = await cnBuyerReal.run(
      { id: `stress_${user.name}` },
      {
        relayId: user.relayId,
        userKasia: user.kasia,
        brokerKasia: broker.address,
        userEvmAddr: user.bsc,
        qty: kasAmount,
        chain: 'BSC',
        fromRelayName: user.name,
      },
    );
    return { ok: result.stage === 'completed_flow', persona_stage: result.stage, payTx: result.payTx, error: result.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function basePlan(scenarioId, scenarioDesc) {
  return {
    scenario: scenarioId,
    desc: scenarioDesc,
    broker: getBrokerInfo(),
    preconditions: [],
    would_trigger: [],
    ok: true,
  };
}

// Group A — happy path (broker matches user via exchange offer protocol)
function makeSell(kasAmount) {
  return async (ctx, scenario) => {
    const userBase = pickRelay(ctx);
    const user = loadRelayWalletInfo(userBase.id);
    const plan = basePlan(scenario.id, scenario.desc);
    plan.user = { name: user.name, id: user.relayId };
    plan.kas_amount = kasAmount;
    plan.estimated_usdt = +(kasAmount * 0.0343).toFixed(4);  // ~$0.0343/KAS approx market
    plan.preconditions = [
      `user ${user.name} 持 ≥ ${kasAmount} KAS (= Phase 1B fund 0.5 KAS per gas + this trade KAS)`,
      `broker ${plan.broker.name} 持 ≥ ${plan.estimated_usdt} USDT BSC`,
      `autoTaker config: buy_min_discount_pct + max_amount > ${plan.estimated_usdt}`,
    ];
    plan.would_trigger = [
      `1. user publish exchange_offer (give=${kasAmount} KAS, want=${plan.estimated_usdt} USDT BSC)`,
      `2. broker autoTaker filter: discount check vs market price`,
      `3. broker accept → matched → user sends KAS to broker Kaspa`,
      `4. broker delivers USDT to user BSC wallet`,
      `5. hedge (CEX KAS buy back, if size ≥ 25 KAS)`,
      `6. chain_event broker_fee_collected (= ${(kasAmount * 0.005).toFixed(4)} KAS fee, Block A.2 公式)`,
    ];
    // Phase 5.0 — real-mode invoke if ctx.realMode flag set (A1 MVP, A2-A3 排日 expand after A4 PASS)
    if (ctx.realMode && scenario.id === 'A1') {
      console.log(`[scenario-${scenario.id}] real-mode invoke cn_seller_real for ${user.name}`);
      const realResult = await invokeSellReal({ user, broker: plan.broker, kasAmount });
      plan.real_invoke = realResult;
      plan.ok = realResult.ok;
      if (!realResult.ok) plan.error = realResult.error;
    } else if (ctx.realMode) {
      plan.real_invoke = { ok: false, skipped: true, reason: `Phase 5.0 MVP — A1 SELL wired only, ${scenario.id} 排日 expand` };
    }
    return plan;
  };
}

function makeBuy(kasAmount) {
  return async (ctx, scenario) => {
    const userBase = pickRelay(ctx);
    const user = loadRelayWalletInfo(userBase.id);
    const plan = basePlan(scenario.id, scenario.desc);
    plan.user = { name: user.name, id: user.relayId };
    plan.kas_amount = kasAmount;
    plan.estimated_usdt = +(kasAmount * 0.0343).toFixed(4);
    plan.preconditions = [
      `user ${user.name} 持 ≥ ${plan.estimated_usdt} USDT BSC (= Phase 1B fund $10 default)`,
      `broker ${plan.broker.name} 持 ≥ ${kasAmount} KAS pool`,
      `autoTaker config: sell_min_premium_pct + max_amount > ${plan.estimated_usdt}`,
    ];
    plan.would_trigger = [
      `1. user publish exchange_offer (give=${plan.estimated_usdt} USDT BSC, want=${kasAmount} KAS)`,
      `2. broker autoTaker filter: premium check vs market price`,
      `3. broker accept → matched → user sends USDT BSC to broker`,
      `4. broker delivers KAS to user Kaspa wallet`,
      `5. hedge (CEX KAS sell, if size ≥ 25 KAS)`,
      `6. chain_event broker_fee_collected`,
    ];
    // Phase 5.0.1 — A4 BUY real-mode wired (= cnBuyerReal proven from (c) baseline PASS).
    // NWT N19.254 propose: A4 lowest-risk first (= same persona as buy_cancel test).
    if (ctx.realMode && scenario.id === 'A4') {
      console.log(`[scenario-${scenario.id}] real-mode invoke cn_buyer_real for ${user.name}`);
      const realResult = await invokeBuyReal({ user, broker: plan.broker, kasAmount });
      plan.real_invoke = realResult;
      plan.ok = realResult.ok;
      if (!realResult.ok) plan.error = realResult.error;
    } else if (ctx.realMode) {
      plan.real_invoke = { ok: false, skipped: true, reason: `Phase 5.0 MVP — A4 BUY wired (post-A1 retry), ${scenario.id} 排日 expand` };
    }
    return plan;
  };
}

// Group B — stress path
async function B1_concurrent(ctx, scenario) {
  const users = pickNRelays(ctx, 3, 'user');
  const plan = basePlan(scenario.id, scenario.desc);
  plan.users = users.map(u => u.name);
  plan.sizes = [1, 25, 100];  // diversified sizes
  plan.preconditions = [
    `3 user wallets 持 funded (= ${users.map(u => u.name).join(', ')})`,
    `broker capacity > sum of all 3 trades (~126 KAS / $4.3 USDT)`,
  ];
  plan.would_trigger = [
    `1. 3 user publish concurrent exchange_offer (sizes ${plan.sizes.join(',')} KAS) within 100ms`,
    `2. broker autoTaker race condition test (= cooldown / daily_limit gate)`,
    `3. expect 1-2 accept + 1-2 cooldown skip (= autotake_skip chain_event)`,
    `4. verify no double-spend / lock collision`,
  ];
  return plan;
}

async function B2_timeout(ctx, scenario) {
  const user = pickRelay(ctx);
  const plan = basePlan(scenario.id, scenario.desc);
  plan.user = { name: user.name };
  plan.preconditions = [`user ${user.name} 真 publish offer 但 NOT 真 pay (= silent 30 min)`];
  plan.would_trigger = [
    `1. user publish exchange_offer (= matched by broker)`,
    `2. user intentionally NOT send payment`,
    `3. wait 30min for expires_at`,
    `4. broker timeout transition (= verifying → expired)`,
    `5. exchange offer 真 reopen 真 verify (= state machine cleanup)`,
  ];
  return plan;
}

async function B3_cancel(ctx, scenario) {
  const user = pickRelay(ctx);
  const plan = basePlan(scenario.id, scenario.desc);
  plan.user = { name: user.name };
  plan.preconditions = [`user ${user.name} publish offer + mid-flight cancel`];
  plan.would_trigger = [
    `1. user publish exchange_offer`,
    `2. broker matched + state=verifying`,
    `3. user 真 cancel (= 真 send cancel DM to broker)`,
    `4. broker fund_lock release verify (= 不 leak)`,
    `5. chain_event exchange_cancelled 真 emit`,
  ];
  return plan;
}

// Group C — 0库存 broker (simplified Trader-B 兼 model)
async function C1_simplifiedSell(ctx, scenario) {
  const user = pickRelay(ctx);
  const plan = basePlan(scenario.id, scenario.desc);
  plan.user = { name: user.name };
  plan.kas_amount = 10;
  plan.preconditions = [
    `Trader-B roles_json = ["broker","marketmaker"] (= A.5 简化 verified)`,
    `getBrokerRelay() == getMarketMakerRelay() == Trader-B`,
    `MarketMaker-A relay exists but NOT used (= template only, status=template)`,
  ];
  plan.would_trigger = [
    `1. user ${user.name} SELL 10 KAS → broker (= Trader-B)`,
    `2. broker = MarketMaker, 同 entity invokes hedge (= CEX KAS buy)`,
    `3. chain_event audit shows broker=Trader-B + hedge by Trader-B (= 兼)`,
    `4. MarketMaker-A 0 chain_events (= 真 not participate)`,
  ];
  return plan;
}

async function C2_simplifiedBuy(ctx, scenario) {
  const user = pickRelay(ctx);
  const plan = basePlan(scenario.id, scenario.desc);
  plan.user = { name: user.name };
  plan.kas_amount = 10;
  plan.preconditions = [
    `Trader-B 兼 broker + marketmaker (= same entity)`,
    `Trader-B BSC USDT pool 真 receive user payment`,
  ];
  plan.would_trigger = [
    `1. user ${user.name} BUY 10 KAS (= pay USDT to broker)`,
    `2. Trader-B receives USDT (= broker role) → delivers KAS (= same entity, marketmaker role)`,
    `3. internal asset shift 真 happen but visible only via chain_event payload broker_relay_id`,
  ];
  return plan;
}

async function C3_templateIsolation(ctx, scenario) {
  const plan = basePlan(scenario.id, scenario.desc);
  plan.preconditions = [
    `MarketMaker-A relay exists (adapter_node_id NULL)`,
    `MarketMaker-A 0 stress trades expected (= NOT used in current simplified)`,
  ];
  plan.would_trigger = [
    `1. query chain_events for MarketMaker-A id during 24h test`,
    `2. expect: 0 row (= template 真 not participate, isolated from production flow)`,
    `3. verify admin Panel A status='template' is_template=true throughout`,
  ];
  return plan;
}

// Group D — production gap (J2 #666 catch)
async function D1_multiChainRace(ctx, scenario) {
  const user = pickRelay(ctx);
  const plan = basePlan(scenario.id, scenario.desc);
  plan.user = { name: user.name };
  plan.preconditions = [`user 持 BSC USDT + Arbitrum USDT; broker primary chain set ARB but user pays BSC`];
  plan.would_trigger = [
    `1. user publish offer with chain=BSC`,
    `2. broker primary hedge chain=Arbitrum (= multichain config)`,
    `3. user pays USDT BSC (= different chain than broker primary)`,
    `4. verify cross-chain reconcile (= broker accepts BSC payment, hedges ARB)`,
    `5. broker_treasury_monitor catches chain-mismatch payload (= chain_event audit)`,
  ];
  return plan;
}

async function D2_autoReplenish(ctx, scenario) {
  const plan = basePlan(scenario.id, scenario.desc);
  plan.preconditions = [
    `marketmaker-multichain-rebalance cron tick fires (= KI 51)`,
    `marketmaker-kas-refill cron tick fires (= KI 52)`,
  ];
  plan.would_trigger = [
    `1. drain broker BSC USDT pool below floor (= via simulated trades)`,
    `2. observe auto-replenish chain_event broker_auto_replenish_v2 emit`,
    `3. verify throttle_log 1h gate prevents storm`,
    `4. invariant: 0 chain_event emit if DRY_RUN=1 (= KI 51/52 dry-run test pattern)`,
  ];
  return plan;
}

async function D3_reputationGateFail(ctx, scenario) {
  const plan = basePlan(scenario.id, scenario.desc);
  plan.preconditions = [
    `low-reputation user attempts trade (= mock relation_states.classification=BLOCKED)`,
  ];
  plan.would_trigger = [
    `1. user (reputation=BLOCKED) publish offer`,
    `2. autoTaker reputation gate check → SKIP`,
    `3. chain_event autotake_skip emit with reason='reputation' (= #85.2 structured)`,
    `4. verify admin Panel autoTaker 24h skip 分布 shows reputation count++`,
  ];
  return plan;
}

async function D4_hedgeFailover(ctx, scenario) {
  const plan = basePlan(scenario.id, scenario.desc);
  plan.preconditions = [
    `hedge primary CEX (Bybit) simulated down`,
    `hedge failover chain configured (= CSV list: bybit,gateio,kucoin)`,
  ];
  plan.would_trigger = [
    `1. user SELL 25 KAS (= hedge size trigger)`,
    `2. broker hedge_router tries Bybit → fail`,
    `3. router tries gateio → PASS`,
    `4. chain_event hedge_placed payload broker_relay_id + cex='gateio'`,
    `5. KI 42 F-1 cross-chain hedge failover verified`,
  ];
  return plan;
}

async function D5_stuckEscrow(ctx, scenario) {
  const plan = basePlan(scenario.id, scenario.desc);
  plan.preconditions = [
    `escrow active > 1h (= simulated stuck condition)`,
    `OR refunded state but refund_tx NULL (= KI 63 type)`,
  ];
  plan.would_trigger = [
    `1. simulate stuck escrow row in retail_dex_orders`,
    `2. /api/admin/overview stuck panel surface (= count > 0)`,
    `3. admin Panel UI shows alert with stuck_reason`,
    `4. invariant: stuck > 0 → admin UI alert visible (Playwright assert)`,
  ];
  return plan;
}

export const SCENARIO_IMPL = {
  A1: makeSell(1),
  A2: makeSell(25),
  A3: makeSell(100),
  A4: makeBuy(1),
  A5: makeBuy(25),
  A6: makeBuy(100),
  B1: B1_concurrent,
  B2: B2_timeout,
  B3: B3_cancel,
  C1: C1_simplifiedSell,
  C2: C2_simplifiedBuy,
  C3: C3_templateIsolation,
  D1: D1_multiChainRace,
  D2: D2_autoReplenish,
  D3: D3_reputationGateFail,
  D4: D4_hedgeFailover,
  D5: D5_stuckEscrow,
};
