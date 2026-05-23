// UX P1-5 regression: broker 必自豪讲非托管 (Owner 钦定最大卖点)
// Pre-fix: SELL Turn 3 用户问 '钱去哪? 你跑了怎么办?' → broker 复读 preview
// Post-fix: SYSTEM_PROMPT 加信任问答规则 → broker 答 'USDT 直付 maker, 我不碰你的钱...'

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('ux-p15-' + Date.now());

export default {
  id: 'ux_p15_non_custodial_explanation',
  description: 'P1-5: 用户问钱安全 broker 必自豪讲非托管 (KANet 最大差异化)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p1', 'narrative'],
  steps: [
    // Setup: 先建一个 BUY preview state (让 broker 在 _pendingFields 状态)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '想买 5 KAS, BSC',
    },
    { action: 'sleep', ms: 1000 },
    // Probe: 用户问钱安全
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我转 USDT 给 maker, 你跑了怎么办? 钱去哪了?',
      expect: {
        must: {
          // 不能复读 preview
          reply_does_not_contain: ['📋 **订单画像 (确认前)**'],
          // 必须含非托管核心关键词
          reply_contains_one_of: ['不托管', '不持币', '不碰', '直接付', '直付 maker', '不经过我'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
