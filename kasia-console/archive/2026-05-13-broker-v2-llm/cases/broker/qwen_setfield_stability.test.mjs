// qwen_setfield_stability — NWT 2026-04-29 J2-5 Qwen3.6 setField tool 稳定性真测
//
// J2-5 真问题: handleLlmDialog T2 fall LLM Qwen3.6 setField tool 稳定性未实证.
// 真测 5 case × 3 turn 真 invoke handleLlmDialog, 真 verify retail_dex_orders.qty 真**真 set**
// post LLM call (无论 LLM 真 call setField tool 还是 text 引述).
//
// 5 number variant 真 cover 真 user 真**真**真 input variation:
// - '50'      (just digit)
// - '50 个'   (digit + 中文量词)
// - '我要 50' (中文 + digit)
// - '50 KAS'  (digit + asset suffix)  ← 现 J2-4 regex 唯一 cover
// - 'fifty'   (英文 word)            ← LLM-only path
//
// success metric: 5 variant × 1 strict assertion (post T2 query_db retail_dex_orders.qty='50') = 5/5 PASS = 100%
// LLM tool fire OR LLM text + state-merge fallback 都行 — 关键是 retail_dex_orders 真 row.qty='50'.

import { freshTestPeer, relayAddr, relayId } from '../../lib/peers.mjs';

const VARIANTS = ['50', '50 个', '我要 50', '50 KAS', 'fifty'];

function makeCase(variant, idx) {
  const peer = freshTestPeer(`qwen-setfield-stability-${idx}-${Date.now()}`);
  return {
    id: `qwen_setfield_stability_${idx}_${variant.replace(/\s/g, '_')}`,
    description: `J2-5 Qwen3.6 setField tool 真测 variant '${variant}'`,
    domain: 'broker',
    tags: ['regression', 'llm-stability', 'phase-e-v3', 'j2-5'],
    steps: [
      // T1 sell intent — establish state
      {
        action: 'send_message',
        from_peer: peer,
        to_relay_id: relayId('trader-b'),
        message: '我想卖 KAS',
      },
      { action: 'sleep', ms: 2000 },
      // T2 — 真**真 number variant**, 真 verify post setConvoStateLock retail_dex_orders.qty='50'
      {
        action: 'send_message',
        from_peer: peer,
        to_relay_id: relayId('trader-b'),
        message: variant,
      },
      { action: 'sleep', ms: 3000 },
      {
        action: 'query_db',
        sql: `SELECT qty, side FROM retail_dex_orders WHERE user_kasia_address = ? AND state IN ('aligning','confirming') ORDER BY created_at DESC LIMIT 1`,
        params: [peer],
        expect: {
          must: {
            db_row_count: 1,
            // 真 strict: qty 必 '50' (J2-3/4 ship 后 deterministic regex OR Qwen tool 真 set)
            row_field_equals: { qty: '50', side: 'sell_kas' },
          },
        },
      },
      { action: 'cleanup_peer', peer_addr: peer },
    ],
  };
}

// 5 cases — variant 1-5
export default makeCase(VARIANTS[0], 1);
export const variant_50_count = makeCase(VARIANTS[1], 2);
export const variant_chinese_50 = makeCase(VARIANTS[2], 3);
export const variant_50_kas = makeCase(VARIANTS[3], 4);
export const variant_fifty = makeCase(VARIANTS[4], 5);
