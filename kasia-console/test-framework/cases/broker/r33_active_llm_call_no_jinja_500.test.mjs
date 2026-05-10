// R33 active state lock + LLM call: 防 Bug-Z24 reintroduce (双 system msg → Qwen Jinja 500 → fallback)
//
// Root cause history:
//   - T-J1-19f (撤回 INTENT_LOCK system msg unshift): J1 验证 'Qwen 见第二条 system msg 退化返空'
//   - R33 wire (commit 371e4ca62, J2 ship 04-27 21:44): J2 漏看 T-J1-19f 注释, 加 history.unshift({role:'system', stateLockAddendum})
//     reintroduce 双 system msg
//   - Bug-Z24 (commit e8f8e064, J1 ship 04-28): merge stateLockAddendum 进单 system msg
//   - lint R37 (commit a507aafc9, NWT ship 04-28): broker-llm-agent.js {role:'system'} literal ≤1, > 1 → pre-commit reject
//
// Test scenario:
//   Turn 1: trigger SELL state (set R33 _pendingFields lock active for direction='sell')
//   Turn 2: send unstructured natural message → triggers LLM call with R33 stateLockAddendum injection
//   Assert: broker reply NOT contain LLM fallback signature (would appear if Qwen returns 500)
//
// 三方 v2.2 convergence: dev-coord broadcast a874c0d8 (2026-04-28).

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('r33-llm-' + Date.now());

export default {
  id: 'r33_active_llm_call_no_jinja_500',
  description: 'R33 active state + LLM call: broker reply 不含 Qwen Jinja 500 fallback signature (Bug-Z24 reintroduce 防御)',
  domain: 'broker',
  tags: ['regression', 'r33', 'bug-z24', 'critical'],
  steps: [
    // Turn 1: 触发 SELL state (set R33 _pendingFields lock active for direction='sell')
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      // T-J2-2026-05-10 SC4 (triage T3): qty 5→200 KAS — 跟 production T2.10b minPracticalQty=100 align。
      // Test 本意 R33 jinja 500 防御 (Bug-Z24 reintroduce check)，qty 数字非 sacred。
      message: '我要卖 200 KAS, BSC 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
      expect: {
        must: {
          reply_contains_one_of: ['卖', 'sell', 'SELL', '订单', '画像', '收到', '收 USDT'],
          reply_does_not_contain: ['LLM 卡了一下', 'Jinja Exception'],
        },
      },
    },
    {
      action: 'sleep',
      ms: 1500,
    },
    // Turn 2: R33 state lock active, send unstructured message triggering LLM call
    // (avoid PRICE_QUERY / CONFIRM_WORDS deterministic patterns to ensure LLM path)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '请问可以分批付款吗',
      expect: {
        must: {
          // critical: broker reply NOT contain LLM fallback signature
          // (if R33 reintroduce 双 system msg → Qwen Jinja 500 → broker-llm-agent L833 fallback)
          reply_does_not_contain: [
            'LLM 卡了一下',
            '抱歉, 我这边 LLM',
            'Jinja Exception',
            'System message must be at the beginning',
          ],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
