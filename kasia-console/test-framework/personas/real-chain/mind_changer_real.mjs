// Real-chain mind_changer — mid-flow direction change (BUY → SELL → cancel)
// Tests broker state machine resilience to user behavior change mid-flow
//
// 接口: async run(persona, opts) → result
//   opts: { relayId, userKasia, brokerKasia, userEvmAddr, finalQty }

import { dmRoundTrip, sleep, getChainEvents } from '../../lib/real-chain-runner.mjs';

export default {
  id: 'mind_changer_real',
  name: '改主意用户 (real-chain DM)',
  description: 'Mid-flow direction change (BUY start → SELL switch → cancel) — verify broker state machine clean reset',

  async run(persona, opts) {
    const { relayId, userKasia, brokerKasia, userEvmAddr, finalQty = 1 } = opts;
    const start = new Date().toISOString();
    console.log(`[${persona.id}] start mind-changing flow`);

    // Phase 1: start BUY flow
    await dmRoundTrip(relayId, userKasia, brokerKasia, 'back');
    await sleep(2500);
    let { reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, '1');  // BUY
    if (!reply) return { stage: 'phase1_buy_timeout' };
    await sleep(2500);
    ({ reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, '1'));  // BSC
    if (!reply) return { stage: 'phase1_chain_timeout' };
    await sleep(2500);

    // Phase 2: change mind — back to menu + switch to SELL
    console.log(`[${persona.id}] mid-flow: BUY → reset → SELL`);
    await dmRoundTrip(relayId, userKasia, brokerKasia, 'back');
    await sleep(3000);
    ({ reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, '2'));  // SELL
    if (!reply || !/卖|SELL|sell/.test(reply.content_text)) {
      return { stage: 'phase2_sell_switch_fail', reply: reply?.content_text?.slice(0, 100) };
    }
    await sleep(2500);

    // Phase 3: change mind again — cancel
    console.log(`[${persona.id}] mid-flow: SELL → back`);
    ({ reply } = await dmRoundTrip(relayId, userKasia, brokerKasia, 'back'));
    if (!reply || !/Trader-B|broker|菜单/.test(reply.content_text)) {
      return { stage: 'phase3_back_fail', reply: reply?.content_text?.slice(0, 100) };
    }

    // Verify no orphan escrow created
    const Database = (await import('better-sqlite3')).default;
    const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
    const orphan = db.prepare(`SELECT COUNT(*) c FROM user_escrow_balances WHERE user_kasia_addr=? AND created_at > ? AND status NOT IN ('refunded','settled')`).get(userKasia, start);
    db.close();

    return {
      stage: 'completed',
      phases_passed: 3,
      orphan_escrows: orphan.c,
      verdict: orphan.c === 0 ? 'CLEAN' : 'LEAK',
    };
  },
};
