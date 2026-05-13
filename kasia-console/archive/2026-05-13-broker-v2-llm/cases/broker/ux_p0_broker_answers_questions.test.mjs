// UX P0-1 regression: broker 必答用户问题 (J2 f194a3a9d Bug-Z12 fix)
// Pre-fix: 用户在 _pendingPreview 状态问 "maker 是谁?" → broker 复读 preview (致命)
// Post-fix: fresh fields empty → fall LLM → 自然语言回答

import cnNewbie from '../../personas/cn_newbie.mjs';
import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('ux-p01-' + Date.now());

export default {
  id: 'ux_p01_broker_answers_questions',
  description: 'P0-1: broker 在 preview 状态收用户问题必走 LLM 答, 不复读 preview',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0'],
  steps: [
    // T1: 想买 5 KAS
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T2: BSC → preview
    { action: 'persona_turn', persona: cnNewbie, from_peer: peer, to_relay_id: relayId('trader-b') },
    // T3: 问 'maker 是谁?' — 必走 LLM, 不复读 preview
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // 不能完整复读 preview (核心字符串检查)
          reply_does_not_contain: ['📋 **订单画像 (确认前)**'],
        },
        should: {
          // 应该用 LLM 自然话回答 maker 概念
          reply_contains_one_of: ['maker', 'Maker', '做市', '撮合', '帮你', '直接', '提供'],
          reply_response_time_ms_min: 200,  // LLM 路径必慢于 deterministic (>200ms 说明走 LLM)
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
