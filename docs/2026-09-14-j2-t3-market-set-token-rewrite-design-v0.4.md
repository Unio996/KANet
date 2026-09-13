# T3 · 增补稿 v0.4（RefundClaim 收口为 8 合约 + V-T-8/AB11 绕路形记档）

> **Status**: DRAFT-FOR-REVIEW v0.4（2026-09-14 · J2 · 承接 v0.3，只增补两节，不改动 v0.3 已有内容）

## 1. RefundClaim 纳入封闭集合，8 合约（Codex 抓 + Bettor 1138/1139 裁）

v0.3 §1 的 7 合约封闭清单遗漏 `RefundClaim.sil`：`RootClose.convert_to_refundclaim`（A 类）的
`tok_out owner` 是本笔新建的 RefundClaim covenant；`RefundClaim.sil` 自身有 `refund_payout` 自续 draw-down
入口——**只要这条入口可达，RefundClaim 就是持币合约，不能排除在完备清单之外**（可达性决定封闭性，不是文档
状态标注"未定"就能免责）。NWT 扫可达图确认 8 文件收敛（RefundClaim 之后不再向下绑定新合约）。

**v0.3 §1 表改为 8 行**：

| # | 文件 | 是否持币 | 角色 |
|---|---|---|---|
| 1–7 | （同 v0.3 §1，不变） | | |
| 8 | `RefundClaim.sil` | 是 | 取消盘退款串行 draw-down（经 `RootClose.convert_to_refundclaim` 创建） |

**v0.3 §2 新增一行（A 类）**：

| 入口 | 类 | RHS | 合法在场不计入? | 输出侧派生绑定 |
|---|---|---|---|---|
| `RefundClaim.refund_payout` | A | `pool_value`（§3.0 分支同 claim/refund_claim/claim_draw 形） | 否 | 领取输出同 PayoutShard.claim 形；剩余续约 owner = 自身 |

**A=16 / B=8，总 24**（v0.3 原 23 + 本次 1）。

**NWT 读 RefundClaim.sil 发现的既有 bug（Bettor 亲核 `:44`/`:63`/`:73`，同 f2fce916 四处 draw-down 同一 bug
形）**：`refund_payout` 现状是无条件续约 + `require(value == pool_value - tk.stake)`，**没有** `remaining==0`
分支——最后一位退款人精确清零 `pool_value` 时会产生 0 值续约输出，被 dust 策略拒，确定性卡死。文件还是
`entrypoint function` 旧语法，从未过 v1.0.0 类型检查。

**RefundClaim 三步计划**（各单独 commit，Bettor 1139 裁）：
1. 纯语法迁移（§7 第 5 文件）：编译通过 + 冒烟向量，同 RootClose/ShardLeaf/ShardLeaf_direct/CloseZkV2 已完成
   的四文件同一套排查（entrypoint→entry / 裸struct→State{} / P2PK宽度 / 两参byte[]cast / tx.time→temporal，
   逐项实查不假设）。
2. `refund_payout` 补 §3.0.1 draw-down 分支（remaining==0⇒无续约；>0⇒恰一续约且金额精确，同 CloseZkV2 原文
   分支形）。向量必须含 `pool_value - tk.stake` 恰好为 0 的边界向量（NWT 会专门打这条，同四处 draw-down
   MUST-FIX 的既有教训）。
3. 代币化落码：`scan==RHS` + 输出派生绑定；现状 P2PK 付 bettor 的那一路，代币化后应改为进领取 covenant
   （与 `claim` 同形，KanetTokenClaim GREEN 之后再排）。

## 2. V-T-8 绕路形（AB11）记档（Bettor 1145(d)）

架构级 silverc 限制（`readInputStateWithTemplate` 读外部状态 + 声明式 `validateOutputState` 续自身 State
同函数内共存运行期必崩，详见 `docs/provenance/2026-09-14-j2-vt8-read-external-plus-self-continue-probe/`）
影响所有"A 类既要读外部代币输入状态、又要续自己 State"的入口——`PayoutShard.absorb` 首次撞上并已用 AB11
手写形绕开（`docs/provenance/2026-09-14-j2-t3-v03-payoutshard-absorb-ab11-and-batest/`），`PayoutShardV2.absorb`
（同形）与未来任何撞到这个组合的入口都要照此手法落码。

**做法摘要**（完整字段编码表见上述 provenance README，不重复）：
1. 不调用 `validateOutputState`；自己按 State 字段声明顺序手写编码字节（`int`=`0x08`+8字节小端，
   `byte[32]`=`0x20`+32字节原样，与 `PayoutShardV2.zk_handoff` 既有手写 `stateBytes` 手法一致）。
2. `OWN_PREFIX_LEN`/`OWN_STATE_LEN` 两个 `int constant`：**不进 ctor**（进 ctor 会撞自指哈希方程
   `hash(...x...)==x`，AB10 已证无可行解），改为编译期常量，按本文件实际编译产物量测后硬编码。
3. 自身 prefix/suffix 直接从 `tx.inputs[this.activeInputIndex].sigScript` 切片借用，不重新验证其真实性
   （因为它就是"正在被消费的、构成本次调用合法性前提的那份输入本身"，同一笔交易内其真实性已经由消费它
   这件事本身保证——跟自己给自己签名同理）。

**维护代价**（如实记录，不是零成本，落码前必须先接受）：
- 每次改动该合约文件的源码结构，或改变 ctor 里任何动态 `byte[]` 字段（如 `token_prefix`/`token_suffix`）的
  **长度**选择，都必须重新编译、重新跑量测脚本（`measure_payoutshard_state_span.mjs` 同款手法）、重新硬编码
  这两个常量——遗漏这一步 = 静默产生错误的 prefix/suffix 切分点，是比"忘记改一处业务逻辑"更隐蔽的坑（编译
  能过，运行期在错误的字节边界切出脏数据，报错信息不会指向"你忘记重新量测常量了"）。
- State 字段列表本身要跟着手写编码同步维护——声明式 `State{...}` 字面量"漏一个字段会在编译期报错"这条
  安全网在手写形式下不存在，加/删/改字段类型必须同时改三处：State 结构体声明、手写编码拼接表达式、
  `OWN_STATE_LEN` 常量。三处任意一处漏改，编译大概率仍然通过（字节对不齐是运行期问题，不是类型错误）。
- **建议**（不是本稿裁定，供 Bettor/NWT 参考）：这类"三处必须同步"的手写形态如果在 T3 全量 24 入口铺开
  面很广，值得评估是否该反过来推动"在 pinned silverc 分支修复 `validateOutputState` 本身"（NWT 正在并行
  定位），而不是让每个受影响入口各自维护一份手写字节表——但这是取舍判断，不是本稿要下的结论。
