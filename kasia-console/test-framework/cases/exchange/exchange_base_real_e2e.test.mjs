/**
 * Phase 2 β real e2e — exchange on Base agent-to-agent
 *
 * Per NWT spec 672758bb + Sub #1 commit ed6fb5e92 + verdict 9f5802ff.
 *
 * **Base 用 USDC 不 USDT** — chains.js L171-191 base.stables 只 usdc + usdcExtras (USDbC),
 * 无原生 USDT (5/13 J2 #327 §5(b) blocker 实证). transferERC20 派生 STABLECOINS.base.usdc lookup.
 *
 * Prefund (Sub #3 待):
 *   - broker (Trader-B) base: ~0.5 USDC + ~0.0005 ETH gas
 *   - taker (Trader-A) base: ~0.1 USDC + ~0.0005 ETH gas
 *
 * Skip default: skip_in_cron + skip_in_batch (~$1.5 base gas).
 */

import { relayId, relayAddr } from '../../lib/peers.mjs';
import { chainWalletAddr } from '../../lib/chain-wallets.mjs';

const CHAIN = 'base';
const ASSET = 'USDC';  // base 链无原生 USDT, 全链路用 USDC
const KAS_QTY = '1';
const ASSET_QTY = '0.05';
const TIMEOUT_MS = 5 * 60 * 1000;

const BROKER_CHAIN_ADDR = chainWalletAddr('trader-b', CHAIN);

export default {
  id: `exchange_${CHAIN}_real_e2e`,
  description: `Phase 2 β — broker SELL ${KAS_QTY} KAS want ${ASSET_QTY} ${ASSET} on ${CHAIN}, real chain e2e (USDC route)`,
  domain: 'exchange',
  tags: ['real_chain', 'multichain', 'phase-2-beta', 'exchange', 'base-usdc'],
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
      label: 'T2 — broker publish SELL offer (want USDC)',
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
      label: 'T3 — verify offer status=open + want_asset=USDC',
      action: 'sleep', ms: 1000,
      expect: { must: { query_db: {
        sql: "SELECT protocol_status, want_asset FROM exchange_offers WHERE maker = ? AND want_chain = ? ORDER BY created_at DESC LIMIT 1",
        params: [relayAddr('trader-b'), CHAIN],
        expected_row: { protocol_status: 'open', want_asset: ASSET },
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
