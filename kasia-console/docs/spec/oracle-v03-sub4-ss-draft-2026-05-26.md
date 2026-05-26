# Oracle v0.3 sub 4 SS 改 — Draft

**Status**: DRAFT — 不 ship 直到 J2 sub 1 schema lock + J2 cross-implementor 反审
**Author**: NWT-tn (sub 4 SS implementor hat)
**Date**: 2026-05-26
**Spec source**: Oracle v0.3 R7 CLOSE (Bettor r26 truly final freeze)
**Catches integrated**: J1 #2 catch #C1 (winner-binding security gap, NWT r8 fix)

---

## Scope

2 SS contracts 改:
1. `D:/kanet-tn12/kasia-console/src/lib/PoolSpine.sil` (= prediction settle)
2. `D:/kanet-tn12/kasia-console/src/lib/PredictionEscrowUnanimous5.sil` (= 1V1 escrow)

3 mutation test ship 同 commit (= 防 KI-12 silent skip 复刻 18+19 sediment):
1. `test_settle_consensual_winner_tamper`
2. `test_settle_consensual_outputs_tamper`
3. `test_settle_consensual_broker_fee_tamper`

---

## 1. PoolSpine.sil 改

### 1.1 ctor 加 oracleFeePct param

现 ctor 11 params (= 末尾 marketMetadataHash). 加 1 param `int oracleFeePct` (= range 5-20, baked into spine).

位置: 跟 brokerFeePct 一起 (= L28 之后)

    contract PoolSpine(
        byte[32] makerPk,
        byte[32] brokerPk,
        byte[32] oracle1Pk,
        byte[32] oracle2Pk,
        byte[32] oracle3Pk,
        int deadline,
        int minerFee,
        int brokerFeePct,
        int oracleFeePct,           // NEW: range 5-20, baked into spine (= Oracle v0.3 R3 truth matrix prediction settle)
        int oracleBondAmount,
        int makerStakeAmount,
        byte[32] marketMetadataHash
    ) {

**P2SH 影响**: 新 ctor param → 新 marketMetadataHash hash → 新 P2SH addr. 现 pre-Ship markets 在旧 P2SH, **永远不能 spend 用新 SS**. per area 4.4 Owner 钦定 (A) accept orphan + DB freeze flag.

### 1.2 settle_unanimous 加 oracle fee split

现 (L37-78):
- 3 oracle unanimous sig verify ✓
- winner == 0 || 1 verify ✓
- outputs[0] = broker fee
- outputs[1..N] = winner payouts
- outputs[last 3] = oracle bond returns (= bond_amount each)
- KIP-10 loop verify Phase 2 TODO

改:
- broker fee 计算 (= Phase 2 TODO 不动) — distributablePool 公式 = losingPool − brokerFee − **oracleFee** (= per Oracle v0.3 R3 truth matrix)
- outputs[last 3] = oracle bond + oracleFee/3 (= 合并 per J1 #2 backend verdict 选项 A, storage mass 不增)
- KIP-10 loop verify Phase 2 deferred 跟 broker fee 一起 implement

**真 require change SS** (= 不 just comment):
现 entry L52 `require(tx.outputs.length >= 4)` (= spine + 3 oracle bonds min OR similar). 不变.

oracle fee split SS 内 require explicit:
- oracleFeeAmount = losingPool × oracleFeePct / 10000
- distributablePool = losingPool − brokerFee − oracleFeeAmount
- outputs[last 3] each value == oracle_bond_returns + oracleFeeAmount / 3

但是 — settle_unanimous outputs.length 现 spec dynamic (= spine + N bettors, N=1..50). KIP-10 loop verify 是 Phase 2 TODO, 现 minimum check passes. NWT sub 4 SS 改 **不 implement KIP-10 loop full** (= 跟现 status align), 只加 oracleFeePct ctor + spec sediment 公式. KIP-10 loop full implement 跟 broker fee 一起 separate sub (= 不 NWT sub 4 范围).

NWT sub 4 SS settle_unanimous 改 final:
- ctor 加 oracleFeePct param ✓
- 公式 sediment in comment + Phase 2 loop verify TODO 标注

### 1.3 settle_majority_forfeit_1 加 oracle fee split

跟 settle_unanimous 同 pattern. 现 L83-117:
- 2 oracle sig + 1 silent (silentOracleIndex) verify ✓
- winner == 0 || 1 verify ✓
- tx.time >= deadline * 1000 verify ✓
- outputs.length >= 4 require ✓
- KIP-10 loop verify Phase 2 TODO

改: ctor oracleFeePct param 自然 inherit (= 全 entry 用同 ctor params). 公式 sediment in comment (= losingPool − brokerFee − oracleFee + forfeit_1 50/25/25 split per area 5.2).

NWT sub 4 SS settle_majority_forfeit_1 改 final:
- 跟 settle_unanimous 同 pattern, 自然 inherit oracleFeePct ctor
- 公式 sediment in comment + Phase 2 loop verify TODO 标注

### 1.4 refund_unanimous_silent: v0.5 testnet 不改

L122-134 现 maker recover stake + 3 bond → maker. v0.5 testnet 不改 (= mainnet EC8 改 burn 是 Phase 5 scope, 不 sub 4).

### 1.5 refund_disagreement: 已 Owner 5/23 burn 实施 ✓

L161-217 已 implement P6 (= silentOracleIndex sentinel + 2 constraint). 不动.

### 1.6 refund_maker_unjoined: 不变

L137-146 不变.

---

## 2. PredictionEscrowUnanimous5.sil 改

### 2.1 ctor 加 oracleFeePct param

现 13 params. 加 1 param `int oracleFeePct` (= range 5-20).

位置: 跟 brokerFeePct 一起 (= L31 之后)

    contract PredictionEscrowUnanimous5(
        byte[32] makerPk, byte[32] takerPk, byte[32] brokerPk,
        byte[32] oracle1Pk, byte[32] oracle2Pk, byte[32] oracle3Pk, byte[32] oracle4Pk, byte[32] oracle5Pk,
        int deadline, int minerFee, int brokerFeePct,
        int oracleFeePct,           // NEW: range 5-20
        int makerStakeAmount, int takerStakeAmount
    ) {

### 2.2 现 settle(sig1..sig5) rename → settle_dispute + oracle fee split

现 (L39-73):
- 5 oracle sig verify ✓
- winner == 0 || 1 verify ✓
- inputs.length == 2 + outputs.length == 2 verify ✓
- spendable = inputs sum − minerFee
- brokerFeeAmount = spendable × brokerFeePct / 10000
- winnerAmount = spendable − brokerFeeAmount
- outputs[0] = winner (maker OR taker per winner) explicit verify ✓
- outputs[1] = broker fee explicit verify ✓

改:
- entry name: `settle` → `settle_dispute` (= per Oracle v0.3 R3 truth matrix "1V1 escrow dispute settle")
- 加 oracleFeeAmount = spendable × oracleFeePct / 10000
- distributableAmount = spendable − brokerFeeAmount − oracleFeeAmount
- winnerAmount = distributableAmount
- outputs.length == 7 (= winner + broker + 5 oracle, 现 == 2)
- outputs[0] = winner explicit verify (= 不变, 现已 explicit)
- outputs[1] = broker fee explicit verify (= 不变)
- outputs[2..6] = 5 oracle各 P2PK with oracleFeeAmount / 5 explicit verify (= NEW)

draft:

    entrypoint function settle_dispute(
        sig sig1, sig sig2, sig sig3, sig sig4, sig sig5, int winner
    ) {
        require(checkSig(sig1, pubkey(oracle1Pk)));
        require(checkSig(sig2, pubkey(oracle2Pk)));
        require(checkSig(sig3, pubkey(oracle3Pk)));
        require(checkSig(sig4, pubkey(oracle4Pk)));
        require(checkSig(sig5, pubkey(oracle5Pk)));
        require(winner == 0 || winner == 1);
        require(tx.inputs.length == 2);
        require(tx.outputs.length == 7);   // CHANGED: 2 → 7 (winner + broker + 5 oracle)

        int spendable = tx.inputs[0].value + tx.inputs[1].value - minerFee;
        int brokerFeeAmount = spendable * brokerFeePct / 10000;
        int oracleFeeAmount = spendable * oracleFeePct / 10000;   // NEW
        int distributableAmount = spendable - brokerFeeAmount - oracleFeeAmount;
        int oraclePerFee = oracleFeeAmount / 5;                    // NEW

        byte[34] makerLock = new ScriptPubKeyP2PK(pubkey(makerPk));
        byte[34] takerLock = new ScriptPubKeyP2PK(pubkey(takerPk));
        byte[34] brokerLock = new ScriptPubKeyP2PK(pubkey(brokerPk));
        byte[34] oracle1Lock = new ScriptPubKeyP2PK(pubkey(oracle1Pk));
        byte[34] oracle2Lock = new ScriptPubKeyP2PK(pubkey(oracle2Pk));
        byte[34] oracle3Lock = new ScriptPubKeyP2PK(pubkey(oracle3Pk));
        byte[34] oracle4Lock = new ScriptPubKeyP2PK(pubkey(oracle4Pk));
        byte[34] oracle5Lock = new ScriptPubKeyP2PK(pubkey(oracle5Pk));

        if (winner == 0) {
            require(tx.outputs[0].scriptPubKey == byte[](makerLock));
        } else {
            require(tx.outputs[0].scriptPubKey == byte[](takerLock));
        }
        require(tx.outputs[0].value == distributableAmount);
        require(tx.outputs[1].scriptPubKey == byte[](brokerLock));
        require(tx.outputs[1].value == brokerFeeAmount);
        require(tx.outputs[2].scriptPubKey == byte[](oracle1Lock));
        require(tx.outputs[2].value == oraclePerFee);
        require(tx.outputs[3].scriptPubKey == byte[](oracle2Lock));
        require(tx.outputs[3].value == oraclePerFee);
        require(tx.outputs[4].scriptPubKey == byte[](oracle3Lock));
        require(tx.outputs[4].value == oraclePerFee);
        require(tx.outputs[5].scriptPubKey == byte[](oracle4Lock));
        require(tx.outputs[5].value == oraclePerFee);
        require(tx.outputs[6].scriptPubKey == byte[](oracle5Lock));
        require(tx.outputs[6].value == oraclePerFee);
    }

### 2.3 settle_consensual NEW entry (= per Oracle v0.3 R3 truth matrix "1V1 escrow 正常 settle 双方 confirm 0 oracle") + J1 #C1 fix

NEW entry. 含 J1 catch #C1 fix (= winner-binding explicit outputs verify).

    entrypoint function settle_consensual(
        sig makerSig, sig takerSig, int winner
    ) {
        require(checkSig(makerSig, pubkey(makerPk)));
        require(checkSig(takerSig, pubkey(takerPk)));
        require(winner == 0 || winner == 1);
        require(tx.inputs.length == 2);
        require(tx.outputs.length == 2);

        int spendable = tx.inputs[0].value + tx.inputs[1].value - minerFee;
        int brokerFeeAmount = spendable * brokerFeePct / 10000;
        int winnerAmount = spendable - brokerFeeAmount;

        byte[34] makerLock = new ScriptPubKeyP2PK(pubkey(makerPk));
        byte[34] takerLock = new ScriptPubKeyP2PK(pubkey(takerPk));
        byte[34] brokerLock = new ScriptPubKeyP2PK(pubkey(brokerPk));

        // J1 #C1 fix: winner-binding explicit outputs verify (= UNCONSTRAINED winner attack 防)
        if (winner == 0) {
            require(tx.outputs[0].scriptPubKey == byte[](makerLock));
        } else {
            require(tx.outputs[0].scriptPubKey == byte[](takerLock));
        }
        require(tx.outputs[0].value == winnerAmount);
        require(tx.outputs[1].scriptPubKey == byte[](brokerLock));
        require(tx.outputs[1].value == brokerFeeAmount);
    }

### 2.4 refund_both + refund_maker_unjoined: 不变

L77-109 不变.

---

## 3. 3 Mutation Regression Test Draft

ship 同 commit per memory feedback_post_fix_real_chain_regression_test_required 5/21 + feedback_mutation_test_real_invoke 5/20.

测试 location: `D:/kanet-tn12/kasia-console/test-framework/cases/predictions/ss-sub4-mutation/`

### 3.1 test_settle_consensual_winner_tamper

setup:
- maker + taker 双方 sig 合法
- 真链 1V1 escrow 双 input UTXO ready (= Phase 4a v0 e2e fixture reuse)

mutation:
- maker + taker 协商 winner = 0 (= maker won)
- TX outputs[0] = makerAddr (= 跟 winner == 0 align)
- 但 winner 参数 篡改 == 1 (= 试图 "我 sig 了 winner==0, 但 commit 时改成 1, kaspad 让 takerLock 收 winnerAmount?")

expect: SS reject (= require outputs[0].scriptPubKey == takerLock if winner == 1, 但 outputs[0] 是 makerLock → mismatch)

invoke: import production silverc compile module + submit mutation TX → kaspad reject `script verify failed`

### 3.2 test_settle_consensual_outputs_tamper

setup: 同 winner_tamper

mutation:
- winner == 0
- outputs[0] = 第三方 addr (= 不 maker 不 taker)

expect: SS reject (= require outputs[0].scriptPubKey == makerLock 严格 equality)

### 3.3 test_settle_consensual_broker_fee_tamper

setup: 同 winner_tamper

mutation:
- outputs[1] = brokerAddr ✓
- outputs[1].value 篡改 (= 减少 broker fee, 多给 winner)

expect: SS reject (= require outputs[1].value == brokerFeeAmount 严格 equality)

---

## 4. Fire Plan

1. **NOW (T+0)**: draft 写完 + 上链 broadcast hash sediment
2. **T+1 (= J2 sub 1 schema lock)**: 真 SS file 改 (= D:/kanet-tn12/kasia-console/src/lib/PoolSpine.sil + PredictionEscrowUnanimous5.sil)
3. **T+1.5**: silverc.exe compile + 新 P2SH derive
4. **T+2**: 真链 mutation test 跑 (= import production + invoke real exported)
5. **T+2.5**: J2 cross-implementor 反审
6. **T+3.5**: ship (= per Bettor r29 fire 顺序)

---

## 5. Open Risks

1. SS recompile 后新 P2SH addr — 现 pre-Ship markets 永久 orphan per area 4.4 Owner 钦定 (A) + DB freeze flag
2. ~~settle_dispute outputs.length == 7 撞 storage mass cap?~~ **RESOLVED per J1 #10 + #12 quantify + NWT r12 + r13 双层 dynamic formula fix** (= 见 §7 below)
3. 真链 mutation test 真链 setup 需 Phase 4a v0 e2e fixture — D 盘 :3200 active 跑 (= J1 #9 物理 split 推迟到 NWT sub 4 ship 完, NWT mutation test 期间 D 盘 :3200 仍 active per Bettor r30)
4. cross-implementor J2 反审 catch 任何 NWT propose 漏 (= 跟 J1 #C1 同 pattern 防 KI-12 复刻第 20 次)

---

## 7. Storage Mass — Dynamic Minimum-Spendable Fix (= J1 #10 + #12 catch resolved)

### 7.1 Problem (= J1 #10 quantify)

1V1 escrow dispute settle 5 oracle fee outputs 在小 pot 撞 KIP-9 storage mass cap:
- spendable=1 KAS + oracleFeePct=1%: 每 oracle output mass = 5_000_000, 5 outputs = 25M mass ✗ 远超 cap 500K
- 50 KAS hardcode @ 1%: mass = 500_000 = AT CAP (= 0 buffer 不安全)

### 7.2 Solution — Dynamic Minimum-Spendable Formula (= J1 #12 refinement)

`min_spendable_kas = max(SAFETY_FLOOR_5_KAS, 12500 / oracleFeePct_bps)`

| oracleFeePct | 1V1 escrow min spendable (5 oracle) | prediction min spendable (3 oracle) |
|---|---|---|
| 1% (100 bps) | 125 KAS | 75 KAS |
| 5% (500 bps) | 25 KAS | 15 KAS |
| 10% (1000 bps) | 12.5 KAS | 7.5 KAS |
| 20% (2000 bps) | 6.25 KAS | 5 KAS (floor) |
| floor | 5 KAS | 5 KAS |

数学 derivation: KIP-9 mass_per_output = 10^12 / value_sompi. Safe threshold STORAGE_MASS_SAFE_THRESHOLD=400_000, 给 5 oracle outputs 用一半 (= 200_000), 每 oracle output mass <= 40_000. value_sompi >= 25M = 0.25 KAS / output.

### 7.3 双层 Enforce

**Layer 1 — console-side create-time reject**:
pool.js + offer.js create endpoint:

    const minSpendableKas = Math.max(5, 12500 / oracleFeePctBps);
    const minSpendableSompi = minSpendableKas * 100_000_000;
    if (spendableWorstCase < minSpendableSompi) {
        throw new Error(`spendable < ${minSpendableKas} KAS @ ${oracleFeePctBps/100}%, KIP-9 storage mass 撞 cap`);
    }

**Layer 2 — SS defense-in-depth**:

PredictionEscrowUnanimous5 settle_dispute 加:

    require(spendable * oracleFeePct >= 1_250_000_000_000)
    // = 12500 KAS × 10^8 sompi-bps unit, 等价 spendable_kas × oracleFeePct_bps >= 1_250_000

PoolSpine settle_unanimous + settle_majority_forfeit_1 加:

    require(spendable * oracleFeePct >= 750_000_000_000)
    // 3 oracle 比 5 oracle 松 5/3, = 7500 KAS × 10^8 sompi unit

### 7.4 Pre-Ship Orphan Fall-back (= area 4.4 update)

- 1V1 escrow spendable < min_spendable → 自动走 settle_consensual path (= 不 oracle, 双方 mutual ack, 不阻 现 markets)
- pool prediction spendable < min_spendable → reject (= 0 consensual path for pool, area 4 chain refund_unanimous_silent fall-back)

### 7.5 UI sub #7 实时 disclose

maker create form (= per KANet-UI sub #7 scope):
- 用户 set oracleFeePct → UI 实时算 min_spendable_kas
- 显 "current stake 总 X KAS < min {min} KAS @ {pct}%, 加 stake OR 提 oracleFeePct OR 用 path A"
- maker create form fee selector 实时 surface min_spendable per fee choice

---

## 6. Sediment

- Bettor r26 R7 CLOSE + 11 catch chain
- J1 #2 catch #C1 (= NWT r8 自承 KI-12 复刻 18 + fix propose)
- J2 r8 catch 11 (= 自承 KI-12 复刻 19 同款)
- Owner 5/26 4+1 钦定 (= broker port e2e 暂搁, Oracle 完后 cross-product)
- Owner 5/26 "最精良 oracle" 质量底线 5 条
- Owner 5/26 02:35 "全力推动" pivot (= 全 implementor parallel fire)
