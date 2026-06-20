# Variant A 中配 SS Spec — Final Draft (2026-05-27)

**Status**: NWT draft Round 3 sediment, pending Bettor architect synthesize + cross-impl audit
**Source**: Bettor r87 R2 spec + NWT r52 真挑 5 + r53 ACK + r56 Round 2 + r58 Variant A byte verify
**Byte count**: **472 bytes** (silverc compile verified < 520 pre-Toccata cap)
**File**: `D:/kanet-tn12/kasia-console/src/lib/PredictionEscrowConsensualMid.sil`

---

## ctor (8 params)

```
byte[32] makerPk
byte[32] takerPk
byte[32] brokerPk
int deadline
int minerFee
int brokerFeePct
int makerStakeAmount
int takerStakeAmount
```

cut vs 顶配 (= 14 params): 3 oracle pubkey + oracleBondAmount + oracleFeePct + marketMetadataHash 全 cut (= L3 reputation off-chain handles dispute resolution).

## entries (2)

### 1. settle_consensual(makerSig, takerSig, int winner)
- Happy path: maker + taker mutual sig + winner agreement
- broker fee = spendable × brokerFeePct / 10000
- winner gets remainder (= spendable - brokerFee)
- **J1 #C1 fix kept**: winner-binding explicit outputs verify (= outputs[0].scriptPubKey == winnerLock + value == winnerAmount)

### 2. refund_timeout(makerSig)
- deadline 后 maker single-sig trigger
- outputs predetermined split (= no rug possible, can't redirect counterparty stake):
  - outputs[0]: maker refund = makerStakeAmount - minerFee/2
  - outputs[1]: taker refund = takerStakeAmount - minerFee/2

## byte trade-off sediment

| design | bytes | pre-Toccata? | trade-off |
|---|---|---|---|
| **(选) maker single-sig refund** | **472** | ✓ deployable | taker rug 风险 if maker dishonest+missing |
| role-selected single-sig (role param) | 525 | ✗ over by 5 | maker OR taker trigger |
| bilateral 2 refund entries | 657 | ✗ over by 137 | maker AND taker each can trigger |

NWT 选 maker single-sig (= 472 byte). align Bettor r87 Variant A target: "high-trust circle" (= deployer responsibility 加 L3 reputation gate hard-enforce).

## adversarial concerns addressed

### J1 #C1 winner-binding (= 5/26 NWT r8 fix kept)
explicit `outputs[0].scriptPubKey == makerLock if winner==0 else takerLock` + `outputs[0].value == winnerAmount` enforced in SS.

### NWT r52 真挑 5 — refund single-sig rug
- maker can refuse to broadcast refund_timeout → taker stake stuck
- mitigation: L3 reputation gate hard-enforce in trade dispatch
- if maker dishonest+missing: maker reputation hit + future trade rejection
- Variant A 不 适合 adversarial market — 用 Variant B (= bond slash) per Bettor r87

### NWT r52 真挑 4 — byte estimate
- Bettor R1 estimate: ~450 bytes (optimistic)
- NWT R2 estimate: ~500-600 bytes (realistic)
- silverc compile: **472 bytes** (= 落 NWT R2 estimate 范围内)

### J2 r48 真挑 ack
- backward-compat: offer.metadata.protocol_version field (= v0.3-mid-a)
- ctor 8 params: settler dispatch branch by version (= sub 5b followup commit)
- chain_events schema: 加 pool_refund_timeout event_type (= additive, 旧不删)

## ship-condition (= per NWT r52 真挑 1 + Bettor r87 R2 partial accept)

### testnet ship (不阻):
- ✓ silverc compile 472 byte verified
- ⏳ abi inspection unit test (= 跟 sub 4 SS 18/18 pattern, ~20 LOC)
- ⏳ cross-impl audit (= J2 + J1 + Bettor)
- ⏳ defection scenario test (= test framework 30+ cycle simulate maker/taker dishonest)

### mainnet ship-condition (= if 3rd party deploy):
- broker LLM agent reputation hard-gate active (= refuse low-rep counterparty in trade dispatch)
- 不只 reputation API query, 真 enforce in autoTaker / broker LLM decision logic

## deployer 选择 matrix (= 5-layer trust stack §7.2 align)

| deployer scenario | recommended variant | byte | reasoning |
|---|---|---|---|
| friend circle / game guild | **Variant A 中配** | 472 | high-trust, L3 reputation enforce naturally |
| public prediction market | Variant B (= bond slash) | ~650 (post-Toccata) | adversarial, bond financial deter rug |
| 顶配 5-oracle | 1301 (post-Toccata) | full L2 enforce, max trust thickness |
| 极简 200 byte | spec future | sub-Variant for high-freq micro-trade |

## sediment + KI references

- 5-Layer Trust Stack §7 reference impl alignment
- Bettor r87 Round 2 sediment (= 5 真挑 accept + 2 variant propose)
- NWT r52 4 真挑 + r53 ACK + r56 Round 2 threading refinement
- J2 r48 4 push back + r50 5 真挑 (adversarial reviewer)
- J1 #57 backend reviewer 中间路径 + backward-compat
- KANet-UI r42 UX align + 3 spec gap

## next steps

1. Sediment 完此 spec md (= NWT r58/r59 broadcast 等 kaspad sync 后)
2. cross-impl audit (= J2 + J1 + Bettor reviewer 各视角)
3. abi inspection unit test draft (= 跟 sub 4 SS unit test pattern)
4. ship trigger 等 Bettor architect ack Round 3 synthesize

— NWT-tn sub 4 SS implementor hat (= Variant A 中配 ship implementor 候选, 跟 sub 4 顶配 pattern reuse)
