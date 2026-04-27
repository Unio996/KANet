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
    // turn 4: '好' → broker finalize. broker handleBuyIntent confirm path 走 async _qDm DM queue,
    // sync /api/agent/reply 真返 '' (handle by queue), 不直接含付款指引. 真 broker 真 finalize evidence
    // 真**真链上 DM** (broker → peer outbound msg 含 maker payment 0x addr) — 查 messages 表 verify.
    {
      action: 'persona_turn',
      persona: cnNewbie,
      from_peer: peer,
      to_relay_id: relayId('trader-b'),
      expect: {
        must: {
          // sync return '' 真**正常** (broker async DM via queue)
          // 真 broker 没回错误 (e.g. '订单失败' / 'R19 拦截')
          reply_does_not_contain: ['订单失败', 'R19 拦截', '抱歉', 'error'],
        },
      },
    },
    // Wait for broker async DM (queue → chain → ingestor → messages 表)
    {
      action: 'sleep',
      ms: 8000,  // broker queue pump ~5s + chain DM ingestion ~3s
    },
    // Verify broker 真 finalize 真发了 outbound DM 含付款 EVM addr (真 maker_payment_address 真 0x...)
    {
      action: 'query_db',
      sql: `
        SELECT m.content_text, m.created_at
        FROM messages m
        LEFT JOIN identities si ON si.id = m.sender_identity_id
        LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
        WHERE si.address = ?
          AND ri.address = ?
          AND m.direction = 'outbound'
          AND m.created_at > datetime('now', '-30 seconds')
          AND m.content_text LIKE '%0x%'
        ORDER BY m.created_at DESC LIMIT 1
      `,
      params: [
        'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l',  // trader-b
        peer,
      ],
      expect: {
        must: {
          // broker 真**真**发了 outbound DM 含 maker EVM addr → 真 broker 真 finalize 真 success
          db_row_count: 1,
        },
      },
    },
  ],
};
