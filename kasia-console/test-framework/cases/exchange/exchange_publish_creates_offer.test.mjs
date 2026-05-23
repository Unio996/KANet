/**
 * P0.2 §3.1 — POST /api/exchange/publish 创建 offer + DB row inserted with protocol_status=open
 *
 * NWT spec ea519032a v0.2 (6946501d0) §3, J2 ship P0.2 sub #2/9.
 * runner-format default export (per §11 P0.2+ rewrite 钦定), 走 http_post 不绕 broker DM.
 *
 * 跑法: node scripts/test.mjs --case=test-framework/cases/exchange/exchange_publish_creates_offer.test.mjs
 *      OR  node scripts/test.mjs --domain=exchange
 */

import { relayId } from '../../lib/peers.mjs';

const TAG = 'p0.2-publish-' + Date.now();

export default {
  id: 'exchange_publish_creates_offer',
  description: 'POST /api/exchange/publish → exchange_offers row inserted with protocol_status=open',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'regression'],
  steps: [
    {
      action: 'http_post',
      url: '/api/exchange/publish',
      body: {
        relayNodeId: relayId('trader-b'),
        give_asset: 'KAS',
        give_amount: '10',
        give_chain: 'kaspa',
        want_asset: 'USDT',
        want_amount: '0.4',
        want_chain: 'bsc',
        expires_minutes: 10,
        verification: 'manual',
        metadata: { source: 'p0.2-test', tag: TAG },
      },
      timeout_ms: 8000,  // publish 含 broadcast 上链 +0-3s, 加 buffer
      expect: {
        must: {
          http_status_equals: 200,
          // publish handler 返 { offer_id, broadcast_tx, expires_at } — body 含 offer_id 字段
          reply_contains: 'offer_id',
        },
      },
    },
    { action: 'sleep', ms: 1500 },  // DB commit + indexer pickup
    {
      action: 'sleep', ms: 0,
      expect: {
        must: {
          query_db: {
            sql: "SELECT protocol_status, give_asset, want_asset, want_chain FROM exchange_offers WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 1",
            params: [`%${TAG}%`],
            expected_row: { protocol_status: 'open', give_asset: 'KAS', want_asset: 'USDT', want_chain: 'bsc' },
          },
        },
      },
    },
  ],
};
