# RootClaim.sil — v0.3 §2/§3 代币化（ledger 1183，claim 家族四处之一，先做——此前未过任何代币化）

## 改了什么

- ctor +3（10→13）：`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`，同 RefundClaim.sil/
  CloseZkV2.sil 三件套，一开始就走 P13 witness+blake3 现场核，没有先犯 blake3/ctor-baked 的错。
- `claim_draw`（9→16 参数）：派彩目的地从裸 P2PK 改成本笔新建的 `KanetTokenClaim` 输出（同
  `RefundClaim.refund_payout`/`CloseZkV2.claim` 形状）：读本合约当前持有的代币 → ZERO32 目的地守卫 →
  建新 claim（`ClaimState` 五字段）→ 代币输出转给新 claim → draw-down 分支（`remaining==0` 无续约；
  `remaining>0` 代币剩余量续给本合约自己 + bookkeeping 续约）。merkle membership（验 `payoutRoot`）+
  `claimed_bitmap` R7 防重复领逻辑一字不动。

## V-T-8 处置：AB11（同 CloseZkV2.claim/escape_claim，处置不变）

`claim_draw` 的 partial 分支同函数内既有 `readInputStateWithTemplate`（读 ticket + 读被消费代币）又需要
续本合约自身 8 字段 State（`local_yes`/`local_no`/`count`/`pool_value`/`closed`/`winningSide`/
`payoutRoot`/`claimed_bitmap`）——V-T-8 已知触发形状。按 ledger 1172/1173 处置不变（根因未定位，NWT 已
排除体积假说，一律 AB11+实测），本文件从一开始就用 AB11，不依赖任何"实测偶然未崩"的侥幸。

- `OWN_PREFIX_LEN=1`，`OWN_STATE_LEN=96`（8 字段：7 个 int + 1 个 byte32，
  `7×9(int tag+payload) + 1×33(byte32 tag+payload) = 63+33=96`，理论计算与
  `measure_rootclaim_state_span.mjs` 实测完全吻合，0 漂移，见 `measure_output.json`）。
- 复用（未改动）`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/measure_payoutshard_state_span.mjs`
  （参数化脚本，接受 `SIL`/`CTOR`/`OUT` 三个 argv）。

## 授权链表（ledger 1172/1183，两操作数各自要证非零来源）

| # | 比较 | 左操作数来源 | 右操作数来源 | 独立非零证明 |
|---|---|---|---|---|
| 1 | `heldTk.owner == OpInputCovenantId(this.activeInputIndex)`（H1 在场） | `heldTk.owner`：State 字段，由上一次创建/续约该代币的入口写入，引用 `this.activeInputIndex`（恒安全类别） | `OpInputCovenantId(this.activeInputIndex)`：本次调用现场读取，同一恒安全类别 | 两侧都是"引用 `this.activeInputIndex`"，不需要额外 `!=ZERO32`；本文件写 `TokenState.owner` 的地方（`tokenOutIdx`/`remainTokenOutIdx`）全部引用 `this.activeInputIndex` 或已核过的 `claimCovId`，链条闭合 |
| 2 | `require(claimCovId != ZERO32)` | `claimCovId = OpOutputCovenantId(claimOutIdx)`：本次调用现场读取一个非 `this.activeInputIndex` 的下标 | 常量 `ZERO32` | **独立证明本身**——不能靠紧接着的 `claim_tmpl_hash` 模板核对代付（1173 教训：脚本字节匹配 ≠ covenant 绑定，两条各自独立承重） |
| 3 | `validateOutputStateWithTemplate(claimOutIdx, ClaimState{...}, ...)` | `claim_tmpl_hash`：ctor 烤值，genesis 时由创建本 `RootClaim` 实例的上游（`RootClose.convert_to_claim`）供入 | witness 现场 `claim_prefix`/`claim_suffix` 的 blake3 | 走 P13 形；`claim_tmpl_hash` 本身缺 ctor 端 `!=ZERO32` 显式断言（同 CloseZkV2 README 记录的未覆盖点，跨文件一致，不单独重复论证） |
| 4 | `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner: claimCovId,...}, ...)` | `claimCovId`：已经过第 2 条 `!=ZERO32` 核对的值 | — | 复用第 2 条，非新的独立比较 |
| 5 | `require(cur == payoutRoot)` | witness 供的 merkle 路径折叠值 | `payoutRoot`（State 字段，`RootClose.convert_to_claim` 写入） | 内容 hash 相等检查，不是 covenant/owner 授权比较，不在 1172 扩宽规则适用范围内 |

## §2 表"covenant 绑定"列（ledger 1173/1176 定义：尾匹配/模板匹配 ≠ covenant 绑定，两层各自独立承重）

`RootClaim.claim_draw` 的 `claimCovId != ZERO32`（表中"covenant 绑定"列）：✅ 已加（本次落码）。

## 向量（`run.log`，6/6 PASS，2 条关键负向量交互步进精确定位失败行）

| 向量 | 验证点 | 真实失败行 |
|---|---|---|
| `V-RCL-TOK-1_pass_partial_with_remainder` | pass：部分派彩，代币剩余量续给本合约 + bookkeeping 续约（AB11） | — |
| `V-RCL-TOK-2_pass_exact_no_remainder` | pass：恰好清零，无代币剩余续约、无 bookkeeping 续约 | — |
| `V-RCL-TOK-3_fail_destination_not_real_claim_template` | fail：新建输出不是真编译的 `KanetTokenClaim` 字节 | `validateOutputStateWithTemplate` |
| `V-RCL-TOK-4_fail_token_owner_diverted_to_stranger`（V-outbind 形） | fail：代币输出 owner 被导向陌生人而非真 claim covenant | `validateOutputStateWithInputTemplate` |
| `V-RCL-TOK-5_fail_witness_wrong_tok_prefix` | fail：代币模板 witness 错，blake3 现场核不过 | `token_tmpl_hash` blake3 核对 |
| `V-RCL-TOK-6_fail_witness_wrong_claim_prefix` | fail：claim 模板 witness 错，blake3 现场核不过 | `claim_tmpl_hash` blake3 核对 |

## 已知后续依赖（不在本次范围内）

`RootClose.convert_to_claim` 目前仍按旧的 10-参数 `RootClaim` ctor 构造新实例，需要跟进新增的三个
ctor 字段——这是 Bettor 排的④批次（RootClose/ShardLeaf/ShardLeaf_direct）范围，本次不动 `RootClose.sil`。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
