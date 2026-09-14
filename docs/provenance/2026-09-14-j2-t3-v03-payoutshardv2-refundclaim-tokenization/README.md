# PayoutShardV2.sil — refund_claim 代币化（ledger 1183，claim 家族四处之四，最后一处）

> 📌 **状态注记（2026-09-14 · Bettor ledger 1209）**：本目录向量集 ctor 形状与当前 `PayoutShardV2.sil`
> 一致（30 参数），**不是历史陈旧**——本次 1209 派工把这 6 条向量原样并入
> `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-current-suite/`（完整现行套件），本目录本身继续
> 有效，两处不冲突。

## 改了什么

- ctor +2（28→30）：`claim_tmpl_hash`/`market_suffix_hash`（`token_tmpl_hash` 已在早前 absorb/zk_handoff
  代币化时加入，本次复用）。
- `refund_claim`（10→18 参数）：退款目的地从裸 P2PK 改成本笔新建的 `KanetTokenClaim` 输出（同其余三处
  claim 家族形状）：读本合约当前持有的代币 → ZERO32 目的地守卫 → 建新 claim（`ClaimState` 五字段）→
  代币输出转给新 claim → draw-down 分支（AB11 手写编码 24 字段 State，复用 absorb/zk_handoff 已量测的
  `OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=288`，State 字段形状本次未变）。merkle membership + nullifier bitmap
  逻辑一字不动。

## 至此 claim 家族四处全部完成

`PayoutShard.claim`/`PayoutShard.refund_claim`（`0d8a61ee`）、`RootClaim.claim_draw`（`6156e98d`）、
`CloseZkV2.claim`/`escape_claim`（`01a12539`）、`PayoutShardV2.refund_claim`（本次）——D-017"代币只许
covenant 持有"原则下，所有对外派彩/退款路径均已从裸 P2PK 改为目的地重定向到新建 `KanetTokenClaim` 实例，
同一形状、同一套 P13 witness+blake3 + ZERO32 守卫 + AB11（按 1172/1173 处置不变，含 V-T-8 触发组合的入口
一律 AB11+实测）。

## 授权链表（同 RootClaim/CloseZkV2/PayoutShard README 一致论证，不重复，只记本文件特有点）

| # | 比较 | 左操作数来源 | 右操作数来源 | 独立非零证明 |
|---|---|---|---|---|
| 1 | `heldTk.owner == OpInputCovenantId(this.activeInputIndex)` | State 字段，写入者引用 `this.activeInputIndex` | 本次调用现场读取 | 两侧同一恒安全类别；本文件写 `TokenState.owner` 的三处（`absorb`/`zk_handoff`/`refund_claim` 各自的输出）全部引用 `this.activeInputIndex` 或已核过的 `claimCovId`/`zkCovId` |
| 2 | `require(claimCovId != ZERO32)` | `OpOutputCovenantId(claimOutIdx)` | 常量 `ZERO32` | 独立证明本身，不靠 `claim_tmpl_hash` 模板核对代付 |
| 3 | `validateOutputStateWithTemplate(claimOutIdx, ClaimState{...})` | `claim_tmpl_hash`：ctor 烤值 | witness 现场 blake3 | P13 形；`claim_tmpl_hash` 缺 ctor 端非零断言，同其它三份 README 记录的未覆盖点 |
| 4 | `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner: claimCovId,...})` | 已核过非零的 `claimCovId` | — | 复用第 2 条 |

## §2 表"covenant 绑定"列打勾

`PayoutShardV2.refund_claim` 的 `claimCovId != ZERO32`：✅。（`absorb`/`zk_handoff` 的对应守卫已在
各自的提交里打勾。）

## 向量（`run.log`，6/6 PASS）

| 向量 | 验证点 | 真实失败行（关键负向量交互步进确认） |
|---|---|---|
| `V-PSV2RFC-1_pass_partial_with_remainder` | pass：部分退款，代币剩余量续给本合约 + bookkeeping 续约（AB11） | — |
| `V-PSV2RFC-2_pass_exact_no_remainder` | pass：恰好清零，无续约 | — |
| `V-PSV2RFC-3_fail_destination_not_real_claim_template` | fail：新建输出不是真编译的 `KanetTokenClaim` 字节 | `validateOutputStateWithTemplate` |
| `V-PSV2RFC-4_fail_token_owner_diverted_to_stranger`（V-outbind 形） | fail：代币输出 owner 被导向陌生人 | `validateOutputStateWithInputTemplate` |
| `V-PSV2RFC-5_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 错 | `token_tmpl_hash` blake3 核对 |
| `V-PSV2RFC-6_fail_witness_wrong_claim_prefix` | fail：claim 模板 witness 错 | `claim_tmpl_hash` blake3 核对 |

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
