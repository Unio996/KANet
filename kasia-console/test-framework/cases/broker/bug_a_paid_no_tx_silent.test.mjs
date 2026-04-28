// Bug-A regression: 用户说 '已付！' 无 tx hash → broker 严禁 silent (Owner 12:18 真测撞)
// Pre-fix: SYSTEM_PROMPT rule 3 太短 + PAID_NO_TX_REGEX path sync return ''
//   → '已付！' 没 deterministic 截胡 sync 可观测, LLM 不调 verify_payment, broker 静默
// Post-fix (双保险):
//   - Layer 1 (deterministic, J2 T-J2-26 + Gap 2 83517f28): PAID_NO_TX_REGEX in handleBuyIntent
//     sync return + _qDm async 双发 (cancel parity)
//   - Layer 2 (prompt, NWT d31f4025): SYSTEM_PROMPT rule 3 扩 + 加 rule 5
//
// Test 用 seed_pending_accept 跳过 BUY happy path (Relay/LLM 不稳时仍 deterministic 触发).

import { relayId, freshTestPeer } from '../../lib/peers.mjs';

const peer = freshTestPeer('bug-a-' + Date.now());

export default {
  id: 'bug_a_paid_no_tx_silent',
  description: 'Bug-A: 用户 "已付！" 无 tx hash, broker 必回 (反查 / 求 tx hash), 严禁静默',
  domain: 'broker',
  tags: ['regression', 'bug-a', 'production'],
  steps: [
    // seed _pendingAccepts 模拟用户已 confirm BUY 等付款 (无 paid_tx)
    {
      action: 'seed_pending_accept',
      peer,
      data: {
        offer_id: 'test-buga-' + Date.now(),
        total_kas: 5,
        total_usdt: 0.17,
        pay_chain: 'bnb',
        give_asset: 'KAS',
        picks: [
          { qty_kas: 5, pay_usdt: 0.17, maker_payment_address: '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe' },
        ],
      },
    },
    // 用户 '已付！' 无 tx hash — broker 必 PAID_NO_TX_REGEX 截胡 (Owner 12:18 真撞 path)
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '已付！',
      expect: {
        must: {
          reply_does_not_contain: ['抱歉, 我这边 LLM'],
          reply_contains_one_of: ['BSC tx hash', 'tx hash', '反查', '近 75', 'verify', 'USDT 入账', '链上'],
        },
      },
    },
    { action: 'cleanup_peer_broker_state', peers: [peer] },
  ],
};
