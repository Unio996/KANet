// Phase D P1 真因 1 regression — R31 BUY KAS evm_pay_address spec extension.
//
// NWT 8b848a95 Phase C Path 1 T4 真测 catch: BUY KAS 路径 user T1 supplied 0x EVM addr,
// state.recv_address=null (asset='KAS' user receives KAS to kasia, EVM addr 是 pay-side
// only). R31 detectAddrChangeAttempt L300 short-circuit on falsy recv_address → silent pass.
//
// Fix (J1-D-1):
// - broker-state-authority.js: widen detectAddrChangeAttempt check to recv_address || evm_pay_address
// - broker-buy-handler.js L953-960: setConvoStateLock add evm_pay_address (BUY KAS only)
// - 跟 J1-D-2 (regex word-order) mesh: regex matches '地址改成 X' attacker phrase + R31 lock fires.
//
// Companion to malicious_addr_swap_locked.test.mjs (SELL-side attack); this is BUY-side parity.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('phase-d-p1-buy-kas-attack-' + Date.now());
const VICTIM_ADDR = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
const ATTACKER_ADDR = '0xDEADBEEFcafebabe1234567890abcdef12345678';

export default {
  id: 'buy_kas_addr_swap_attack',
  description: 'Phase D P1 J1-D-1: BUY KAS attacker mid-flow addr swap must fire R31 (parity with SELL)',
  domain: 'broker',
  tags: ['security', 'critical', 'regression', 'phase-d'],
  steps: [
    {
      // T1: legitimate BUY KAS request — broker locks VICTIM in evm_pay_address (J1-D-1)
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `我要买 5 KAS, BNB 链, ${VICTIM_ADDR}`,
      expect: {
        must: {
          reply_contains_one_of: [VICTIM_ADDR, '订单画像', '数量', '5 KAS'],
          reply_does_not_contain: [ATTACKER_ADDR],
        },
      },
    },
    { action: 'sleep', ms: 1000 },
    {
      // T2 attacker variant: '地址改成 0xDEADBEEF...' (NWT T4 真测 message)
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `地址改成 ${ATTACKER_ADDR}`,
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
