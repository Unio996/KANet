// Real-chain liar persona — falsely claims paid without real transfer
// Tests broker verifies chain TX (not just user claim)
//
// 接口: async run(persona, opts) → result

import { brokerBuyFlow, dmRoundTrip, sleep } from '../../lib/real-chain-runner.mjs';

export default {
  id: 'liar_real',
  name: '谎报已付者 (real-chain DM)',
  description: 'Claims paid without real BSC transfer — broker must reject via chain verification',

  async run(persona, opts) {
    const { relayId, userKasia, brokerKasia, userEvmAddr, qty = 1 } = opts;
    const start = new Date().toISOString();
    console.log(`[${persona.id}] start liar flow qty=${qty}`);

    // Step 1: get quote
    const flow = await brokerBuyFlow(relayId, userKasia, brokerKasia, { qty, chain: 'BSC', userEvmAddr });
    if (!flow.ok) return { stage: 'dm_flow_fail', error: flow.error };

    // Step 2: DON'T transfer USDT, instead claim already paid
    console.log(`[${persona.id}] quote captured, lying — NOT paying, claiming "已付"`);
    await sleep(10000);
    const { reply: lie } = await dmRoundTrip(relayId, userKasia, brokerKasia, '我已经付了');
    if (!lie) return { stage: 'lie_dm_timeout' };
    console.log(`[${persona.id}] broker reply: ${lie.content_text.slice(0, 120)}`);

    // Expect broker NOT to confirm receipt (because no real TX)
    const broker_correctly_rejects = !/已收到|received/.test(lie.content_text);

    // Wait for broker auto-refund (30 min escrow expiry)
    // For test purposes, just verify broker doesn't fake-confirm
    const Database = (await import('better-sqlite3')).default;
    const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
    const escrow = db.prepare(`
      SELECT id, status, amount_received FROM user_escrow_balances
      WHERE user_kasia_addr=? AND amount_quoted=? AND created_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(userKasia, flow.quote.amount, start);
    db.close();

    return {
      stage: 'lie_completed',
      quote: flow.quote,
      broker_rejects_lie: broker_correctly_rejects,
      escrow_status: escrow?.status,
      escrow_amount_received: escrow?.amount_received,
      verdict: broker_correctly_rejects && (!escrow?.amount_received || escrow.amount_received === '0') ? 'SECURE' : 'EXPLOIT',
    };
  },
};
