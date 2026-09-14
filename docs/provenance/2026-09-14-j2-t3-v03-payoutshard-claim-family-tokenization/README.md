# PayoutShard.sil — claim / refund_claim 代币化（ledger 1183，claim 家族四处之二/三）

> 📌 **状态注记（2026-09-14 · Bettor ledger 1209）**：本目录向量集用的 ctor 形状与当前 `PayoutShard.sil`
> 一致（25 参数），**不是历史陈旧**——本次 1209 派工把这 12 条向量原样并入
> `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-current-suite/`（完整现行套件，`claim`/`refund_claim`
> 那两个 function 直接复用本目录的构造逻辑），本目录本身继续有效，两处不冲突。

## 改了什么

- ctor +2（23→25）：`claim_tmpl_hash`/`market_suffix_hash`（`token_tmpl_hash` 已在早前 absorb 代币化时
  加入，本次复用）。
- `claim`（10→18 参数）/`refund_claim`（10→18 参数）：派彩/退款目的地从裸 P2PK 改成本笔新建的
  `KanetTokenClaim` 输出（同 `RefundClaim.refund_payout`/`CloseZkV2.claim`/`RootClaim.claim_draw` 形状）：
  读本合约当前持有的代币 → ZERO32 目的地守卫 → 建新 claim（`ClaimState` 五字段）→ 代币输出转给新 claim →
  draw-down 分支（AB11 手写编码 20 字段 State，同 CloseZkV2/RootClaim 处置不变）。merkle membership +
  nullifier bitmap 逻辑一字不动。

## V-T-8 处置：AB11（复用本文件 absorb 已建立的 OWN_PREFIX_LEN/OWN_STATE_LEN，不用重新量测）

`claim`/`refund_claim` 的 partial 分支同函数内既有 `readInputStateWithTemplate`（读被消费代币）又需要续
本合约自身 20 字段 State——V-T-8 已知触发形状，按 ledger 1172/1173 处置不变，一律 AB11+实测。本文件的
`OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=204` 是 `absorb` 代币化时（`5a0e2729`）已经量测确认的常量，State
字段形状本次未变（只加了 2 个 ctor-only 常量，不进 State），复用同一常量，重新跑量测脚本确认 0 漂移
（见 `measure_output.json`）。

## 授权链表（ledger 1172/1183，两操作数各自要证非零来源；跟 RootClaim/CloseZkV2 README 同一套论证，
不逐字重复，只列本文件特有点）

| # | 比较 | 左操作数来源 | 右操作数来源 | 独立非零证明 |
|---|---|---|---|---|
| 1 | `heldTk.owner == OpInputCovenantId(this.activeInputIndex)` | State 字段，写入者引用 `this.activeInputIndex`（恒安全） | 本次调用现场读取，同一恒安全类别 | 两侧都是"引用 `this.activeInputIndex`"；本文件写 `TokenState.owner` 的三处（`absorb`/`claim`/`refund_claim` 各自的 `tokenOutIdx`/`remainTokenOutIdx`）全部引用 `this.activeInputIndex` 或已核过的 `claimCovId`/`OpInputCovenantId` |
| 2 | `require(claimCovId != ZERO32)`（`claim`/`refund_claim` 各一处） | `OpOutputCovenantId(claimOutIdx)`：本次调用现场读取 | 常量 `ZERO32` | 独立证明本身，不能靠紧接着的 `claim_tmpl_hash` 模板核对代付 |
| 3 | `validateOutputStateWithTemplate(claimOutIdx, ClaimState{...})` | `claim_tmpl_hash`：ctor 烤值，本文件由创建方（genesis-mint 时）供入 | witness 现场 `claim_prefix`/`claim_suffix` 的 blake3 | 走 P13 形；`claim_tmpl_hash` 缺 ctor 端非零断言这个未覆盖点跟其它三份 README 一致，不重复记 |
| 4 | `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner: claimCovId,...})` | 已核过非零的 `claimCovId` | — | 复用第 2 条 |

## §2 表"covenant 绑定"列打勾

`PayoutShard.claim` 的 `claimCovId != ZERO32`：✅。`PayoutShard.refund_claim` 的 `claimCovId != ZERO32`：✅。

## 向量（`run.log`，12/12 PASS：`claim` 6 条 + `refund_claim` 6 条，逐条对称）

| 向量（前缀 `V-PSCF-CLM-`=claim，`V-PSCF-RFC-`=refund_claim） | 验证点 | 真实失败行（关键负向量交互步进确认） |
|---|---|---|
| `-1_pass_partial_with_remainder` | pass：部分派彩/退款，代币剩余量续给本合约 + bookkeeping 续约（AB11） | — |
| `-2_pass_exact_no_remainder` | pass：恰好清零，无续约 | — |
| `-3_fail_destination_not_real_claim_template` | fail：新建输出不是真编译的 `KanetTokenClaim` 字节 | `validateOutputStateWithTemplate` |
| `-4_fail_token_owner_diverted_to_stranger`（V-outbind 形） | fail：代币输出 owner 被导向陌生人 | `validateOutputStateWithInputTemplate` |
| `-5_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 错 | `token_tmpl_hash` blake3 核对 |
| `-6_fail_witness_wrong_claim_prefix` | fail：claim 模板 witness 错 | `claim_tmpl_hash` blake3 核对 |

## 已知后续依赖

无新增（`PayoutShard.sil` 不经 `RootClose`/`ShardLeaf` 之外的路径创建，④批次的既有依赖不变）。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
