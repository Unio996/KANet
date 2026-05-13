/**
 * Phase 2 β real e2e — exchange on BSC (bnb) agent-to-agent
 *
 * Per NWT spec 672758bb (9-chain β v0.1) + Sub #1 commit ed6fb5e92 (dispatcher 9 chain unblock)
 * + verdict 9f5802ff (Sub #2 green-light).
 *
 * 此 file 是 BSC e2e regression — 5/12 J2 #326 manual shell 已 proof (commit 5887a0c3b),
 * Sub #2 framework-runnable 版本守 BSC 路径不退化, Sub #4 真链 run 时复用.
 *
 * Flow (broker SELL KAS want USDT on BSC):
 *   1. cleanup prev test offers (idempotent)
 *   2. chain_snapshot before (broker + taker on bnb)
 *   3. broker publish SELL 1 KAS want 0.05 USDT on bnb, accepted_chains[broker_bnb_addr]
 *   4. assert protocol_status='open'
 *   5. taker accept (auto-fires _autoPayExchange → transferUsdt('bnb', ..., 'USDT'))
 *   6. wait_for_offer_status 'completed' (5 min timeout)
 *   7. chain_snapshot after + chain_events trace (matched + paid + completed)
 *
 * Prefund (Sub #3 待 Owner 钦定):
 *   - broker (Trader-B) bnb: ~0.5 USDT + ~0.001 BNB gas
 *   - taker (Trader-A) bnb: ~0.1 USDT + ~0.001 BNB gas
 *
 * Skip default: skip_in_cron + skip_in_batch (~$1 BSC gas). Manual run:
 *   node scripts/test.mjs --case=test-framework/cases/exchange/exchange_bnb_real_e2e.test.mjs
 */

import { relayId, relayAddr } from '../../lib/peers.mjs';
import { chainWalletAddr } from '../../lib/chain-wallets.mjs';

const CHAIN = 'bnb';
const ASSET = 'USDT';
const KAS_QTY = '1';
const ASSET_QTY = '0.05';
const TIMEOUT_MS = 5 * 60 * 1000;

const BROKER_CHAIN_ADDR = chainWalletAddr('trader-b', CHAIN);

export default {
  id: `exchange_${CHAIN}_real_e2e`,
  description: `Phase 2 β — broker SELL ${KAS_QTY} KAS want ${ASSET_QTY} ${ASSET} on ${CHAIN}, real chain e2e`,
  domain: 'exchange',
  tags: ['real_chain', 'multichain', 'phase-2-beta', 'exchange'],
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
      label: 'T1 — chain_snapshot before',
      action: 'chain_snapshot',
      peers: [relayAddr('trader-b'), relayAddr('trader-a')],
      assets: ['KAS', ASSET],
      evmChains: [CHAIN],
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
      label: 'T6 — chain_snapshot after + chain_events trace',
      action: 'chain_snapshot',
      peers: [relayAddr('trader-b'), relayAddr('trader-a')],
      assets: ['KAS', ASSET],
      evmChains: [CHAIN],
      expect: { must: { query_db: {
        sql: "SELECT event_type FROM chain_events WHERE event_type IN ('exchange_matched','exchange_paid','exchange_completed') AND observed_at > datetime('now','-10 minutes')",
        expected_row_count_min: 3,
      } } },
    },
  ],
};
