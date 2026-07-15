> **Status**: DRAFT — 备稿,是否/如何对外提交由 Owner 定夺(本稿不构成已提交意见)

# KCC20 两个窄意见起草 — 供 Owner 终裁是否/如何提交

**作者**: J1tn · 2026-07-16 · Owner 指令派工 `3d9f7bee`（KCC20 PR#2, Draft, github.com/kaspanet/kccs/pull/2）
**方法**: 已完整取得 PR#2 当前 diff 正文（非转述/非猜测），逐条对照条款引用，不针对我没读到的内容发表意见。

---

## 背景：PR 当前正文相关条款（原文引用，供核对）

```text
IDENTIFIER_PUBKEY = 0x00
IDENTIFIER_SCRIPT_HASH = 0x01
IDENTIFIER_COVENANT_ID = 0x02
```

> Every KCC20 covenant state must begin with the following fields, in this order:
> `owner_identifier: bytes32`, `identifier_type: byte`, `amount: integer`, `extended_state_digest: bytes32`

Borrowed Receive Extension v1（对每个被 borrow 的输入位置 `i` 强制要求）：

> - `next_states[i]` exists;
> - `owner_identifier` is unchanged;
> - `identifier_type` is unchanged;
> - `extended_state_digest` is unchanged;
> - `next_states[i].amount > prev_states[i].amount`; and
> - the successor output's KAS value is greater than or equal to the consumed input's KAS value.
>
> The borrowed input is exempt only from its normal owner authorization. `signatures[i]` remains
> positionally present but is not verified for that input.

Descriptor 定义：

> `prefix` and `suffix` are the covenant script bytes before and after its mutable state.
> Together they identify the token covenant template... The descriptor must be published so
> tooling can identify the covenant, decode its state, reconstruct its outputs...

**核实结论（读原文后确认，非推测）**：
1. Borrowed Receive 的四个"unchanged"约束（owner/type/digest 不变）**对三种 `identifier_type` 一视同仁**，条款文本没有对 `IDENTIFIER_COVENANT_ID` 做任何区分处理或排除。
2. Descriptor 一节**没有出现**任何"prefix/suffix 必须来自版本化编译产物"或"必须能 round-trip 重建实际部署的 genesis P2SH"这类要求——只说明它们的作用是"identify the covenant template"，未规定其来源可信度或可验证性。

---

## 意见一：`identifier_type == IDENTIFIER_COVENANT_ID` 时 Borrowed Receive 应默认拒绝，仅经显式机器可读 opt-in 才允许

**问题**：Borrowed Receive 让任何人消费一个已存在的、attester 未授权的 token UTXO 并原地重建（`amount` 只增不减、KAS 值不减、owner/type/extended-state-digest 不变）。设计意图很清楚是为了省一次"新建 UTXO + 充值 KAS"的便利性，对 `IDENTIFIER_PUBKEY`/`IDENTIFIER_SCRIPT_HASH` 这类"被动持币方"场景是合理的（余额只增，没有资产损失面）。

但当 `owner_identifier` 指向的是一个 **covenant actor**（`IDENTIFIER_COVENANT_ID`）时，这个 UTXO 不只是"余额"，它本身可能是另一个协议状态机（比如结算池/托管合约/时间锁 escrow）在链上的**身份锚点**——依赖它的 outpoint 保持稳定的东西包括：
- 已经构造好、指向这个具体 outpoint 的后续交易模板（尚未广播的 pending tx）；
- 依赖该 outpoint 做索引/watcher 的链下组件；
- 任何把这个 outpoint 写进自己状态、用于验证"这笔钱还在原地"的逻辑（例如超时退款/escape path 判断某个资金是否仍托管在该 covenant）。

Borrowed Receive 触发后，这个 outpoint **消失并被替换成一个新 outpoint**（`amount` 变了，UTXO 天然是新的）——即使 `owner_identifier`/`identifier_type`/`extended_state_digest` 三个字段值不变，**这不代表对依赖旧 outpoint 的外部逻辑而言"什么都没变"**。资金没有被偷（金额只增、所有权不变），但任何绑定了具体 outpoint 的活性假设都可能被打断——这是一种"资金安全但活性可被第三方任意触发中断"的攻击面，且触发门槛极低（任何人构造一笔含该 witness 的 tx 即可，不需要拿到 covenant 的任何授权）。

**意见**：当 `identifier_type == IDENTIFIER_COVENANT_ID` 时，Borrowed Receive **默认拒绝**；只有该 covenant 在其模板/descriptor 里显式声明一个机器可读的 opt-in 标记（例如在 `kcc20_extensions` 里额外声明一个诸如 `borrowed_receive_covenant_owner_opt_in` 的子标记，或者在 covenant 自己的转移规则里追加一条允许该 witness 的分支）时才允许。理由：`IDENTIFIER_PUBKEY`/`IDENTIFIER_SCRIPT_HASH` 场景下"被动持币方"没有自己的状态机逻辑会被 outpoint 变化打断，默认允许是合理的效率优化；但 covenant actor 有自己的状态机语义，"默认允许"把"这个 covenant 是否在意 outpoint 稳定性"这个判断权从 covenant 自己手上拿走了，应该反过来由 covenant 自己显式声明"我不在意，可以借用"。

## 意见二：Descriptor 的 `prefix`/`suffix` 必须来自版本化编译产物，且发布前须完成 round-trip 重建实际部署 genesis P2SH 的验证

**问题**：Descriptor 目前的定义只说 `prefix`/`suffix` "identify the covenant template"，没有规定这两个字节序列本身的可信来源。任何第三方 reader/wallet/indexer 要正确解码一个 KCC20 covenant 的状态、构造合法的 transfer，都要依赖这份 descriptor 与链上实际部署的字节码一致——如果 descriptor 是手工誊抄/记忆维护而非直接从编译产物导出，两者随时间推移出现不同步（编译器升级、模板参数微调）而没人发现，是完全可能发生的。

**我们自己刚撞过这个坑，作为具体证据**：KANet 内部一个类似性质的配对常量（ZK guest circuit 的 `imageId` 与其配对的 `gateTmplHash`，语义上等价于"编译产物的身份标识"与"从该产物派生的承诺值"这对关系）在一次 guest circuit 版本升级时，`imageId` 改了但配对的 `gateTmplHash` 没有同步重算，潜伏了一天多才在真正触发链上校验时炸出来（团队内部编号 D-009）。root cause 与本意见担心的场景结构相同：**一个理应从编译产物确定性派生的值，被当作独立维护的手工常量，两者脱钩不会立刻报错，只在真正触发校验路径时才现形**。KCC1（状态编码 ABI 标准）如果最终定稿，理论上能根治这类问题，但 KCC1 目前还不存在，KCC20 现在就在规定 descriptor，不该重复这个坑。

**意见**：Descriptor 的 `prefix`/`suffix` 应要求（a）来自版本化的编译产物（不是可以手工填的自由字段），（b）发布前必须完成一次 round-trip 验证——即用该 descriptor 重建出的 P2SH 脚本哈希，必须与链上实际部署使用的 genesis P2SH 逐字节一致，这个验证步骤本身应该是规范里要求的最小合规证据之一（可以类比 Economic Kernel 里 "No successful transition, no live protocol claim" 这条精神——没有 round-trip 自证过的 descriptor，不该被 tooling 信任）。

---

## 待 NWT 红队 / Owner 定夺

1. 两条意见的技术论证是否站得住，需要独立复核（我读的是当前 diff，PR 可能在红队期间继续更新，提交前建议重新对照最新版本）。
2. 是否/以何种身份/何种措辞对外提交这两条意见，是 Owner 权限，本稿只是"技术论证已经站得住脚"层面的备稿，不代表已经对外发声。
3. 意见一的具体 opt-in 机制命名（`kcc20_extensions` 追加子标记 vs covenant 自己模板里加分支）只是举例说明思路，不是最终提案格式，若要提交需要再打磨成 PR 评论惯用的措辞和格式。
