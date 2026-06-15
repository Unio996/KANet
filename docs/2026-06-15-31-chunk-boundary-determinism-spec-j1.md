# #31 找零核弹 — chunk-boundary cross-node determinism + SS spine-remainder (J1 slice spec)

> **日期**: 2026-06-15
> **作者**: J1 (determinism + settle 主路径 own)
> **性质**: 设计 spec。gate B #31 最大开门 blocker 的 determinism 半 (J2=MASS 机械 / J1=DETERMINISM / NWT=2nd-vantage 攻)。
> **分工** (4 方锁定 Bettor r-msg): J2 主 MASS 机械 (`computeSettleChunks` greedy + 守恒 + 找零链 TX 构造) /
>   **J1 (本 spec) 主 DETERMINISM** (chunk-边界 byte-equal + SS spine-remainder + dispute/claim + :3300 链测) /
>   NWT 2nd-vantage 对抗验 (induction byte-equal + cross-chunk 守恒 + 末 change==0).
> **前置已闭**: #31 ②轴 bettor payout addr pk-derive 单源 (a40e96d5, 3方独验 + Bettor value-等价 403/403) =
>   chunk output addr 链锚的硬前置.
> **铁律**: [[cross-node-determinism-review-two-axes]] 两轴 + [[reference-silverscript-covenant-fold-limits]] SS + NO-TX-NO-STATE.

---

## 0. 命门 (双重)

settle 的 winner 输出超 KIP-9 storage-mass cap (~500k block / per-chunk ~470k SAFE) → 必拆多 chunk TX
(现 L1949 是 THIN-MARKET cancel-refund = degraded; #31 升级为真 chunk settle). 两重 determinism 命门:
1. **chunk-边界 byte-equal**: 哪些 winner 进哪 chunk = 确定性 chain-anchored, 否则两节点异 partition → 异 chunk
   TX 序列 → 异 txid → cross-node settle fork (= committee_pk_hash / fold-tree byte-equal 同课).
2. **change 须 SS-governed (trustless)**: chunk_i 的找零 (未付完的 pool 余额) 必【SS spine 续锁】非 settler-P2PK
   — 否则 settler 持私钥可把未付余额转走 = NO-TX-NO-STATE / 信任假设破. = 本 spec SS spine-remainder.

---

## 1. computeSettleChunks determinism (J2 pure fn → byte-equal 充要)

J2 `computeSettleChunks(winners[], cap)` (greedy, merkle_index ASC): 遍历累加, 每 winner 试算
`estimateStorageMass(chunk inputs, [已累 outputs + 本 winner + 1 change])`; >cap → 封本 chunk(不含本 winner)→
新 chunk 从本 winner 起. 每 chunk = merkle_index **连续子段** (partition: 无重叠无漏). 末 chunk 无 change.

**byte-equal 跨节点 ⟺ 4 输入全链锚** (J1 determinism 焊):
| 输入 | 链锚源 | 状态 |
|---|---|---|
| ① winner 序 | `ORDER BY merkle_index ASC` (bettor 在 pool merkle root 的 commit 位, bet 时焊) | ✓ L1570 |
| ② winner payout amount | `computePoolPayouts` 纯 fn (pool state 派生, BigInt sompi 零 float) | ✓ |
| ③ winner payout addr | `XOnlyPublicKey(bettor_pk).toAddress` pk-derive (②轴修, 删 node-local) | ✓ a40e96d5 |
| ④ cap | **SOURCE 硬编码常量** (如 SAFE_THRESHOLD), **禁 process.env/DB/node-config 读** | ⚠ Bettor①/NWT⑤ fork-命门 |
| ⑤ mass predicate = **FULL totalMass** | `computeMassEst(byte-mass, **含 spine-P2SH redeem witness 实字节**) + Σ storageMass(每 winner) + storageMass(change)`, **非只 lib estimateStorageMass(storage 分量)** | ⚠⚠ Bettor 命门: spine redeem 主导 |
| ⑥ N_max fee-reserve (J2 B-上界) | `N_max = ceil(numWinners × C / (cap × minPayout))` → reserve = N_max×per-chunk-fee; numWinners(链计数)/C(常量)/cap(④常量)/minPayout(computePoolPayouts 链锚)/ceil(确定) 全链锚 | ✓ J1 co-verify byte-equal |

∴ greedy partition 是 pure fn of 链锚输入 → **两节点同切** (封片点确定: mass=f(output 值+数+脚本长), 全 P2PK
同脚本长 → addr 内容不动 mass, 封片点由 ②amount+①序 定, 与 addr 内容无关 [J2 纠正后准确表述]).

⚠ **⑥ fee↔N 循环 break (J2 B-上界预留, J1 determinism co-verify)**: chunking 引入 N miner fee (每 chunk 1 个)
→ 守恒 Σwinners+broker+Σoracle+Σ(N fee)==pool; N 越多 fee 越多 → 必预留. **否决 A(迭代)**: reserve↑→payout↓→
1/payout↑→mass↑→N↑→reserve↑ **正反馈可震荡/发散 = 非确定收敛** (cross-node 致命). **B(上界一次定)**: N_max
链锚公式 → 两节点同 N_max → reserve 确定 → payout 确定 → **determinism-by-construction 零迭代**. = §1 贪心切的
payout 输入(②)的前置 (reserve 先定才有 distributable→payout).

⚠ **④ cap-source = fork 命门** (Bettor①/NWT⑤): cap 直接定封片点 → cap 若 env/DB 可变 → 两节点异 cap → 异
封片 → 异 chunk 划分 = settle fork. **cap 必 source 常量** (lint/测断言 cap 非 `process.env`/DB 读; NWT 攻面: 喂
异 cap 验 fork). ⑤ **mass predicate 必 = FULL totalMass** (Bettor 命门 + NWT② sharpen, 双重 undercount):
chunk = input(上 change spine-P2SH) + K winner + 1 change + fee. **双重漏算**: ①只 sum winner 输出 (漏 change/input)
②**只 storage 分量** (lib `estimateStorageMass(value)`=纯 KIP-9 C/value storage, **不含 compute/size mass**).
**真 totalMass = computeMassEst(byte-mass, 含 spine-P2SH redeem witness 实字节) + Σ storageMass(winner) + storageMass(change)**
(= `computeMultiOutputFee` 内 totalMass 法). ⚠ **spine redeem witness 主导**: §3 找零链每 chunk 花一个 spine-P2SH
输入, redeem script(大=整 PoolSpine bytecode)进 witness = 大 compute/size mass = **正是 bshard MAX_FOLD_K=23 的
quadratic-redeem-per-P2SH-input 同绑定**. ∴ J2 prototype 若用廉价 P2PK 输入模型 → undercount → 真 chunk 数 >> 23-class
预估 (每 chunk 容纳的 winner 数被 spine redeem 挤小). **必用真 spine-P2SH 输入 mass 重量 computeSettleChunks** (待 J2
校正 predicate + 我 §3 SS spine-remainder 定 redeem 实字节). 此 mass predicate 两节点必同 (链锚 redeem bytes) = determinism.

### 1.1 edge guards (NWT design-stage 攻面先焊 + Bettor②)
- **single-winner > cap (NWT①/Bettor②)**: 一 winner output mass 独超 cap → greedy 在空 chunk 上"试+本超cap即封"
  = 死循环 / 塞不进. **guard: 每 chunk ≥1 winner** (即便单独超 cap 也成片, 不可再分). P2PK 同脚本长下不发生 (均匀
  output), 但 spec **显式断言防回归** + 测覆盖.
- **empty winners (NWT④)**: winners.length==0 → 0-bet, 走现有 0-bet shortcut (dispatchRefund), 不进 chunk 路.
- **末 change==0 rounding (NWT③)**: 末 chunk change 必精确 0 (§4 ②不变量); rounding/余尘 → stuck. 守: change =
  totalPool − Σpaid − Σfee 逐 sompi BigInt (零 float), 末 chunk change==0 硬断言.

---

## 2. change-chain 输入侧 determinism (induction)

Bettor 输入侧点: chunk-TX 输入是【找零链】. chunk_0 花 pool-lock UTXO → (K_0 winner 输出 + 1 change);
chunk_1 花 **chunk_0 的 change outpoint** → (K_1 winner 输出 + 1 change); ... chunk_{n} 花 chunk_{n-1} change
→ 末 K_n winner 输出, **无 change** (全付完).

**induction byte-equal** (NWT 主攻面): 
- base: chunk_0 输入 = pool-lock UTXO (deadline 后链确定 outpoint, 两节点同).
- step: chunk_i byte-equal (§1 输出确定 + §4 fee 确定 + change amount 确定) → **chunk_i txid 两节点逐字节同** →
  chunk_{i+1} 输入 outpoint (= chunk_i 的 change output: txid+index) **两节点同** → chunk_{i+1} 输入侧确定.
- ∴ 整链 byte-equal (每 chunk pure fn + 上链 txid 确定 → 下 chunk 输入确定). 链式无 node-local 注入点.

---

## 3. SS spine-remainder (change SS-governed, trustless) — J1 SS 域

**问题**: chunk_i 的 change (未付 pool 余额) 不能是 settler-controlled P2PK (settler 持私钥 = 可转走未付余额).
**解**: change 输出 = **PoolSpine 合约续锁** (covenant continuation): chunk TX 的 change output scriptPubKey =
同 spine P2SH (或 partial-settle 专用续锁 entry), 余额仍 SS-governed → 只能经下一 chunk settle 花 (付下批 winner),
settler 无法挪用. = trustless 链式 settle.
**SS 改 (PoolSpine_v07 settle_aggregate → 支持 partial-settle)**:
- 新 entry `settle_chunk` (或 settle_aggregate 加 partial 模式): 校验【本 chunk 付的 winner 子段 + change 续锁
  spine + Σ(本 chunk outputs)+fee == 本 chunk 输入(上个 change 或 pool-lock)】逐 sompi.
- change output 必续 spine cov (introspection `tx.outputs[change_idx].scriptPubKey == spine_p2sh`) → 防 settler 挪用.
- 末 chunk: change==0 (全付完), 无 change 输出.
- ⚠ SS 原语已验可用 ([[reference-silverscript-covenant-fold-limits]]): introspection tx.outputs[i].value/scriptPubKey
  (TN12 有) + covenant 续锁. 待 J2 找零链 TX 构造域定 change_idx 位 + 我 SS 落 settle_chunk entry.

---

## 4. cross-chunk 守恒 (J2 own, J1 co-verify) + 两轴扫

**守恒不变量** (J2 own, NWT 攻, J1 co-verify):
① Σ(all chunks winner outputs)+Σ(all chunks fees)==totalPool 逐 sompi (零 mint/burn).
② change_i = totalPool − Σ(paid≤i) − Σ(fees≤i); change_{0..n-1}>0, **change_final==0** (零 stuck/lost).
③ 每 winner ∈ 恰 1 chunk (merkle_index 连续 partition → 无双付/漏).
④ 每 chunk fee = mass-aware (本 chunk outputs, computeMultiOutputFee).

**两轴扫** ([[cross-node-determinism-review-two-axes]]):
- **①算术轴**: greedy mass + payout amount + change amount 全 **BigInt sompi 零 float**; 守恒逐 sompi assert;
  estimateStorageMass KIP-9 完整 (非 lib 近似). 迭代序 merkle_index ASC 固定.
- **②地址派生轴**: winner addr pk-derive (②修✓); **change addr = spine cov 模板派生** (§3, 非 settler node-local);
  pool-lock 输入 outpoint deadline 后链确定 (非 P2SH-scan).

---

## 5. 分工 + 验收

| 角色 | 职责 |
|---|---|
| **J2** | `computeSettleChunks` pure fn (standalone 守恒测) + 找零链 TX 构造 (依赖 J1 §3 SS spine-remainder) |
| **J1 (我)** | 本 spec + §1 边界 determinism 焊 + §3 SS spine-remainder (settle_chunk entry) + §2 induction + dispute/claim 路 + :3300 链测 |
| **NWT** | 2nd-vantage 攻: induction byte-equal (喂 node-local 序/异切) + cross-chunk 守恒 (双付/漏/mint/burn) + 末 change==0 (stuck) + :3300 check_utxo_landed output addr 核 |

**验收** (post-demo gated): 真大池 e2e (winner 数撑过 cap 触 chunk → 多 chunk settle → 全 winner 付齐), 两节点
chunk TX 序列 **byte-equal** (双 vantage DB 对照) + 守恒 4 不变量 + 末 change==0 + NWT 攻全不可达. 基准: 小池单
chunk settle 回归 (46f8a/xfu62) 仍 PASS.

---

## 6. 余项
- **robustness `require(winnerAmounts[k] > 0)`** (NWT 小建议): amount sign-magnitude 下负值会异编码破 byte-match.
  现已**双重阻断** (负 amount → leaf 异 → merkle fail; 且 output value≥0 consensus → value-match fail), 故非 blocker;
  作显式防御余项, **批下次 recompile 时加** (避单为此 churn 一轮编译). payout 恒正 (min-pot 保 >dust) → 不影响现路.
- **J2 接口**: ✅ computeSettleChunks 已出 (10/10 self-test, 待 push 我 drift-check); change_idx 已定 (changeIdx=wOutBase+segLen 派生).
- **dispute/claim 路**: 同 chunk 适用? dispute_reveal/refund 输出超 cap 也需 chunk (同 §1-4 法). 待审 4-TX 全覆盖.
- **现 THIN-MARKET cancel (L1949)**: chunk settle 上线后, cancel-refund 仅留【真经济不可结】(losing pool < 1 chunk
  最小 fee+floor) 边界, 非 mass-cap (mass-cap 改 chunk 不再 cancel).

---

## 7. v08 SS-契约 FREEZE (J2 `computeSettleChunks`/settler **照此 code** = 源头防漂; drift-check 权威)

> 来源 = `kasia-console/src/lib/PoolSpine_v08_chunk.sil.draft` @ **b367753b** (4-entry COMPILE OK, J2/NWT/Bettor 三验,
> ctor FREEZE@16). 此节是 §1-4 设计落地后的**实现契约**: §3 旧述 (free `change_idx` / `spine_p2sh_hash` witness
> introspection) **已被取代** — 实现走 `validateOutputState`(OpInputCovenantId 本 cov 自验) + 确定 `changeIdx`.
> **J2 出码即 diff 本节 7 项, 任一不符=喊 (我 own SS 契约)。**

### 7.1 ctor16 (P2SH-affecting, FROZEN — 序/类型/值源任一变=异 P2SH 异市场)
| idx | param | type | 值源 / 链锚 |
|---|---|---|---|
| 0 | makerPk | byte[32] | maker 身份 (market-create) |
| 1 | brokerPk | byte[32] | broker 身份 |
| 2 | poolMerkleRoot | byte[32] | pool snapshot depth-8 root (committee 池, v07-继承) |
| 3 | deadline | int | market deadline |
| 4 | marketMetadataHash | byte[32] | |
| 5 | market_id | byte[32] | raw (跨 shard 同 logical market 锚) |
| 6 | shard_id | int | 0..shard_count-1 |
| 7 | shard_count | int | |
| 8 | oracleBondAmount | int | committee bond (sompi) |
| 9 | maxWinnersPerChunk | int | **= MAX_K = 47** (settle_chunk merkle-loop 编译期界 = chunk_i 最大容量) |
| 10 | init_hwm | int | change UTXO genesis HWM (pool-lock 隐含 0) |
| 11 | init_plan_commit | byte[32] | genesis = **ZERO32** 固定占位 (payoutRoot 创建时未知, 走 chunk_0 plan_commit_arg committee-sign) |
| 12 | init_total_winners | int | genesis = **0** 固定占位 (真总数走 chunk_0 total_winners_arg) |
| 13 | maxChunkFee | int | **= V07_MAX_FEE = 1e8** 单源 (pool-market-settler.js L2291); ⑦ over-fee 上界 |
| 14 | makerStakeAmount | int | **v07-anchor 补** (settle_aggregate min-bet≥1e8/dust + refund output 范围) |
| 15 | minerFee | int | **v07-anchor 补** (settle_aggregate fee sanity >0 && <1e8 loose) |

### 7.2 payoutRoot 构造 (J2 builder 必 byte-match; SS climb target = `effPlanCommit`)
- **leaf_k = `blake2b( winnerPk[32] ‖ amount_sompi[8B **LE**] )`** (SS L147: `blake2b(byte[](pk) + byte[](amount, 8))`).
  ⚠ `byte[](int,8)` = **LITTLE-ENDIAN** (J2 byte-match 7/7 实证). amount = `computePoolPayouts` BigInt sompi (含 off-chain dust).
- depth-8 position-aware merkle, **winner 按 `merkle_index` ASC** 排 (= bet-time pool-root commit 位, §1①链锚).
- `winnerSiblings` 扁平: `winnerSiblings[k*8 + lvl]` = winner k 第 lvl 层兄弟 (lvl 0=底). bit = `(merkle_index / 2^lvl) % 2`;
  bit==0 → `blake2b(cur‖sib)`, bit==1 → `blake2b(sib‖cur)` (SS L148-163).
- root = `init_plan_commit` (chunk_0 经 5×committee-sig sighash commit `plan_commit_arg`; chunk_i 从 state.planCommit 读).
- **<256 叶 padding = `ZERO32` (0x00*32) 零填 — LOCKED** (J2 builder `new Array(256).fill(ZERO32)` re-climb 20/20 +
  NWT 独验 = malleability-free, 防 dup-last CVE-2012-2459). SS climb empty sibling 即 ZERO32, 两节点同 builder 一致.
- **amount 编码 sign-magnitude 注** (NWT): `byte[](amount,8)` = Kaspa ScriptNum **sign-magnitude LE** (非 two-comp;
  serializeI64(-1,8)=01..00 **80** sign-bit). payout **恒正** → 纯 8B LE 路径 = SS `byte[](amount,8)` byte-match (7/7).
  robustness 余项: builder+SS 宜加 `require(winnerAmounts[k] > 0)` 防负值漏入破 byte-match (NWT 小建议, 见 §6 余项).

### 7.3 settle_chunk witness 序 (entry 0; chunk_0 vs chunk_i 用法差异)
`(sig c0Sig..c4Sig, byte[32] c0Pk..c4Pk, byte[32] committeePkHash, int winner, byte[32] plan_commit_arg,`
`  int total_winners_arg, int chunk_kind, int seg_lo, int seg_hi, byte[32][] winnerPks, int[] winnerAmounts, byte[32][] winnerSiblings)`
- **chunk_0** (chunk_kind==0): c*Sig 须 **≥4 valid** (4-of-5) + `blake2b(c0Pk‖..‖c4Pk)==committeePkHash`;
  `plan_commit_arg`=payoutRoot (sighash-committed), `total_winners_arg`=总数. **seg_lo 必==0**.
- **chunk_i** (chunk_kind!=0): **无 sig** (省 sig-ops = 容量杠杆); planCommit/totalWinners/prevHwm **全从 `readInputState` 读**
  (零 free-witness); `plan_commit_arg`/`total_winners_arg`/c*Sig/c*Pk **忽略** (settler 填占位即可, 不参与 verify).

### 7.4 output layout (per chunk_kind; `wOutBase`+`changeIdx` 确定派生, 非 free)
```
chunk_0 (kind=0): [0]=broker  [1..5]=committee c0..c4 bond  [6 .. 6+segLen-1]=winners  [6+segLen]=change
chunk_i (kind=1): [0 .. segLen-1]=winners  [segLen]=change
chunk_n (kind=2): [0 .. segLen-1]=winners            (无 change)
```
- `wOutBase` = 6 (chunk_0) / 0 (chunk_i,n);  `segLen = seg_hi - seg_lo`;  `changeIdx = wOutBase + segLen`.
- winner k → `outputs[wOutBase+k]`: `scriptPubKey == ScriptPubKeyP2PK(pubkey(winnerPks[k]))` **且** `value == winnerAmounts[k]`.
- **output-count bound (keystone 防 steal-output)**: `outputs.length == wOutBase + segLen + (chunk_kind!=2 ? 1 : 0)`.
- broker `outputs[0].value>=1000`; committee `outputs[1..5].value>=oracleBondAmount` (仅 chunk_0).

### 7.5 HWM change-state (`validateOutputState(changeIdx, {...})`; cross-chunk linkage)
- change UTXO 携 **`{hwm:int, planCommit:byte[32], totalWinners:int}`** (readInputState 须**全字段**).
- `hwm = seg_hi` (下个待付 merkle_index);  `planCommit`/`totalWinners` 跨 chunk **不变** (续传同 plan).
- 链式连续硬验: **`seg_lo == prevHwm`** (chunk_0: prevHwm=0; chunk_i: = input change.hwm) — 防 overlap/gap/skip/repeat.
- chunk_kind 绑定: `(kind==0)==(seg_lo==0)`; `(kind==2)==(seg_hi==totalWinners)`; mid=其余.
- genesis (pool-lock UTXO, market-create 时): state = ctor init_* = **{hwm:0, planCommit:ZERO32, totalWinners:0}** 固定占位
  常量 (payoutRoot/N 创建时未知 → 两节点同 → 同 v08 P2SH). ⚠ **chunk_0 (kind==0) 不 readInputState** → 取 witness
  plan_commit_arg(committee-sign payoutRoot)/total_winners_arg = 真值, 故 genesis 占位与 chunk_0 verify **无关**
  (J2 收口, 修我原 spec 误写 payoutRoot/N). chunk_0 输出 change.state = {hwm:seg_hi, planCommit:真payoutRoot,
  totalWinners:真N} → chunk_1 起 readInputState 读真值续链.

### 7.6 capacity (J2 域, 我 co-verify byte-deterministic)
- `maxWinnersPerChunk` ctor = **47** = 编译期 merkle-loop 上界 = **chunk_i** 最大容量 (winners+change only).
- 实 per-chunk segLen 由 **value-aware greedy packing** (J2 `computeSettleChunks` via 单源 `estimateStorageMass`) 定:
  **chunk_0 ≤ ~41** (+6 broker/committee 输出占 mass), chunk_i ≤ 47, chunk_n ≤ 剩余. 两节点同 `estimateStorageMass` → 同 segLen → byte-equal partition (§1).
- ⚠ chunk_0 capacity **< 47** = NWT capacity-asymmetry edge (J2 greedy 已含; **禁 hardcode chunk_0=47** → 漂/超 cap).

### 7.7 drift-check 清单 (J2 出码我逐条 diff; 任一 FAIL=喊)
1. ctor16 序/类型 == 7.1 (idx14=makerStakeAmount, idx15=minerFee).  2. payoutRoot leaf = blake2b(pk‖amount **8B LE**), merkle_index ASC, sibling flatten k*8+lvl, padding 规则锁定.  3. witness 序 == 7.3, chunk_i 不喂真 sig.  4. output layout/wOutBase/changeIdx == 7.4, output-count bound 在.  5. HWM state 3-字段 + seg_lo==prevHwm + genesis init_* 同值.  6. chunk_0 capacity 走 greedy 非 hardcode 47.  7. cap/maxChunkFee/MAX_K = **SOURCE 单源常量** (禁 env/DB, §1④ fork 命门).

---

## 8. gate B finish-line 跨节点 settle e2e harness 断言计划 (Bettor 下一手②; J1:3300+Bettor broadcast co-own)

> **prep** (impl gated on J2 production `computeSettleChunks` push + dispatchPhase2 v08 wire + 部署). 此节定**断言**,
> J2-wire 落地我即照此 impl. 三层: 8.1 前置检(我 determinism 域, e2e 前先跑非 mid-flight 发现) / 8.2 e2e 主路 /
> 8.3 resumable kill-mid-chunk (NO-TX-NO-STATE 实证). NWT 2nd-vantage 对抗 + check_utxo_landed output addr 核.

### 8.1 cross-node consensus 前置检 (NWT refinement **收窄 4→2-assert**; 我 determinism 支柱)
⚠ **NWT 收窄 (honest, segmentation = settler-chosen 非共识; 团队 2026-06-15 共识)**: committee 只签 settler 提的
chunk_0 (验 outputs 匹配 payoutRoot leaves 0..K0 + HWM 链 + 守恒), **不 re-derive canonical 段**; chunk_i 无
committee-sig (续 change-chain cov). ∴ partition 是 settler-local 选择 **非 cross-node 共识值** → 不需两节点 byte-equal.
**真正跨节点共识值 = 2 项 byte-equal**:
1. **ctor16 → 同 v08 P2SH** (两节点同 16-param redeem + init_* 固定占位 → 同地址, §7.1 FREEZE).
2. **payoutRoot byte-equal** (两节点 `computePoolPayouts`(同 winners merkle_index ASC) → 同 payoutRoot; committee 签它
   = canonical consensus value). **[J1 独验 2026-06-15: 两节点 builder payoutRoot=`317b85d1..` byte-identical + 7/7
   8B-LE byte-match + 20/20 re-climb == SS climb replica ✓]**.
> segmentation/packing **非共识**: settler 自选, SS 强制 validity (winner∈payoutRoot + HWM 链 seg_lo==prevHwm + 守恒 +
> coverage 0..N) → **任意有效 partition 都对**. estimateStorageMass float(1/v) **只需 conservative** (off-chain ≤ on-chain
> 实 cap; 470k SAFE vs 500k cap = 6% margin; 超则单 chunk mempool reject **非 cross-node fork**) **非 byte-deterministic**.
> ∴ e2e 前置检 = **2-assert** (ctor16 P2SH + payoutRoot); per-chunk partition 验移到 §8.2 SS-validity (on-chain 逐 chunk).

### 8.2 e2e 主路 (大 winner 市场 → 多 chunk → 全付齐链上证)
- **造市场**: winner 数 **> MAX_K=47** 触 chunk (如 **100 winner = 3 chunk**: chunk_0~41 + chunk_1~47 + chunk_2~12).
- **settle on :3300** (真参与节点): dispatchPhase2 v08 路由 >MAX_K → chunk 链; 逐 chunk 广播 (Bettor broadcast slice).
- **per-chunk check_utxo_landed** (NWT 核 + 我): 每 chunk 上链后, 每 winner output `{addr, value}` 在链上可查 (kaspa_tx_log
  本地 indexer 优先 / RPC 降级) + addr == winner pk-derive + value == computePoolPayouts amount.
- **守恒断言** (§4): Σ(all chunk winner outputs) + Σ(N chunk fees) + broker + Σ committee bond == pool 逐 sompi;
  **末 chunk change==0** (零 stuck); 每 winner ∈ 恰 1 chunk (无双付/漏).
- **change-chain induction** (§2): chunk_{i+1} 输入 outpoint == chunk_i change output (txid+idx) 链上实证.

### 8.3 resumable kill-mid-chunk (NO-TX-NO-STATE 实证; HWM resume-token 验) — gate B 真闭核心 (Bettor)
**两变体** (NWT coverage 加: 分布式 settler = 任意节点可结, cross-node resume 比 same-node restart 更贴 testnet 现实):
- **8.3a same-node restart**: 同 settler 广播 chunk_1 上链后、chunk_2 广播前 kill → 同节点重启读链上 HWM → 续完.
- **8.3b ★cross-node resume (我 determinism 域核心)**: node A settle chunk_0,1 上链 → **node A 死** → **node B** (从未碰此
  settle) 读**链上最后 landed change UTXO 的 HWM state** (= seg_hi of chunk_1) → resume cursor → node B 续广播
  chunk_2.. → 末 change==0. = HWM resume-token 全价值实证 (resume 只读链上 → **任意节点可续, 零本地 settler 状态依赖**).
- **共同断言** (两变体): 续 chunk `seg_lo == 链上 hwm` (§7.5 linkage) → **无双付** (不能 restart 到 hwm 之前重付
  winner) + **无 skip** (不能跳过 hwm 漏付) → 全 winner 付齐 + 末 change==0. = HWM 一机制三性质 (linkage+resume+state).
- **NO-TX-NO-STATE**: resume 只信**链上 HWM** (非本地 settler 进度文件/内存) → crash/换节点 不丢不重 = trustless 续结.
  cross-node (8.3b) 是此性质的**充分实证**: node B 无 node A 任何本地态, 纯链上 HWM 即可正确续 = 设计目标达成.
- **★ resume-cursor 确定性算法 (NWT forward-flag, J2 wire 据此一次对 + 我 co-verify)**: 游标必找【**未花的 change
  UTXO 链尾**】, 非已花中间 change (读已花中间 → resume 到过去 hwm → 重付已付 winner). 算法:
  1. 查【**confirmed** UTXO 集】@ **v08 P2SH** (= ctor16 派生, per-market 唯一: ctor 含 market_id/shard_id → 此地址只住
     本 market-shard 的 pool-lock + change 链; refund/dispute 输出 P2PK 不落此址 → 无混入).
  2. filter unspent → **恰 1 个** = 链尾 (hwm=0 时是 pool-lock; 否则最新 change). 读其 state.hwm = resume cursor.
  3. **边界**: 0 unspent = settle 完成 (末 chunk 已落, 无 change); **>1 unspent = ANOMALY** (halt+alert, 设计上不应发生
     — 暗示 fork/bug). 续 chunk seg_lo == 读到的 hwm.
  - **cross-node 确定性**: UTXO 集是**共识状态** (两节点同 on-chain view) → "unspent tip @ v08 P2SH" 任意节点查得同一答案
    → resume cursor 跨节点确定 (8.3b node B 与 node A 读同一 tip). 只读 **confirmed** (非 mempool) = NO-TX-NO-STATE.

### 8.4 regression baseline (不退化红线)
- **小池 ≤MAX_K**: 单 `settle_aggregate` (entry 1, =命门闭的 v07 路) 仍 PASS (46f8a/xfu62 等价回归).
- **0-bet**: 走现有 dispatchRefund shortcut (不进 chunk 路, §1.1 NWT④).

### 8.5 分工锚 (此 harness)
| 谁 | 负责 |
|---|---|
| **J1 (我)** | 8.1 前置检 (determinism 域) + 8.3 kill-mid-chunk resume 验 + :3300 真节点跑 + §7 drift-watch |
| **Bettor** | broadcast slice (逐 chunk 广播链上) + co-own e2e 执行 |
| **J2** | production computeSettleChunks + dispatchPhase2 v08 wire (8.2 造 chunk plan) + signed baseline (→ NWT PoC) |
| **NWT** | 2nd-vantage: 前置检 co-attack + check_utxo_landed output addr 核 + runnable PoC (7 attack mutation) |

---
*J1 #31 determinism slice spec。MASS 机械 by J2, 对抗验 by NWT。impl gated post-demo / 真大池 e2e 守红线。§7 = b367753b 实现契约 freeze (J2 照此 code 防漂); §8 = gate B finish-line e2e harness 断言计划 (J2-wire 落地我照此 impl)。*
