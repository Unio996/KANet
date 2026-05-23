// llm_mock_long_history_forget — Owner 02:30 钦定 "用真人方式测试" + 真 reproduce P0 Bug 1
//
// Owner real test screenshot reply: "系统当前确实无法读取之前的历史对话, 我无法看到您之前提供的地址."
// 真 hypothesis: long history (8+ turn) → Qwen3.6 context window overflow → broker forget state.
//
// scenario:
//   1. inject_history 8 turn (mixed sell/buy/cancel previous trades) into messages 表
//   2. LLM mock user (normal_seller persona) start fresh conversation
//   3. T1 'sell KAS', T2 '50 个', T3 'BSC, 0x1417...'
//   4. assert broker reply 真**不含** '系统当前无法读取' / '上下文丢失' / '请重新提供地址'
//   5. assert retail_dex_orders state row 真 set qty=50 + pay_chain=bnb + pay_address=0x1417...
//
// success: broker 长 history 真**真**真**真**真 forget state, llmSystemPromptStateLock inject 真**真**真**真**真 LLM see state.

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';

const peer = freshTestPeer('long-history-forget-' + Date.now());

// 8 turn mock history (mixed prior trades to 真**真**真 fill context)
const PRIOR_HISTORY = [
  { direction: 'inbound', text: '我想买 5 KAS' },
  { direction: 'outbound', text: '好的, 买 5 KAS. 哪个链 (BSC/Polygon/SOL/TRON)?' },
  { direction: 'inbound', text: 'BSC' },
  { direction: 'outbound', text: '好的, 5 KAS BSC. 你的 USDT 付款地址 (0x...)?' },
  { direction: 'inbound', text: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
  { direction: 'outbound', text: '📋 买单画像: 5 KAS, BSC, 0x9405..., 价 0.034 USDT/KAS, 总 0.17 USDT. YES 确认.' },
  { direction: 'inbound', text: 'cancel' },
  { direction: 'outbound', text: '好的, 已取消. 无活跃订单. 重新下单告诉我.' },
];

export default {
  id: 'llm_mock_long_history_forget',
  description: 'Owner 02:18 real test 复刻: long history (8 turn 历史 trade) → broker forget state? P0 Bug 1 reproduce',
  domain: 'broker',
  tags: ['regression', 'llm-mock-user', 'p0', 'long-history', 'owner-04-29'],
  steps: [
    // 1. inject 8 turn prior history
    {
      action: 'inject_history',
      peer_addr: peer,
      relay_addr: relayAddr('trader-b'),
      messages: PRIOR_HISTORY,
    },
    { action: 'sleep', ms: 1000 },

    // 2. fresh sell intent — broker 真**真**真 should NOT see PRIOR_HISTORY confuse current conversation
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '我想卖 KAS',
      expect: {
        must: {
          // 真**真**真 not LLM hallucinate '上下文丢失'
          reply_does_not_contain: ['系统当前无法读取', '上下文丢失', '会话刷新', '技术故障', '请重新提供'],
        },
      },
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: '50 个',
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'send_message',
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      message: 'BSC, 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
      expect: {
        must: {
          // T3 broker 真**真**真**真**真 forget — assert reply 不含 '系统当前无法读取'
          reply_does_not_contain: ['系统当前无法读取', '上下文丢失', '会话刷新', '技术故障', '请重新提供您的收款地址'],
        },
      },
    },
    { action: 'sleep', ms: 2000 },

    // 3. verify retail_dex_orders state row
    {
      action: 'query_db',
      sql: `SELECT side, qty, pay_chain, pay_address, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
          // long history 真**真**真**真**真**真 P1 Bug 1 表现 — state row qty/chain/addr 真**真 set
          row_field_equals: {
            side: 'sell_kas',
            qty: 50,
            pay_chain: 'bnb',
            pay_address: '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
          },
        },
      },
    },

    { action: 'cleanup_peer', peer_addr: peer },
  ],
};
