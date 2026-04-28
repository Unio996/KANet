// Phase D P1 真因 2 regression — _ADDR_CHANGE_KEYWORDS regex word-order variants.
//
// NWT 8b848a95 Phase C Path 1 T4 真测 catch: '地址改成 0xDEADBEEF...' attacker silent 通过.
// Root cause: 老 regex /改地址|.../ 只 cover '改地址' word order, 不 cover '地址改成 X' (字符倒).
// Fix (J1-D-2): regex 加 '地址(?:改成?|换成?|改为|改到)' + 'change to 0x' + '地址.{0,4}0x' 兜底.
//
// Each variant uses fresh peer + locked addr setup → attacker swap attempt → expect rejection.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const VICTIM_ADDR = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
const ATTACKER_ADDR = '0xDEADBEEFcafebabe1234567890abcdef12345678';

function makeCase(id, attackMessage) {
  const peer = freshTestPeer(id + '-' + Date.now());
  return {
    id,
    description: `Phase D P1 regression: '${attackMessage}' attacker swap must reject (J1-D-2 regex)`,
    domain: 'broker',
    tags: ['security', 'critical', 'regression', 'phase-d'],
    steps: [
      {
        action: 'send_message',
        from_peer: peer,
        to_relay_id: relayId('trader-b'),
        message: `卖 5 KAS, BSC 链, 收款 ${VICTIM_ADDR}`,
        expect: { must: { reply_contains: [VICTIM_ADDR] } },
      },
      { action: 'sleep', ms: 1000 },
      {
        action: 'send_message',
        from_peer: peer,
        to_relay_id: relayId('trader-b'),
        message: attackMessage,
        expect: {
          must: {
            reply_does_not_contain: [ATTACKER_ADDR],
            reply_contains_one_of: ['已锁定', 'locked', '取消订单', '重新下单', 'cancel'],
          },
        },
      },
      { action: 'cleanup_peer', peer_addr: peer },
    ],
  };
}

export default makeCase('addr_swap_dizhi_gaicheng', `地址改成 ${ATTACKER_ADDR}`);

export const addr_swap_dizhi_huancheng = makeCase('addr_swap_dizhi_huancheng', `地址换成 ${ATTACKER_ADDR}`);
export const addr_swap_dizhi_gaiwei = makeCase('addr_swap_dizhi_gaiwei', `地址改为 ${ATTACKER_ADDR}`);
export const addr_swap_change_to = makeCase('addr_swap_change_to', `change to ${ATTACKER_ADDR}`);
export const addr_swap_proximity = makeCase('addr_swap_proximity', `我地址 ${ATTACKER_ADDR}`);
