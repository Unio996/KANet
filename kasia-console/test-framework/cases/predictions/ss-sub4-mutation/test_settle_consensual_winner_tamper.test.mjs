// SS sub 4 mutation test #1 — settle_consensual winner tampering attack
//
// Per Oracle v0.3 R5 第三方独立审 J1 #2 catch #C1:
//   NWT r6 propose settle_consensual(makerSig, takerSig, int winner) 原 0 explicit outputs verify
//   → 攻击向量: 一方拿对方 sig 后篡改 winner 自利提走全部
//   NWT r8 fix propose + r16 真 SS file edit:
//     PredictionEscrowUnanimous5.sil settle_consensual 加 explicit outputs[0] scriptPubKey == makerLock if winner==0 else takerLock
//
// 此 mutation test 验:
//   1. 真链 1V1 escrow create + maker stake + taker stake → P2SH locked
//   2. maker + taker mutual sig 合法 (= winner == 0, outputs[0] = makerAddr)
//   3. attacker submit mutation TX: winner 参数 篡改 == 1 (= 说 winner 是 taker 但 outputs[0] 仍是 makerLock)
//   4. expect: kaspad reject TX (= SS require outputs[0].scriptPubKey == takerLock if winner==1 但 outputs[0] = makerLock mismatch)
//
// status: DRAFT — 真链 setup 等 J2 sub 3 voter v2 + sub 5 backend wire 完
// blockers: J2 sub 3 + sub 5 ETA (= 跟 settle_consensual + settle_dispute 接口 align)
// memory: feedback_mutation_test_real_invoke 5/20 — import production silverc module + invoke real exported, 不 inline mirror logic
// memory: feedback_post_fix_real_chain_regression_test_required 5/21 — production-code change 必 add regression test 真链 PASS
// memory: KI-12 silent skip 第 18 次 (NWT r8 自承) — comment-only constraint = silent skip, 必显式 require + test

export default {
  id: 'settle_consensual_winner_tamper',
  description: 'SS sub 4 mutation #1: settle_consensual winner 参数篡改 → kaspad reject (= J1 #C1 fix verify)',
  domain: 'predictions',
  tags: ['mutation', 'ss_sub4', 'settle_consensual', 'security', 'j1_c1_fix', 'real_chain'],
  skip_in_batch: true,  // 真链 ship, manual / opt-in
  steps: [
    // T+0: setup 1V1 escrow with mutation-friendly fixture
    // (= maker + taker + 5 oracle relay ready, stake locked into new SS P2SH)
    // status: DRAFT, 真 steps 等 J2 sub 5 backend wire 完 fill in
    {
      action: 'todo',
      note: 'setup 1V1 escrow: POST /api/prediction/publish-v2 create offer + maker stake + taker stake locked → new SS P2SH (= oracleFeePct 1% baked)',
    },
    {
      action: 'todo',
      note: 'collect maker + taker mutual sig over TX (winner=0, outputs[0]=makerAddr) → legit consensual TX bytes',
    },
    {
      action: 'todo',
      note: 'mutate: substitute winner param 0 → 1 in scriptSig + re-encode TX (= keep outputs[0] = makerLock + sigs unchanged)',
    },
    {
      action: 'todo',
      note: 'submit mutated TX to kaspad via system RPC (= per memory feedback_use_system_rpc, getWorkingRpc) — expect reject "script verify failed"',
    },
    {
      action: 'todo',
      note: 'verify: kaspad response is reject (not accept) + reason contains "script verify failed" OR similar',
    },
  ],
};
