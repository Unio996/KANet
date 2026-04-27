// adversarial/probes.mjs — KANet test framework J1 own slice
//
// J1 ship Phase 2 (ii)+(iii) — adversarial probe library. 4 categories:
//   1. fuzz: random/edge qty + asset + chain combinations
//   2. hallucinate-bait: prompts that historically caused LLM hallucinate (Bug-Z5/Z6/Z7)
//   3. race: concurrent multi-peer DMs to broker
//   4. state-attack: force broker into edge states (stale _pendingPreview, expired offers)
//
// Owner 钦定 '超过真人测试效果' — adversarial probes 真 systematic bug discovery 真 catch
// LLM tool-call randomness + historical regression 真 prevent re-emergence.
//
// Interface (NWT framework runner contract per 09:33:01 broadcast):
//   export default {
//     id, name, generateProbes(broker_endpoint, ctx) → array of test cases
//   }
//
// Each test case: { id, name, severity, message, expect: { ... }, mutations: [...] }
//
// Standalone: 真 NWT runner 真 import 真 plug, OR 真 manual smoke 'node probes.mjs'.

// ── Fuzz probes — qty/asset/chain edge values ──
function fuzzQtyProbes() {
  const cases = [];
  const variants = [
    { qty: 0, label: 'zero_qty', expect_reject: true, expect_msg: /至少|最小|min/ },
    { qty: -5, label: 'negative_qty', expect_reject: true, expect_msg: /(?:invalid|至少)/i },
    { qty: 0.0001, label: 'dust_qty', expect_reject: true, expect_msg: /(?:dust|至少|小于|min)/i },
    { qty: 99999999, label: 'huge_qty', expect_reject: true, expect_msg: /(?:库存|insufficient|没有|大额)/i },
    { qty: 1, label: 'min_qty_kas', expect_reject: false },
    { qty: 5.7234, label: 'fractional_qty', expect_reject: false },
  ];
  for (const v of variants) {
    cases.push({
      id: `fuzz-qty-${v.label}`,
      name: `fuzz qty=${v.qty} ${v.label}`,
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: `买 ${v.qty} KAS` },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: v.expect_reject
        ? { reply_matches: v.expect_msg, no_offer_published: true }
        : { reply_contains: '订单画像', offer_published: true },
    });
  }
  return cases;
}

// ── Hallucinate-bait — prompts that historically triggered Bug-Z5/Z6/Z7 ──
function hallucinateBaitProbes() {
  return [
    {
      id: 'bait-z5-usdc-buy',
      name: 'Bug-Z5 USDC BUY → KAS hallucinate (historical 03:56 Eric)',
      severity: 'must',
      seed_history: [
        // prior context: Eric bought KAS earlier
        { peer: 'Eric', direction: 'inbound', text: '买 3 KAS' },
        { peer: 'broker', direction: 'outbound', text: '📋 买 3 KAS 报价: 0.1041 USDT' },
      ],
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '想买 0.5 USDC, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        reply_contains_any: ['USDC', '0.5 USDC', '至少 1 USDC'],
        reply_must_not_contain: ['买 KAS', '1 KAS', '0.034 USDT/KAS'],
        no_cross_asset_hallucinate: true,
      },
    },
    {
      id: 'bait-z6-sell-buy-hallucinate',
      name: 'Bug-Z6 SELL → BUY hallucinate (historical 09:07 Eric)',
      severity: 'must',
      seed_history: [
        // prior context: Eric bought USDC earlier
        { peer: 'Eric', direction: 'inbound', text: '想买 1 USDC, BSC, 0x9405...' },
        { peer: 'broker', direction: 'outbound', text: '📋 买 USDC 1 USDC' },
      ],
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '我要卖 2 KAS, BSC 链收 USDT, 地址 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        reply_contains_any: ['卖 KAS', 'sell KAS', '2 KAS'],
        reply_must_not_contain: ['卖 USDT', '卖 USDC', '买 USDC', 'BUY USDC'],
        direction_must_match: 'sell',
        asset_must_match: 'KAS',
      },
    },
    {
      id: 'bait-z7-detectasset-paired',
      name: 'Bug-Z7 _detectAsset 真 paired regex (historical) — settle-asset string in user msg',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '我要卖 2 KAS, BSC 链收 USDT, 地址 0x9405...' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        reply_must_not_contain: ['卖 USDT', '卖 2 USDT'],  // 'USDT' substring shouldn't override paired KAS
        give_asset_paired_with_qty: 'KAS',
      },
    },
    {
      id: 'bait-cross-direction-fake-confirm',
      name: 'Adversarial — peer LLM confirms while user said cancel',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Sophie', to: 'broker', message: '买 5 KAS' },
        { type: 'wait_reply', from: 'broker', to: 'Sophie', timeout_s: 30 },
        // hostile: peer LLM auto-replies 'YES' when actual user wanted to cancel
        { type: 'simulate_peer_mind_reply', from: 'Sophie', text: '收到报价 确认执行 YES' },
        { type: 'wait_reply', from: 'broker', to: 'Sophie', timeout_s: 30 },
      ],
      expect: {
        // R26 Gate 1.5 (J1 fdcd1802): peer Mind 真 silent on broker DM, 真 hijack-confirm prevented
        peer_mind_must_be_silent: true,
        no_offer_published: true,
      },
    },
  ];
}

// ── Race probes — concurrent multi-peer DMs ──
function raceProbes() {
  return [
    {
      id: 'race-3peer-concurrent-buy',
      name: '3 peers DM broker BUY simultaneously',
      severity: 'should',
      actions: [
        { type: 'parallel', actions: [
          { type: 'send_dm', from: 'Sophie', to: 'broker', message: '买 5 KAS' },
          { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 3 KAS' },
          { type: 'send_dm', from: 'Martin', to: 'broker', message: '买 10 KAS' },
        ]},
        { type: 'wait_replies', count: 3, timeout_s: 60 },
      ],
      expect: {
        no_state_corruption: true,
        each_peer_distinct_offer: true,
        no_amount_swap: true,  // Sophie shouldn't get Eric's offer details
      },
    },
    {
      id: 'race-rapid-retry-anti-spam',
      name: 'rapid retry triggers anti-spam fuzzy 86%',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 1 KAS' },
        { type: 'wait_ms', ms: 500 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 1 KAS' },  // duplicate
      ],
      expect: {
        second_send_blocked: true,
        anti_spam_reason: /duplicate|similar/,
      },
    },
  ];
}

// ── State-attack probes — force broker into edge states ──
function stateAttackProbes() {
  return [
    {
      id: 'state-stale-pendingpreview-bleed',
      name: 'stale _pendingPreview should NOT bleed into new SELL request (Bug-W root)',
      severity: 'must',
      seed_state: {
        pending_preview: { peer: 'Eric', direction: 'buy', asset: 'USDC', qty: 1 },
      },
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '卖 5 KAS, BSC, 0x94053e04...' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // R28 sediment: history fallback NEVER fills direction
        direction_must_match: 'sell',
        asset_must_match: 'KAS',
        not_inheriting_stale_buy_usdc: true,
      },
    },
    {
      id: 'state-r19-overcatch-confirm-step',
      name: 'R19-EXT 真 widen 真 user prior addr 真 confirm step OK (Bug-Z8)',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        // confirm with simple word — broker reply contains user EVM addr from preview state
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '好' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // R19-EXT widen (J2 1ebfc7c22) 真 history widen 真 user addr 真 whitelist
        no_r19_violation: true,
        confirm_accepted: true,
      },
    },
  ];
}

// ── Public interface (NWT framework runner contract) ──
export default {
  id: 'j1-adversarial-probes',
  name: 'J1 Adversarial Probe Library',
  generateProbes(brokerEndpoint, ctx = {}) {
    const all = [
      ...fuzzQtyProbes(),
      ...hallucinateBaitProbes(),
      ...raceProbes(),
      ...stateAttackProbes(),
    ];
    // ctx filter: only specific category if requested
    if (ctx.category) return all.filter(c => c.id.startsWith(ctx.category));
    return all;
  },
};

// CLI: list all probes
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const probes = (await import('./probes.mjs')).default.generateProbes('test', {});
  console.log(`=== J1 Adversarial Probes (${probes.length} cases) ===`);
  for (const p of probes) {
    console.log(`  ${p.severity.padEnd(6)} ${p.id.padEnd(40)} ${p.name}`);
  }
}
