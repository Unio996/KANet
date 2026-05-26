// SS sub 4 mutation test #3 — settle_consensual outputs[1] (broker fee) value tampering
//
// Per J1 #C1 fix sediment + NWT r8 propose:
//   PredictionEscrowUnanimous5.sil settle_consensual 加 explicit outputs[1].value == brokerFeeAmount
//   防 attacker 减少 broker fee 把多余 amount 给 winner OR self
//
// 此 mutation test 验:
//   1. 真链 1V1 escrow create + maker stake + taker stake → P2SH locked
//   2. maker + taker mutual sig 合法 (= winner == 0, outputs[0]=makerAddr+winnerAmount, outputs[1]=brokerAddr+brokerFeeAmount)
//   3. attacker submit mutation TX: outputs[1].value 篡改 (= 减少 broker fee, 多给 outputs[0] winner)
//   4. expect: kaspad reject TX (= SS require outputs[1].value == brokerFeeAmount 严格 equality)
//
// status: DRAFT — 真链 setup 等 J2 sub 5

export default {
  id: 'settle_consensual_broker_fee_tamper',
  description: 'SS sub 4 mutation #3: settle_consensual outputs[1] broker fee 篡改 → kaspad reject',
  domain: 'predictions',
  tags: ['mutation', 'ss_sub4', 'settle_consensual', 'security', 'j1_c1_fix', 'real_chain'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'setup 1V1 escrow (= 同 winner_tamper fixture reuse)' },
    { action: 'todo', note: 'collect maker + taker mutual sig over TX (winner=0, outputs[0]=makerAddr+winnerAmount, outputs[1]=brokerAddr+brokerFeeAmount) → legit consensual TX bytes' },
    { action: 'todo', note: 'mutate: outputs[1].value 减少 brokerFee (= e.g. brokerFee / 2), outputs[0].value 加同样 amount (= 多给 winner)' },
    { action: 'todo', note: 'submit mutated TX → expect kaspad reject (= SS require outputs[1].value == brokerFeeAmount 严格 equality)' },
    { action: 'todo', note: 'verify: kaspad reject + reason script verify failed' },
  ],
};
