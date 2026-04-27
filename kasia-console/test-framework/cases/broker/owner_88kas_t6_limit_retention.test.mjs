// Owner T6 follow-up: 杂糅 addr+限价 0.0336+10min retention — broker 必须 capture/反映 OR 明确拒绝
// NWT 22:08 audit GAP B: 现 broker 静默丢弃 user 限价 + 10min refund timeout (用 default 市价 + 2h),
// 这是 Owner B3 真诉求另外一半. R33 修透了跨方向 (B3a), 没碰条件 retention (B3b).
//
// pre-fix expect: FAIL (broker preview 没 user 0.0336 + 没说为啥忽略)
// post product fix expect 3 选 1:
//   (a) preview 含 user limit 0.0336 + retention 2h (broker accept)
//   (b) reply 含 'broker 不接受用户限价, 仅市价' (broker reject 明确)
//   (c) reply 含 'broker 接受限价但 timeout 必 2h+' (broker partial)
// 现状: (d) 静默忽略 = Owner 反馈 'broker 没逻辑没重点'

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('t6-limit-retention-' + Date.now());
const OWNER_ADDR = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

export default {
  id: 'owner_88kas_t6_limit_retention',
  description: 'Owner T6: 杂糅含限价+退款条件 broker 必须 capture 或明确拒绝 (反静默丢弃)',
  domain: 'broker',
  tags: ['ux', 'regression', 'p0', 'owner-trace', 'product-gap', 'follow-up', 'condition-retention'],
  steps: [
    // setup SELL flow — message 含逗号 break SELL_REGEX 让 fall handleLlmDialog (R33 b iter3 sellPreview path)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '卖88个kas, BSC',
    },
    // T6 杂糅
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `${OWNER_ADDR}，我想挂单价格设定0.0336。如果10分钟内没人吃单，麻烦帮我把Kas原路返回。`,
      expect: {
        must: {
          reply_does_not_contain: ['方向: 买', '买 88', '买 50 KAS'],
          // broker 必须正面回应 user 限价/timeout 指令: 接受 OR 拒绝, 不能静默
          // expected one of:
          //   - reply 含 '0.0336' (broker capture limit)
          //   - reply 含 '10' + ('分钟' OR 'min') (broker capture timeout)
          //   - reply 含 '只接受市价' / '不支持限价' / '不接受' (broker reject 明确)
          //   - reply 含 '2h' + 解释 (broker partial: 限价 OK 但 timeout 必须 ≥2h)
          reply_contains_one_of: ['0.0336', '10 分钟', '10分钟', '不支持限价', '只接受市价', '不接受限价', '限价' /* explanation OK */, 'limit price'],
        },
      },
    },
    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
