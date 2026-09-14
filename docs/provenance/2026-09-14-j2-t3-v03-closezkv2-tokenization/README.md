# CloseZkV2.sil — v0.3 §2/§3 代币化（ledger 1170/1172/1173，zk_handoff+CloseZkV2 联合项之二）

> **RERUN 状态注记(2026-09-15, 账本 1408/1409/1415·f7342a32)**：同 RootClaim.sil——Owner 撤销 H1(b) 后
> "同病同治"删除本文件 ctor 的 `market_suffix_hash` 参数、`ClaimState.market_suffix_hash` 字段、两处
> （`claim`/`escape_claim`）构造字面量各自的那一行（仅四处，逻辑零改动）。用真实生产
> `KanetTestToken.sil`(v0.3方案C)+`KanetTokenClaim.sil`(v0.3, 4字段)+本文件重编译重跑既有 23 条向量
> （part1 B-class 11条 + part2 A-class claim/escape_claim 12条），**23/23 pass**。详见 `part1.run.log`/
> `part2.run.log` 末尾 RERUN 章节。

## 改了什么

- ctor +3（25→28）：`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`，同 PayoutShardV2.sil/
  RefundClaim.sil 三件套，P13 witness+blake3 现场核，无一例外。
- `zk_close`/`escape_trigger`（B 类）：各加 `tok_prefix`/`tok_suffix` witness + `require(noTokenInput(...))`，
  KAS weld 从 `==consolidated_pool` 改 `>=DUST_MIN`。委员/permissionless 逻辑一字不动。
- `claim`/`escape_claim`（A 类）：派彩/退款目的地从裸 P2PK 改成本笔新建的 `KanetTokenClaim` 输出（同
  `RefundClaim.refund_payout` 形状）：读本合约当前持有的代币 → ZERO32 目的地守卫 → 建新 claim（`ClaimState`
  五字段）→ 代币输出转给新 claim → draw-down 分支（`remaining==0` 无续约；`remaining>0` 代币剩余量续给本
  合约自己 + bookkeeping 续约）。merkle membership 逻辑（验 `payoutRootField`/`refundRootBaked`）一字不动。

## V-T-8 处置：AB11（ledger 1172/1173，不是"实测碰运气"）

`claim`/`escape_claim` 的 partial 分支同函数内既有 `readInputStateWithTemplate`（读被消费代币）又需要续
本合约自身 21 字段 State（`attestedWinner`/`closed`/`payoutRootField`/`consolidated_pool`/`w0..w16`）——这
正是 V-T-8 的已知触发形状。**`RefundClaim.refund_payout` 用同一形状的 plain `validateOutputState` 实测
未崩，但 NWT 复核后明确：根因仍未定位，NWT 已排除"编译产物体积"这个假说，处置不变——含这个组合的入口一律
上 AB11 并且实测，不因某一次实测偶然没崩就当安全豁免**。本文件从一开始就用 AB11（不是先试 plain 形式撞见
问题才改），常量测量见下。

- `OWN_PREFIX_LEN=1`，`OWN_STATE_LEN=213`（21 字段：4 个 int/byte32 顶层字段 + 17 个 int，
  `20×9(int tag+payload) + 1×33(byte32 tag+payload) = 213`，理论计算与 `measure_closezkv2_state_span.mjs`
  实测完全吻合，0 漂移，见 `measure_output.json`）。
- 复用（未改动）`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/measure_payoutshard_state_span.mjs`
  （该脚本本就参数化，接受 `SIL`/`CTOR`/`OUT` 三个 argv）。
- **调试踩坑记录**：第一版向量用 `nullifierWords()`辅助函数返回的是 `{w0,...,w16}` 散字段，直接 spread
  进 `czkCtor()` 的 overrides——但 `czkCtor()` 期望的是单个 `w: [...]` 数组参数，散字段被静默忽略，续约
  实例的 nullifier 位全部留 0（该走的那一位没置位）。**这是我自己生成脚本的 bug，不是 `.sil` 代码的问题**
  ——用真实编译产物的 `state_span` 字节逐位反查（`[8,1,...,0x80(sign bit)]` 对应 `attestedWinner=-1` 的
  sign-magnitude 8 字节编码，另建 `NegIntProbe.sil` 直接验证 silverc 的 `int as byte[8]` 用的是
  Bitcoin-Script 式 sign-magnitude 而非二进制补码——这是 AB11 第一次编码负数字段，之前 PayoutShard.sil/
  PayoutShardV2.sil 的字段全是非负值，没撞到这条）才定位到脚本里的这个不对齐，修正后 12/12 全过。

## 授权链表（ledger 1172，Codex 扩宽的 ZERO_HASH 规则：凡承担授权的等值比较，两个操作数各自要证非零来源）

| # | 比较 | 左操作数来源 | 右操作数来源 | 独立非零证明 |
|---|---|---|---|---|
| 1 | `heldTk.owner == OpInputCovenantId(this.activeInputIndex)`（`claim`/`escape_claim`/`zk_handoff` H1 在场） | `heldTk.owner`：State 字段，由**上一次**创建/续约该代币的入口写入（`PayoutShardV2.absorb`/`zk_handoff` 的 `owner: OpInputCovenantId(this.activeInputIndex)`）——写入时引用的是 `this.activeInputIndex`（NWT 1158/1173 规则：恒安全，执行中的 covenant 必然有真实 covenant_id，不可能是未声明的裸值） | `OpInputCovenantId(this.activeInputIndex)`：**本次调用**现场读取，同一条恒安全规则 | 两侧都是"引用 `this.activeInputIndex`"这一恒安全类别，不需要额外 `!=ZERO32`；但**左侧字段的非零性依赖上一次写入者也遵守这条规则**——本文件所有写 `TokenState.owner` 的地方（`claim`/`escape_claim` 的 `remainTokenOutIdx`、`validateOutputStateWithInputTemplate(tokenOutIdx,...)`）全部引用 `this.activeInputIndex` 或已核过的 `claimCovId`，链条闭合 |
| 2 | `require(claimCovId != ZERO32)`（`claim`/`escape_claim` 行 328） | `claimCovId = OpOutputCovenantId(claimOutIdx)`：**本次调用**现场读取一个非 `this.activeInputIndex` 的下标 | 常量 `ZERO32` | **这条本身就是独立非零证明**——`claimOutIdx` 是外部下标，必须显式 `!=ZERO32`，不能靠别的检查代付（1173 教训：模板匹配跟 covenant 绑定是独立的两件事，紧接着的 `claim_tmpl_hash` 模板核对**不能**当作这条的替代证明，两条各自独立承重） |
| 3 | `validateOutputStateWithTemplate(claimOutIdx, ClaimState{...token_tmpl_hash:...}, ...)` 内部核对新建 claim 的编译字节 | `claim_tmpl_hash`：ctor 烤值，genesis 时由创建本 `CloseZkV2` 实例的上游（`PayoutShardV2.zk_handoff`）供入，来源可信度取决于**创建时**是否核对过 | witness 现场 `claim_prefix`/`claim_suffix` 的 blake3 | 走 P13 形，`claim_tmpl_hash` 本身若为 ZERO32（未初始化/被恶意置零）会导致这条检查恒可被"随便什么字节 blake3 出 ZERO32"的攻击者绕过（概率上不可行，blake3 抗原像），但**结构上没有对 `claim_tmpl_hash!=ZERO32` 做显式 ctor 端断言**——留一条待办：见下"未覆盖点" |
| 4 | `validateOutputStateWithInputTemplate(tokenOutIdx, TokenState{owner: claimCovId,...}, ...)` | `claimCovId`：本文件内**已经过第 2 条 `!=ZERO32` 核对**的值 | — | 复用第 2 条的非零证明，不是新的独立比较 |
| 5 | `require(cur == payoutRootField)` / `require(cur == refundRootBaked)`（merkle 根验证） | `cur`：witness 供的 merkle 路径逐层折叠出的值 | `payoutRootField`（State 字段，`zk_close` 写入）/ `refundRootBaked`（ctor 烤值，genesis 时供入） | 这不是 covenant-id 类比较（是内容 hash 相等），不在 1172 扩宽规则的适用范围内（该规则针对"承担授权的 covenant/owner 等值比较"，不是任意 hash 相等检查）——如实排除在表外，不强行套 |

**未覆盖点（如实记录，供 NWT 复核是否要补）**：`claim_tmpl_hash`/`token_tmpl_hash`/`market_suffix_hash`
三个 ctor 值本身都没有 ctor 端 `!=ZERO32` 的显式断言——它们的"非零性"目前只隐式依赖"创建者（`RootClose`/
`PayoutShardV2.zk_handoff`）不会烤一个全零值进去"这个假设，没有代码层面强制。是否需要在 genesis 时加一条
"三个 hash 均非 ZERO32"的构造期断言（无法在 `entry` 里做，只能在**创建者**那一侧加，例如 `zk_handoff` 构造
`stateBytes`/ctor 参数时），是一个需要 Bettor/NWT 定的范围问题，本次不擅自加。

## 向量（`part1.run.log` 11/11 PASS + `part2.run.log` 12/12 PASS，共 23/23）

见两份 run.log。`part2` 里 `V-CZK-CLM-3`/`V-CZK-CLM-4` 已用交互步进逐行确认：`V-CZK-CLM-3`（假 claim 模板）
精确失败于 `validateOutputStateWithTemplate` 那一行，`V-CZK-CLM-4`（owner 改道）精确失败于
`validateOutputStateWithInputTemplate` 那一行，均不是巧合落在别处（该经过的十几条 merkle/H1/witness 检查
全部先通过）。`escape_claim` 系列（`V-CZK-ESC-*`）逐条镜像。

## 已知后续依赖（不在本次范围内）

`RootClose.convert_to_claim`（若未来创建 CloseZkV2 实例走这条路径）/ `PayoutShardV2.zk_handoff`（本联合项
另一半，见同批次 `docs/provenance/2026-09-14-j2-t3-v03-payoutshardv2-zkhandoff-tokenization/`）需要供入
CloseZkV2 新增的三个 ctor 字段。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
