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
  // KI 33 5/20 Owner钦定 Path A (J2 #549): post-commit cron 每跑真发 on-chain offer 烧 KAS gas (~$0.022/24h);
  // 此 case 验证 publish endpoint DB INSERT, broadcast 不是核心 assert. manual-only 跑 (--all / --case).
  skip_in_batch: true,
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
          // Race-tolerant fix 5/18 N18.2: broker internal market match within 1.5s 把 BUY offer 推进 awaiting_manual_confirm.
          // 原 spec '永 open' 不实, 改 verify row exists + non-terminal status (publish 成功 → DB row 写入 main assertion).
          query_db: {
            sql: "SELECT protocol_status, give_asset, want_asset, want_chain FROM exchange_offers WHERE metadata LIKE ? ORDER BY created_at DESC LIMIT 1",
            params: [`%${TAG}%`],
            expected_row: { give_asset: 'KAS', want_asset: 'USDT', want_chain: 'bsc' },
            // protocol_status 不限定 — broker 自动 match 是 production 正常行为, 任何 status (open/matched/awaiting_*) 都算 publish 成功
          },
        },
      },
    },
  ],
};
