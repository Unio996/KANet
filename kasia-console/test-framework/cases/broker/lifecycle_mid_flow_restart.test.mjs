// Lifecycle P1: 中途 '重新下单' → state reset, fresh declaration accept
// J1 probes.mjs lifecycle-mid-flow-restart (severity should)
//
// flow: '买 5 KAS, BSC' → preview → '不要了 重新下单 卖 3 KAS, BSC, 0x9405...' → broker 真 reset
// expected: last reply 含 '卖' direction, qty 3 (不是 buy 5)
//
// 真根因: '不要了' 真**真 CANCEL_WORDS regex (broker-buy-handler line 967), broker resetConvoState ✓.
// 真**真**真**真**真**真 user 同消息 含 reset trigger + new declaration, broker 真**真**真 reset 真**真**真**真 fresh fields 真**真**真**真**真**真**真**真**真**真.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('lifecycle-restart-' + Date.now());
const ADDR = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

export default {
  id: 'lifecycle_mid_flow_restart',
  description: 'P1 lifecycle: 中途 重新下单 → state reset + fresh accept',
  domain: 'broker',
  tags: ['regression', 'p1', 'lifecycle'],
  steps: [
    // T1: BUY 5 KAS → broker preview path
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '买 5 KAS, BSC',
    },
    // T2: 一条消息混 cancel + new SELL declaration
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `不要了 重新下单 卖 3 KAS, BSC, ${ADDR}`,
      expect: {
        must: {
          // 不能保留旧 BUY 5 信号
          reply_does_not_contain: ['买 5 KAS', '5 KAS', '方向: 买', 'buy 5'],
          // 应该出 SELL 3 preview OR ack reset
          reply_contains_one_of: ['卖 3', '3 KAS', '已取消', 'reset'],
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
