// llm_mock_user_normal_seller — Owner 钦定 KANet 测试系统真**真**像真人** 真**真**真 ship
//
// 不 fixed message script. LLM (Qwen3.6) 作 normal_seller persona, 真 dynamic 跟 broker 对话.
// 真**真**真 像真人 — broker reply 后 user reply 真**真 vary** based on persona goal + state.
//
// success: broker 渲染 preview 含 50 KAS / BSC / 0x1417cfDaD... + retail_dex_orders.state 真 advance 'confirming' OR 'awaiting_payment'.

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';
import { runMockDialogue } from '../../lib/llm-mock-user.mjs';

const peer = freshTestPeer('llm-mock-normal-seller-' + Date.now());

export default {
  id: 'llm_mock_user_normal_seller',
  description: 'LLM mock user (Qwen3.6 normal_seller persona) 真**真**真 dynamic dialogue 卖 50 KAS BSC',
  domain: 'broker',
  tags: ['regression', 'llm-mock-user', 'phase-f', 'owner-04-29'],
  steps: [
    {
      action: 'llm_mock_dialogue',
      personaKey: 'normal_seller',
      peer_addr: peer,
      broker_relay_id: relayId('trader-b'),
      max_turns: 8,
      stop_on_broker_contains: ['卖单画像', 'preview', '订单已确认'],  // broker 渲 preview 真停
    },
    { action: 'sleep', ms: 2000 },
    {
      action: 'query_db',
      sql: `SELECT side, qty, pay_chain, pay_address, state FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
      params: [peer],
      expect: {
        must: {
          db_row_count: 1,
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
