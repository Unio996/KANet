// SS sub 4 mutation test #2 — settle_consensual outputs[0] addr tampering
//
// Per J1 #C1 fix sediment + NWT r8 propose:
//   PredictionEscrowUnanimous5.sil settle_consensual 加 explicit outputs[0] scriptPubKey == makerLock OR takerLock
//   防 attacker 把 outputs[0] 改其他 addr 把 winner amount 走第三方
//
// 此 mutation test 验:
//   1. 真链 1V1 escrow create + maker stake + taker stake → P2SH locked
//   2. maker + taker mutual sig 合法 (= winner == 0)
//   3. attacker submit mutation TX: outputs[0] = 攻击者 addr (= 不 maker 不 taker)
//   4. expect: kaspad reject TX (= SS require outputs[0].scriptPubKey == makerLock if winner==0)
//
// status: DRAFT — 真链 setup 等 J2 sub 5

export default {
  id: 'settle_consensual_outputs_tamper',
  description: 'SS sub 4 mutation #2: settle_consensual outputs[0] addr 篡改 → kaspad reject',
  domain: 'predictions',
  tags: ['mutation', 'ss_sub4', 'settle_consensual', 'security', 'j1_c1_fix', 'real_chain'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'setup 1V1 escrow (= 同 winner_tamper fixture reuse)' },
    { action: 'todo', note: 'collect maker + taker mutual sig over TX (winner=0, outputs[0]=makerAddr) → legit consensual TX bytes' },
    { action: 'todo', note: 'mutate: outputs[0] addr 改第三方 (= attacker addr, 不 maker 不 taker)' },
    { action: 'todo', note: 'submit mutated TX → expect kaspad reject (= SS require outputs[0].scriptPubKey == makerLock if winner==0, attacker addr mismatch)' },
    { action: 'todo', note: 'verify: kaspad reject + reason script verify failed' },
  ],
};
