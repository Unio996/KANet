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
- **J2 接口**: computeSettleChunks 出码 + change_idx 位定 → 我 SS settle_chunk entry 接.
- **dispute/claim 路**: 同 chunk 适用? dispute_reveal/refund 输出超 cap 也需 chunk (同 §1-4 法). 待审 4-TX 全覆盖.
- **现 THIN-MARKET cancel (L1949)**: chunk settle 上线后, cancel-refund 仅留【真经济不可结】(losing pool < 1 chunk
  最小 fee+floor) 边界, 非 mass-cap (mass-cap 改 chunk 不再 cancel).

---
*J1 #31 determinism slice spec。MASS 机械 by J2, 对抗验 by NWT。impl gated post-demo / 真大池 e2e 守红线。*
