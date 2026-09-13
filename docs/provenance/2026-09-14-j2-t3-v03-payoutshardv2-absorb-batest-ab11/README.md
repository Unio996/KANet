# PayoutShardV2.sil — T3 v0.3 §2/§3 代币化落码(absorb AB11+P13 + close/cancel_attest B 类, 1122 边界)

Bettor ledger 1156/1160/1163: KanetTokenClaim ZERO32 → T1 v0.7 → **PayoutShardV2**(本次)→ RefundClaim 三步 →
其余，一律照 P13 witness+blake3 形，一次带齐边界向量。本文件与 `docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/`（PayoutShard.sil 的同类工作）逐条对照，方法论完全一致——不同点只在 State 字段数
（PayoutShardV2 是 24 字段，比 PayoutShard.sil 多 `attestedWinner`/`attestedAtMs`/`betsRootBaked`/`refundRootBaked`
四个 ZK-native 结算字段）。

## 改了什么

- ctor 新增 `byte[32] token_tmpl_hash`（27→28 参数），紧跟 `closeZkTmplAnchor` 之后，位置与 PayoutShard.sil 的
  `token_tmpl_hash` 相对 `predicate_commit` 的位置同构。**没有**烤 `token_prefix`/`token_suffix`（一开始就用
  1151 裁定后的正确 P13 形，不是先错后改——这次没有重复 J2 早前在 PayoutShard.sil 上的 blake3 误判）。
- 新增 `TokenState` struct + `TOKEN_SCHEME_COVENANT_ID`/`TOKEN_BORROW_DISABLED`/`MAX_INS_SCAN`/`DUST_MIN`/
  `OWN_PREFIX_LEN`/`OWN_STATE_LEN` 六个常量，与 `scanOwnedTokenInputs`/`noTokenInput` 两个 helper——逐字复制
  PayoutShard.sil 的实现（同一 P13 witness+blake3 形，同一 1122 长度闸+展开深度同常量纪律）。
- `absorb`：语义从"归集 `tx.inputs[shardInIdx].value`（裸 KAS）"改成"归集一枚代币输入的 `amount`"，签名新增
  `tok_out`/`shard_amount`/`tok_prefix`/`tok_suffix`。`scanOwnedTokenInputs()==consolidated_pool` 输入侧闸 +
  `validateOutputStateWithInputTemplate` 代币续约 owner 派生绑定（`OpInputCovenantId(this.activeInputIndex)`，
  不是裸 witness）+ AB11 手写自续约（见下）。
- `close_attest`/`cancel_attest`：委员 ①②③ 逻辑**一字不动**（REGRESSION-safe，与文件头注释既有纪律一致），
  各自新增 `tok_prefix`/`tok_suffix` 两个 witness 参数 + `require(noTokenInput(tok_prefix, tok_suffix))`（B 类
  不在场证明，紧跟 `closed==0` 检查之后）；KAS weld 从 `== consolidated_pool`（精确等于代币化前的裸 KAS
  语义）改成 `>= DUST_MIN`（同 PayoutShard.sil：这两个入口不动代币，KAS 只是 dust）。
- `refund_claim` / `zk_handoff`：**本次不改**，源码里留了一段显式注释说明范围决定，见下"范围决定"一节——
  这不是漏做，是不在 Bettor 1156/1160/1163 这批指派范围内，且贸然改会是猜测设计。

## AB11 自续约：24 字段编码表

`absorb` 同时需要 `readInputStateWithTemplate`（读 shard 代币状态）和自续本合约 State——这个组合触发 V-T-8
（`docs/provenance/2026-09-14-j2-vt8-read-external-plus-self-continue-probe/`），改用 AB11 手写编码绕过
`validateOutputState`。字段顺序 = ctor 声明顺序（`consolidated_pool, closed, payoutRoot, w0..w16,
attestedWinner, attestedAtMs, betsRootBaked, refundRootBaked`）：

| # | 字段 | 类型 | tag 字节 | payload 长度 | 编码表达式 |
|---|---|---|---|---|---|
| 1 | consolidated_pool | int | `0x08` | 8 | `8 as byte[1] + (consolidated_pool+shard_amount) as byte[8]` |
| 2 | closed | int | `0x08` | 8 | `8 as byte[1] + closed as byte[8]` |
| 3 | payoutRoot | byte[32] | `0x20` | 32 | `32 as byte[1] + payoutRoot` |
| 4-20 | w0..w16(17个) | int×17 | `0x08`×17 | 8×17 | 逐个 `8 as byte[1] + wN as byte[8]` |
| 21 | attestedWinner | int | `0x08` | 8 | `8 as byte[1] + attestedWinner as byte[8]` |
| 22 | attestedAtMs | int | `0x08` | 8 | `8 as byte[1] + attestedAtMs as byte[8]` |
| 23 | betsRootBaked | byte[32] | `0x20` | 32 | `32 as byte[1] + betsRootBaked` |
| 24 | refundRootBaked | byte[32] | `0x20` | 32 | `32 as byte[1] + refundRootBaked` |

总字节数 = 21×9(int) + 3×33(byte32) = 189+99 = **288** = `OWN_STATE_LEN`（理论计算与量测脚本实测完全吻合，
见下，不是巧合对上——两条独立路径互相印证）。`OWN_PREFIX_LEN=1`（同 PayoutShard.sil，编译产物起始固定 1 字节
opcode 前缀不受 State 字段数影响）。

## 量测脚本 + 漂移检测

复用（无需改动）`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/measure_payoutshard_state_span.mjs`
（原脚本本就是参数化的，接受 `SIL`/`CTOR`/`OUT` 三个 argv，不是 PayoutShard.sil 写死的），跑在 PayoutShardV2.sil
+ 本目录 `PayoutShardV2_v03.ctor.json` 上：

```
measured: { own_prefix_len: 1, own_state_len: 288, own_suffix_len: 19045, bytecode_length: 19334 }
declared: { own_prefix_len: 1, own_state_len: 288 }
OK: no drift, hardcoded constants match the actual compiled artifact.
```

见 `measure_output.json`。0 漂移。

## 向量：`absorb.run.log`（13/13 PASS）

沿用 PayoutShard.sil 的 9 条向量原班形状（1 结构一致，逐条见 `mk_payoutshardv2_v03_absorb_vectors.mjs` 注释），
新增 2 条 PayoutShardV2 特有的"非 amount 字段写错"负向量（覆盖 4 个新字段中的 2 个——`attestedAtMs`/
`refundRootBaked` — 连同沿用的 `closed`/`payoutRoot`/`w5` 三个共有字段，一共验证了 5 个不同字段位置的编码，
含 24 字段表的头/中/尾三个区段，不是只测了共有的 20 个）：

| 向量 | 验证点 |
|---|---|
| `V-absorbV2-1` | pass：已持仓 100 + 新纳入 shard 50 → 150，dust weld |
| `V-absorbV2-2` | fail：夹带第二枚归己代币（30）未被计入 `scanOwnedTokenInputs`（应算 130≠100） |
| `V-absorbV2-3` | pass：同模板陌生人代币在场，合法不计入 |
| `V-absorbV2-4`（**T3 v0.3/1127① "V-outbind" 族同构**） | fail：输出侧代币续约 owner 被导向陌生人 covenant |
| `V-absorbV2-5` | fail：输出代币金额被篡改 |
| `V-absorbV2-6` | fail：自续约 KAS 值低于 `DUST_MIN` |
| `V-absorbV2-7` | fail：自续约 `closed` 字段写错（共有字段） |
| `V-absorbV2-8` | fail：自续约 `payoutRoot` 字段写错（共有字段，byte32） |
| `V-absorbV2-9` | fail：自续约 `w5` 字段写错（共有字段，17 元数组深处） |
| `V-absorbV2-10/11` | fail：witness 供错 `tok_prefix`/`tok_suffix`，blake3 现场核不过 |
| `V-absorbV2-12`（**PayoutShardV2 特有字段**） | fail：自续约 `attestedAtMs` 字段写错 |
| `V-absorbV2-13`（**PayoutShardV2 特有字段**） | fail：自续约 `refundRootBaked` 字段写错（struct 最后一个字段——证编码表尾部没有截断/错位） |

**验证方法**：与 PayoutShard.sil 完全同构——每条"字段写错"负向量的输出脚本是用同一份 `compilePSV2()`
辅助函数编译出的、**只有该一个字段不同**的真实合约实例，唯一能导致哈希比对失败的差异点就是那一个字段。这个
结构性论证继承自已经过 NWT GREEN 复核的 PayoutShard.sil 同款证据（`edc8b959`→`5a0e2729`），机制完全相同，
本次不重新做逐行交互步进（复用已验证的证据形状，不是省略验证）。

## 向量：`battest.run.log`（12/12 PASS）

`close_attest`/`cancel_attest` 各 6 条，与 PayoutShard.sil 的 `close_attest`/`cancel_attest` 逐条同构（no-token
sig-gate 对照 / token-present 拒绝 / 1122 三个边界点 at-bound·bound+1·victim-at-index-7 / witness 错
prefix 负向量）。`close_attest` 的 witness 数组比 PayoutShard.sil 多 4 个（`new_attestedWinner`/
`new_betsRoot`/`new_refundRoot`/`new_attestedAtMs`），委员签名/merkle 部分**逐字节复用零值占位**（同项目
既有惯例：委员逻辑本次不改，向量只需要证明它在 `noTokenInput`/长度闸之后才被触达即可，不需要真实有效签名）。

| 向量 | 入口 | 验证点 |
|---|---|---|
| `V-close_attestV2-1` | close_attest | 无代币在场 → `noTokenInput` 放行 → 落到签名门限拒 |
| `V-close_attestV2-2` | close_attest | 代币在场 → `noTokenInput` 结构性拒绝，不到签名门限 |
| `V-close_attestV2-3` | close_attest | 恰好 8 输入（边界）无代币 → 放行到签名门限 |
| `V-close_attestV2-4` | close_attest | 9 输入（边界+1）→ 长度闸单独拦下 |
| `V-close_attestV2-5` | close_attest | 代币在下标 7（8 输入内最后可达位置）→ 必须抓到 |
| `V-close_attestV2-6` | close_attest | witness `tok_prefix` 错 → blake3 现场核不过 |
| `V-cancel_attestV2-1..6` | cancel_attest | 与 close_attestV2 逐条镜像 |

## 范围决定（本次不改 `refund_claim` / `zk_handoff`，如实记录）

1. **`refund_claim`**：跟 `PayoutShard.sil` 的 `claim`/`refund_claim` 是同一族——真实把价值付给赢家/退款人。
   按 ledger 1136 既定顺序，这一族要等 `KanetTokenClaim.sil` 拿到 NWT GREEN 后，才统一改成"目的地重定向到
   新铸 `KanetTokenClaim` 实例"这个形状。现在动它会是在猜测该重定向具体长什么样（`KanetTokenClaim` 的
   `spend` 入口设计还在 NWT 复核循环里，刚出了一版 ZERO32 MUST-FIX），违反"先计划再编码"。源码里留了显式
   注释标注这个决定，方便下一个接手的人（含未来的我自己）一眼看到范围边界，不会误读成"漏做"。
2. **`zk_handoff`**：把 `consolidated_pool` 整体"交接"给新铸的 `CloseZkRepro4` genesis output——但 D-017
   之后 `consolidated_pool` 语义已经是代币 amount 而非裸 KAS sompi，这意味着 `zk_handoff` **可能也需要真实
   的代币 owner 转移**（而不只是现在这样的 KAS 侧数值/脚本哈希匹配），即 `CloseZkRepro4` 是否也要变成"持有
   代币的 covenant"是一个需要 Owner/Bettor 定的架构问题（跟 ZK track 本身的进度也有关），不是本次
   tokenization 落码可以顺手替它决定的。留白，向 Bettor/NWT 明确报告，等指示。

## MANIFEST

见 `MANIFEST.sha256`（n/n 文件计数核对）。
