// Demo case: cn_newbie persona buys 5 KAS happy path.
// 跑通 persona_turn action — runner 拿 persona module, 多轮自动 react broker reply.
// 这个 case 只到 broker finalize (DM Kaspa 收款地址), 不真转 KAS (留给真链 e2e case).

import { relayId } from '../../lib/peers.mjs';
import { freshTestPeer } from '../../lib/peers.mjs';
import cnNewbie from '../../personas/cn_newbie.mjs';

const peer = freshTestPeer('cn_newbie_buy_' + Date.now());

export default {
  id: 'persona_cn_newbie_buy_5_kas',
  description: 'cn_newbie persona buys 5 KAS happy path — exercises persona_turn action multi-turn',
  domain: 'broker',
  steps: [
    // turn 1: '我想买 5 KAS' → broker 反问 chain
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          reply_does_not_contain: ['卖', '订单争议中'],  // 不能 hallucinate sell, 不能 R21 vague error
        },
      },
    },
    // turn 2: 'BSC' → broker 出 preview (or 反问 address — KAS 买不需要)
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        should: {
          reply_response_time_ms_max: 30_000,
        },
      },
    },
    // turn 3: 'maker 是谁?' (谨慎追问, 看 broker 解释)
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
    },
    // turn 4: '好' → broker finalize → DM Kaspa 收款地址
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // broker reply 含 broker Kaspa 收款地址 (kaspa:q... 格式) 或 转账指引
          reply_contains_one_of: ['kaspa:q', '请转', 'transfer'],
        },
      },
    },
  ],
};
