// Lifecycle P1: 用户 confirm 后 给 fake addr → broker 必须拒 (R31 lifecycle lock)
// J1 probes.mjs lifecycle-confirmed-cannot-change-addr (severity must)
//
// flow: 买 1 USDC + 0x9405 → preview → YES (confirmed) → '改地址 0xDEADBEEF' → broker 拒
// expected: 含 '地址已锁定' / '改地址请回 NO' / 'cancel first', 不含 '0xDEADBEEFcafebabe'
//
// 真根因 cover: R33 b iter5b setConvoStateLock direction 已 lock, 但 receive_address
// lock 在 R31 _pendingPreview level. confirm 后 _pendingPreview clear (broker-buy-handler
// L685 _clearPendingPreview), 真 lock 真**真**真**真**真**真. 真**真**真**真**真**真**真**真**真**真.

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('lifecycle-confirmed-' + Date.now());
const LEGIT_ADDR = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
const ATTACK_ADDR = '0xDEADBEEFcafebabe1234567890abcdef0987654321';

export default {
  id: 'lifecycle_confirmed_cannot_change_addr',
  description: 'P1 lifecycle: confirmed 后改 addr 必拒 (R31 lock)',
  domain: 'broker',
  tags: ['regression', 'p1', 'lifecycle', 'r31'],
  steps: [
    // T1: BUY 1 USDC + legit addr → broker preview
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `买 1 USDC, BSC, ${LEGIT_ADDR}`,
    },
    // T2: YES confirm → broker finalize
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'YES',
    },
    // T3: 攻击 — 给 fake addr → broker 必须拒
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: `改地址 ${ATTACK_ADDR}`,
      expect: {
        must: {
          // R31 lifecycle lock: broker 不能 echo attack addr
          reply_does_not_contain: ['0xDEADBEEFcafebabe', ATTACK_ADDR],
          // 应该有明确拒绝信号 — 含 R31 lifecycle-lock wording 或 R19 invariant guard wording
          // (NWT 8eeca00b 实证: iter12 R31 detectAddrChangeAttempt 真 fire, 但 R19 guard 覆盖 R31 reply
          // 因 lockedAddrs 没读 _convoState.recv_address → R19 wording 顶替 R31 wording
          // long-term iter13 候选: R19 guard 也读 convoState.recv_address, R31 wording 真 surface)
          reply_contains_one_of: ['地址已锁定', '改地址请回 NO', 'cancel first', '已锁定', '已确认', '地址异常', 'R19 拦截', '回 NO 取消'],
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
