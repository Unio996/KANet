// Regression guard: C1 folded-shard chain-anchor downgrade (2026-07-11, docs/2026-07-11-c1-folded-shard-anchor-design.md)
//
// verifyBettorsCompleteFromChain's level2-A per-shard loop must SKIP the individual
// readOutpointCreatedAddr/checkUtxoLanded anchor for shards with status==='settling' (already
// folded into PayoutShard — their leaf-creation tx can genuinely predate both kaspad's pruning
// point and the local kaspa_tx_log indexer's coverage window, confirmed on real 28mln data).
// Folded shards must still contribute to the aggregate (chainCount/chainYes/chainNo/chainPool) and
// remain covered by the existing psConsolidatedPool aggregate anchor. Open/sealed shards must be
// completely unaffected (regression: their per-shard anchor check must still fire and can still BUST).
import assert from 'node:assert/strict';

const { verifyBettorsCompleteFromChain } = await import('file:///D:/kanet/KANet/kasia-console/src/lib/bshard-close-enforce.mjs');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`❌ ${msg}`); } else { console.log(`✅ ${msg}`); } }

const MKT = 'test-c1-folded-anchor';

function shard(overrides) {
  return {
    shard_index: 0, shard_market_id: `${MKT}-s0`,
    shard_redeem_hex: '00', // p2sh() mock below ignores the actual bytes
    current_leaf_outpoint: 'deadbeef'.repeat(8) + ':0',
    current_leaf_state: JSON.stringify({ local_yes: 1000000000, local_no: 500000000, count: 2, pool_value: 1500000000 }),
    bettors: [
      { pk: 'aa'.repeat(16), direction: 0, stake_amount: 1000000000 },
      { pk: 'bb'.repeat(16), direction: 1, stake_amount: 500000000 },
    ],
    ...overrides,
  };
}
const bettors = [
  { pk: 'aa'.repeat(16), direction: 0, stake: 1000000000n },
  { pk: 'bb'.repeat(16), direction: 1, stake: 500000000n },
];

// level2-B (per-ticket) always runs regardless of level2-A outcome (fail-closed if deriveTicketAddr missing,
// per lines 876-884) — every ctx below supplies a working deriveTicketAddr + a checkUtxoLanded that returns
// true for ticket lookups (txid===null) so level2-B stays green and each case isolates level2-A behavior.
const baseTicket = { deriveTicketAddr: () => 'kaspatest:mockticket' };

// ── case 1: folded shard (status='settling') — must PASS without ever calling the per-shard anchor ──
{
  let leafAnchorCalls = 0;
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => { if (txid === null) return true; leafAnchorCalls++; return false; }, // txid!=null=leaf anchor path, would BUST if called
    readOutpointCreatedAddr: async () => { leafAnchorCalls++; return null; },
    shards: [shard({ status: 'settling' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === true, `folded shard skips individual anchor and PASSes aggregate (got: ${JSON.stringify(r)})`);
  check(leafAnchorCalls === 0, `folded shard never calls readOutpointCreatedAddr/checkUtxoLanded for its own leaf (calls=${leafAnchorCalls})`);
}

// ── case 2: folded shard with tampered pool_value — aggregate anchor still catches it ──
{
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => txid === null,
    readOutpointCreatedAddr: async () => null,
    shards: [shard({ status: 'settling' })],
    psConsolidatedPool: '999999999', // deliberately wrong vs Σloaded(1500000000)+seed
    psSeed: '0',
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === false && /PS-pool/.test(r.reason || ''), `folded shard downgrade does NOT bypass the aggregate psConsolidatedPool anchor (got: ${JSON.stringify(r)})`);
}

// ── case 3: open shard (status='open') — regression, per-shard anchor still enforced, still BUSTs on mismatch ──
{
  let leafAnchorCalls = 0;
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => { if (txid === null) return true; leafAnchorCalls++; return false; }, // leaf anchor: simulate not-anchored → must BUST
    shards: [shard({ status: 'open' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === false, `open shard (unfolded) still enforces per-shard anchor and BUSTs when it fails (got: ${JSON.stringify(r)})`);
  check(leafAnchorCalls === 1, `open shard DOES call the leaf anchor check (calls=${leafAnchorCalls}, unlike folded shards)`);
}

// ── case 4: open shard, anchor succeeds — regression baseline, unaffected by this change ──
{
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async () => true,
    shards: [shard({ status: 'open' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === true, `open shard with a landed anchor still PASSes as before (got: ${JSON.stringify(r)})`);
}

console.log(failures === 0 ? `\n✅ ALL PASS (0 failures)` : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
