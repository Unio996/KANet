// Publish-time regression — publish-v2 must REJECT an offer whose stake/fee can never satisfy the
// settle_dispute KIP-9 fee guard, BEFORE locking any escrow funds.
//
// Root cause (maker-invite demo, 5/28 — Bettor r187/r188):
//   PredictionEscrowUnanimous5.sil settle_dispute requires `spendable * oracleFeePct >= 1.25e12`
//   (each of the 5 oracle-fee outputs must clear ~0.25 KAS or kaspad rejects: "script ran, but
//   verification failed"). This guard bit at SETTLE time twice (Bug 14 + the maker-invite demo),
//   AFTER escrow was locked — i.e. funds locked into an offer that could never dispute-settle.
//
// 治本 (Bettor r188): publish-v2 守 6 pre-validates the same inequality at publish time and rejects
//   too-small offers up front (= 花钱代码验证所有路径). This regression locks that behavior in.
//
// Boundary (size_kas=1, price=0.5, spendable ≈ 6.25e9):
//   oracle_fee_pct=100 → spendable×100 = 6.25e11 < 1.25e12  → MUST reject (per-oracle 0.125 KAS < 0.25)
//   oracle_fee_pct=300 → spendable×300 = 1.875e12 ≥ 1.25e12 → accepted (per-oracle 0.375 KAS)
//
// status: real-chain integration — needs alive maker/broker/5-oracle relays + pending-offer fixture
// (same shared setup as sibling ss-sub4 mutation cases). skip_in_batch until that fixture lands.

export default {
  id: 'publish_rejects_small_stake_fee_guard',
  description: 'publish-v2 守 6: small-stake offer (spendable×oracleFeePct < 1.25e12) rejected at publish time, before escrow lock',
  domain: 'predictions',
  tags: ['regression', 'ss_sub4', 'publish_v2', 'fee_guard', 'kip9', 'money_safety', 'bettor_r188'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'fixture: maker/broker + 5 alive is_oracle=1 relays; maker funded for a small stake' },
    { action: 'todo', note: 'POST /api/prediction/pending-offer (size_kas=1, price=0.5) → pending_offer_id' },
    { action: 'todo', note: 'POST /api/prediction/taker-handshake/:id (taker addr) → taker_pubkey' },
    { action: 'todo', note: 'POST /api/prediction/publish-v2 with oracle_fee_pct=100 (small stake → spendable×100 = 6.25e11 < 1.25e12)' },
    { action: 'todo', note: 'EXPECT http 400, error contains "stake too small for oracle dispute settle" + settle_fee_guard=1250000000000' },
    { action: 'todo', note: 'NEGATIVE control: same offer with oracle_fee_pct=300 → http 200 (spendable×300 = 1.875e12 ≥ guard), escrow locks + settles' },
    { action: 'todo', note: 'CRITICAL invariant: on the rejected (100) case, assert NO escrow lock TX was broadcast (= reject precedes any on-chain spend)' },
    { action: 'todo', note: 'ASYMMETRIC edge (Bettor r190): guard uses stakeKasSompi*2, valid only while protocol enforces maker==taker. v0 publish-v2 hardcodes takerStakeAmount==makerStakeAmount + taker-stake transfers the EXACT baked taker_stake_sompi, so asymmetric is currently IMPOSSIBLE to produce. IF asymmetric stakes are ever added: (a) change 守6 to makerStake+takerStake-minerFee, (b) add a regression here for an asymmetric small offer (e.g. large maker + tiny taker that sums under guard) → must 400 reject.' },
  ],
};
