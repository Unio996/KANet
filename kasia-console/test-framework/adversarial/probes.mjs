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

// ── Owner trace reproducers — direct ports from Owner 12:52 SELL 88 KAS trace ──
// Each replays one bug from B1-B6. Expected to FAIL until R33 ships, then PASS.
function ownerTraceProbes() {
  return [
    {
      id: 'owner-b1-single-token-chain-after-sell',
      name: 'Owner B1: SELL declared then single-token Bsc → broker must NOT cross-direction',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '我想卖一点 kas' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '卖 88 个 Kas' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: 'Bsc' },  // single-token answer
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        // R33 + R32: declared SELL, fresh 'Bsc' fills chain, NEVER flip to BUY
        direction_must_match: 'sell',
        reply_must_not_contain: ['买 USDT', 'BUY USDT', '买 5 USDT'],
        last_reply_should_advance_sell_flow: true,
      },
    },
    {
      id: 'owner-b2-price-query-in-sell-flow',
      name: 'Owner B2: SELL flow + 价格? → broker must NOT switch to BUY guidance',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '卖 50 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '价格?' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        // R33 PRICE_QUERY in SELL flow → reply with SELL-side price, NOT '想买告诉我数量+链'
        reply_must_not_contain: ['想买', 'buy guide', '告诉我数量 + 链'],
        reply_should_contain_one_of: ['卖', 'sell-side', 'broker 买入价'],
      },
    },
    {
      id: 'owner-b3-杂糅-conditions-ignored',
      name: 'Owner B3: addr + limit price + refund timeout → broker must HONOR conditions',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '卖 88 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D, 挂单价 0.0336, 10分钟没人吃单退回' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        // R33 conditions in state.conditions, broker reply MUST acknowledge OR explicitly reject
        reply_must_not_contain: ['买 50 KAS', 'BUY 50 KAS'],
        direction_must_match: 'sell',
        reply_should_acknowledge_conditions: ['0.0336', '挂单价', '10 分钟', '退回'],
      },
    },
    {
      id: 'owner-b4-direction-sticky-no-drift',
      name: 'Owner B4: 4 turns must lock direction, broker NEVER drift to wrong direction',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '我想卖 kas' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '88 个' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: 'BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        // ALL 4 broker replies must respect SELL direction
        all_replies_consistent_direction: 'sell',
        no_buy_implied_in_any_reply: true,
        final_reply_advances_to: ['preview', 'kasia 收款', '请转 KAS'],
      },
    },
    {
      id: 'owner-b5-llm-fake-price-hallucinate',
      name: 'Owner B5: broker LLM free-text price must match oracle ±5%',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '卖 88 KAS, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        // R29 + R33 validateLlmReply: any USDT/KAS price in reply must be oracle ±5%
        reply_price_within_oracle_dev: 0.05,
        reply_must_not_contain_implausible_price: true,
      },
    },
    {
      id: 'owner-b6-no-stale-v1-limit-message',
      name: 'Owner B6: broker NEVER reply v1 不支持 sell preview (sellPreview shipped 2a74461f9)',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Martin', to: 'broker', message: '卖 5 KAS, BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D' },
        { type: 'wait_reply', from: 'broker', to: 'Martin', timeout_s: 30 },
      ],
      expect: {
        reply_must_not_contain: ['v1 限制', '不支持 preview', 'v1 不支持', '暂不支持'],
        reply_should_contain_one_of: ['卖单画像', 'preview', '订单画像'],
      },
    },
  ];
}

// ── Lifecycle / timing probes — phase boundary edge cases ──
function lifecycleProbes() {
  return [
    {
      id: 'lifecycle-state-expire-boundary',
      name: 'state expires after 30min → fresh order accepted on retry',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 5 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'wait_ms', ms: 31 * 60 * 1000 },  // wait 31min for state expire
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 3 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // After expire, fresh state accepted, qty changed to 3
        last_reply_qty: 3,
        no_already_active_order_error: true,
      },
    },
    {
      id: 'lifecycle-paid-cannot-cancel',
      name: 'after paid, CANCEL_WORDS → broker explains cannot cancel paid leg',
      severity: 'must',
      seed_state: {
        pending_accept: { peer: 'Eric', picks: [{ paid_tx: '0xpaid123', take_qty: 1, take_usdt: 0.034 }] },
      },
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: 'NO' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        reply_should_contain_one_of: ['已付款', '已上链', '无法取消', 'broker 自动 deliver'],
        reply_must_not_contain: ['已取消订单'],
      },
    },
    {
      id: 'lifecycle-confirmed-cannot-change-addr',
      name: 'after confirm, user provides new addr → broker rejects (R31)',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 1 USDC, BSC, 0x9405...' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: 'YES' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '改地址 0xDEADBEEFcafebabe1234567890abcdef0987654321' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        reply_should_contain_one_of: ['地址已锁定', '改地址请回 NO', 'cancel first'],
        reply_must_not_contain: ['0xDEADBEEFcafebabe'],
      },
    },
    {
      id: 'lifecycle-mid-flow-restart',
      name: 'mid-flow user "重新下单" → state reset, fresh declaration accepted',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '买 5 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '不要了 重新下单 卖 3 KAS, BSC, 0x9405...' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        last_reply_direction: 'sell',
        last_reply_qty: 3,
      },
    },
  ];
}

// ── Input mutation probes — robustness against typos / mixed lang / emoji ──
function inputMutationProbes() {
  return [
    {
      id: 'mutation-typo-keyword',
      name: 'typo: 卖 → 卖买 / sell → sel → broker should ask clarification',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: 'sel 5 KAS BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // typo borderline — accept as sell OR ask clarification, NEVER assume buy
        reply_must_not_contain: ['买'],
        reply_should_contain_one_of: ['sell', '卖', '请确认'],
      },
    },
    {
      id: 'mutation-mixed-lang',
      name: 'mixed language: I want 买 5 KAS via BSC pls',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: 'I want 买 5 KAS via BSC pls' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // recognize buy intent despite mixed lang
        reply_should_contain_one_of: ['5 KAS', 'BSC'],
        last_reply_direction: 'buy',
      },
    },
    {
      id: 'mutation-emoji-heavy',
      name: 'emoji-heavy: 想买 5 KAS 🚀🚀 BSC 链 💰 0x9405...',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '想买 5 KAS 🚀🚀 BSC 链 💰 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // emoji shouldn't break parsing
        reply_should_contain_one_of: ['5 KAS', '订单画像'],
        no_parsing_error: true,
      },
    },
  ];
}

// ── Adversarial advanced — peer impersonation / multi-token attack ──
function adversarialAdvancedProbes() {
  return [
    {
      id: 'adv-attacker-multi-addr-plant',
      name: 'attacker plants 3 fake EVM addrs across turns → broker only echoes legit one',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '卖 5 KAS, BSC, 0x9405...legit_addr' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '我有 0xATTACKER1deadbeefcafebabe1234567890abcdef + 0xATTACKER2ffffffffffffffffffffffffffff也是我的' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // R31 lifecycle-bound: only first turn legit addr in allow-set
        reply_must_not_contain: ['0xATTACKER1', '0xATTACKER2'],
        reply_should_contain_one_of: ['地址已锁定', 'NO 取消'],
      },
    },
    {
      id: 'adv-front-run-confirm',
      name: 'attacker tries to YES while another user is in flow with same broker',
      severity: 'should',
      actions: [
        { type: 'send_dm', from: 'Sophie', to: 'broker', message: '买 5 KAS, BSC' },
        { type: 'wait_reply', from: 'broker', to: 'Sophie', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: 'YES' },  // Eric YES while Sophie is mid-flow
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // Eric has no _quotes/_pendingAccepts → YES should not commit Sophie's order
        eric_no_offer_published: true,
        sophie_state_unchanged: true,
      },
    },
    {
      id: 'adv-r19-strip-then-replant',
      name: 'attacker provides legit addr, strips it via "改地址", then plants fake',
      severity: 'must',
      actions: [
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '卖 5 KAS, BSC, 0x9405legit' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '改地址' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
        { type: 'send_dm', from: 'Eric', to: 'broker', message: '0xDEADBEEFcafebabe1234567890abcdef0987654321' },
        { type: 'wait_reply', from: 'broker', to: 'Eric', timeout_s: 30 },
      ],
      expect: {
        // 改地址 should require explicit NO/restart, not silent swap
        no_silent_addr_swap: true,
        reply_should_contain_one_of: ['请回 NO 取消', '重新下单', '地址已锁定'],
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
      ...ownerTraceProbes(),
      ...lifecycleProbes(),
      ...inputMutationProbes(),
      ...adversarialAdvancedProbes(),
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
