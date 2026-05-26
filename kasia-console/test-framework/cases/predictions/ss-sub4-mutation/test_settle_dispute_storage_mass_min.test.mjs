// SS sub 4 mutation test #4 — settle_dispute Layer 2 SS storage mass minimum boundary
//
// Per Oracle v0.3 R8 implicit catch J1 #10 + #12 + NWT r12 + r13 dynamic formula + r16 真 SS file edit:
//   PredictionEscrowUnanimous5.sil settle_dispute Layer 2 SS defense-in-depth:
//     require(spendable * oracleFeePct >= 1_250_000_000_000)
//     = 12500 KAS × 10^8 sompi unit, 等价 (spendable × oracleFeePct / 10000 / 5) >= 0.25 KAS per oracle output
//
// 此 mutation test 验 boundary:
//   1. case A: spendable = 125 KAS + oracleFeePct = 100 (1%) → 125 × 10^8 × 100 = 1.25 × 10^12 ✓ AT BOUNDARY (= require pass)
//   2. case B: spendable = 124 KAS + oracleFeePct = 100 → 1.24 × 10^12 < 1.25 × 10^12 ✗ require fail → kaspad reject
//   3. case C: spendable = 30 KAS + oracleFeePct = 500 (5%) → 30 × 10^8 × 500 = 1.5 × 10^12 ✓ require pass
//   4. case D: spendable = 20 KAS + oracleFeePct = 500 → 20 × 10^8 × 500 = 10^12 < 1.25 × 10^12 ✗ require fail
//
// Layer 1 console-side create-time reject (= pool.js + offer.js) 该 reject case B + D create, 但 Layer 2 SS defense-in-depth 防 console check 漏
//
// status: DRAFT — 真链 setup 等 J2 sub 5

export default {
  id: 'settle_dispute_storage_mass_min',
  description: 'SS sub 4 mutation #4: settle_dispute Layer 2 storage mass dynamic minimum-spendable boundary verify',
  domain: 'predictions',
  tags: ['mutation', 'ss_sub4', 'settle_dispute', 'storage_mass', 'j1_c10_c12_fix', 'real_chain'],
  skip_in_batch: true,
  steps: [
    {
      action: 'todo',
      note: 'case A (PASS boundary): spendable=125 KAS + oracleFeePct=100 → 1.25e12 AT BOUNDARY, kaspad accept',
    },
    {
      action: 'todo',
      note: 'case B (FAIL below): spendable=124 KAS + oracleFeePct=100 → 1.24e12 < 1.25e12, kaspad reject script verify',
    },
    {
      action: 'todo',
      note: 'case C (PASS above): spendable=30 KAS + oracleFeePct=500 → 1.5e12, kaspad accept',
    },
    {
      action: 'todo',
      note: 'case D (FAIL below): spendable=20 KAS + oracleFeePct=500 → 1e12 < 1.25e12, kaspad reject',
    },
    {
      action: 'todo',
      note: 'Layer 1 console enforcement parallel verify: case B + D create 之前 reject (= pool.js + offer.js 双层 enforce)',
    },
  ],
};
