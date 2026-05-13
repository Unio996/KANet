/**
 * Phase 2 β real e2e — exchange on Solana agent-to-agent
 *
 * Per NWT spec 672758bb + Sub #1 commit ed6fb5e92 + verdict 9f5802ff.
 *
 * NWT verdict push back §7 (J2 #328): sol/tron settler-router L66-67 'v1.2 留' 限制
 * 只撞 broker 出 native chain asset 路径 (broker SELL sol/tron USDT want X).
 * β path broker SELL KAS want USDT on sol/tron, _autoSettleAsset 用 settler='kasia' (KAS),
 * 不撞 sol/tron settler. sol/tron 真链 e2e 走 transferSolUsdt SPL transfer + _verifySolana 验.
 *
 * Prefund (Sub #3 待):
 *   - broker (Trader-B) sol: ~0.5 USDT (SPL) + ~0.01 SOL gas (rent + tx fee)
 *   - taker (Trader-A) sol: ~0.1 USDT (SPL) + ~0.005 SOL gas
 *
 * Skip default: skip_in_cron + skip_in_batch (~$0.5 SOL gas).
 *
 * NOTE: chain_snapshot evmChains=[] (chain-oracle SOL/TRON balance lookup 待 Sub #4 加).
 * 验证靠 wait_for_offer_status='completed' + chain_events 3 row.
 */

import { relayId, relayAddr } from '../../lib/peers.mjs';
import { chainWalletAddr } from '../../lib/chain-wallets.mjs';

const CHAIN = 'sol';
const ASSET = 'USDT';
const KAS_QTY = '1';
const ASSET_QTY = '0.05';
const TIMEOUT_MS = 5 * 60 * 1000;

const BROKER_CHAIN_ADDR = chainWalletAddr('trader-b', CHAIN);

export default {
  id: `exchange_${CHAIN}_real_e2e`,
  description: `Phase 2 β — broker SELL ${KAS_QTY} KAS want ${ASSET_QTY} ${ASSET} on ${CHAIN} (SPL), real chain e2e`,
  domain: 'exchange',
  tags: ['real_chain', 'multichain', 'phase-2-beta', 'exchange', 'sol'],
  skip_in_cron: true,
  skip_in_batch: true,
  steps: [
    {
      label: 'T0 — cleanup prev test offers',
      action: 'exec_sql',
      sql: "DELETE FROM exchange_offers WHERE maker = ? AND give_asset = 'KAS' AND want_chain = ? AND want_amount = ?",
      params: [relayAddr('trader-b'), CHAIN, ASSET_QTY],
    },
    {
      label: 'T1 — chain_snapshot before (KAS only, SOL native balance Sub #4 待)',
      action: 'chain_snapshot',
      peers: [relayAddr('trader-b'), relayAddr('trader-a')],
      assets: ['KAS'],
      evmChains: [],
    },
    {
      label: 'T2 — broker publish SELL offer',
      action: 'http_post',
      url: '/api/exchange/publish',
      body: {
        relayNodeId: relayId('trader-b'),
        give_asset: 'KAS',
        give_amount: KAS_QTY,
        want_asset: ASSET,
        want_amount: ASSET_QTY,
        want_chain: CHAIN,
        verification: 'cross_chain_tx',
        verification_meta: { accepted_chains: [{ chain: CHAIN, address: BROKER_CHAIN_ADDR }] },
      },
      expect: { must: { http_status_equals: 200, reply_contains: 'offer_id' } },
    },
    {
      label: 'T3 — verify offer status=open',
      action: 'sleep', ms: 1000,
      expect: { must: { query_db: {
        sql: "SELECT protocol_status FROM exchange_offers WHERE maker = ? AND want_chain = ? ORDER BY created_at DESC LIMIT 1",
        params: [relayAddr('trader-b'), CHAIN],
        expected_row: { protocol_status: 'open' },
      } } },
    },
    {
      label: `T4 — Trader-A accept latest open offer on ${CHAIN}`,
      action: 'exchange_accept_latest_offer',
      maker: relayAddr('trader-b'),
      taker_relay_id: relayId('trader-a'),
      selected_chain: CHAIN,
      expect: { must: { http_status_equals: 200 } },
    },
    {
      label: `T5 — wait offer status='completed' (max ${TIMEOUT_MS/1000}s)`,
      action: 'wait_for_offer_status',
      maker: relayAddr('trader-b'),
      status: 'completed',
      timeout_ms: TIMEOUT_MS,
      expect: { must: { query_db: {
        sql: "SELECT protocol_status FROM exchange_offers WHERE maker = ? AND want_chain = ? ORDER BY created_at DESC LIMIT 1",
        params: [relayAddr('trader-b'), CHAIN],
        expected_row: { protocol_status: 'completed' },
      } } },
    },
    {
      label: 'T6 — chain_events trace (matched + paid + completed)',
      action: 'sleep', ms: 100,
      expect: { must: { query_db: {
        sql: "SELECT event_type FROM chain_events WHERE event_type IN ('exchange_matched','exchange_paid','exchange_completed') AND observed_at > datetime('now','-10 minutes')",
        expected_row_count_min: 3,
      } } },
    },
  ],
};
