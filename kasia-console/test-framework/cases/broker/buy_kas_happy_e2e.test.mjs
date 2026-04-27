// Happy-path E2E: BUY 1 KAS via BSC, watch full chain to completion.
// Uses J1's e2e-v2-no-hash pattern via test-framework actions.
// 真链跑, 需要 Sophie 钱包有 USDT, broker 钱包有 KAS 库存.
//
// NOTE: this case STARTS the flow via /api/agent/reply but real chain progression
// requires that send_message goes through Kasia DM (not /api/agent/reply, which is
// synchronous-only). Future enhancement: add 'kasia_send' action that posts via real
// relay. For now, mark this case as 'real_chain' tag and run only manually.

import { relayAddr, relayId } from '../../lib/peers.mjs';

export default {
  id: 'buy_kas_happy_e2e',
  description: 'BUY 1 KAS via BSC end-to-end (preview → YES → pay → KAS received)',
  domain: 'broker',
  tags: ['real_chain', 'happy_path', 'e2e'],
  // Skip in batch runs by default — manual trigger only via --case=
  skip_in_batch: true,
  steps: [
    {
      action: 'send_message',
      from_peer: 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp', // Sophie
      to_relay_id: relayId('trader-b'),
      message: '买 1 KAS',
      expect: {
        must: {
          // Fast path BUY_REGEX should hit, returns deterministic NLG asking chain
          reply_contains_one_of: ['哪个链', '哪条链', 'which chain'],
        },
        should: {
          reply_response_time_ms_max: 5_000,  // deterministic should be < 5s
        },
      },
    },
    {
      action: 'wait_for_offer_status',
      maker: relayAddr('trader-b'),
      status: 'open',
      timeout_ms: 30_000,
      expect: {
        must: { found: true },
      },
    },
    // Manual gate: real e2e completion requires user to confirm + pay,
    // which test framework can't do alone. Mark as info-only assertion.
    {
      action: 'wait_for_offer_status',
      maker: relayAddr('trader-b'),
      status: 'completed',
      timeout_ms: 300_000,  // 5 min — generous for real chain
      expect: {
        should: { found: true },  // soft — user may not actually complete
      },
    },
  ],
};
