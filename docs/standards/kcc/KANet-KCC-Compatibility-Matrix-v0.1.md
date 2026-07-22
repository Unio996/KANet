# KANet × KCC 兼容矩阵与迁移边界 v0.1

**日期：** 2026-07-17  
**状态：** 内部工作稿，可作为公开贡献前的工程基线  
**规范快照：** KCC20 a6e2fc254b6148c28ce763f129fcc0fa4a0cf877；KCC1 55b28d86b4acd6f40b4596c8eff930f84ef96d91  
**KANet 证据快照：** eab2ebbc0d0b87a4644617b4f5e5e24030eac396  
**目标：** 让 KANet 从“跟随标准”升级为“用可复现实证帮助标准成熟”，同时不破坏任何已经部署的历史合约语义。

## 1. 当前判断

KANet 与 KCC 的关系，不应只是“等标准定稿后适配”。更有价值的定位是：

1. **标准早期采用者：** 对 KCC1、KCC20 建立版本化兼容层。
2. **实证测试场：** 把真实结算、退款、争议、多输入 covenant、升级和退出流程提炼为可复现测试向量。
3. **独立验证者：** 用与编译器和部署器分离的 verifier 检查 ABI、模板、状态和交易证据。
4. **后续规范贡献者：** 只把经过多实现验证、可脱离 KANet 独立成立的约定提炼为 KCC 候选。

这比立即提交一个“KANet 标准”更稳健。KCC 是独立实现之间的生态约定，不是项目说明书；真正有分量的贡献是：明确边界、发现歧义、提供向量、证明互操作。

## 2. 上游最新状态

| 草案 | 当前状态 | 与 KANet 的直接关系 |
|---|---|---|
| [KCC-0001 PR #3](https://github.com/kaspanet/kccs/pull/3) | Draft；定义 covenant 概念、值编码、Program ABI、入口分发、P2SH envelope、状态模板、Covenant ID 角色、virtual elements 与一致性向量 | 是 KANet 新一代 covenant ABI 与工件验证的基础 |
| [KCC-0020 PR #2](https://github.com/kaspanet/kccs/pull/2) | Draft；定义可替代 token covenant、State、transfer、descriptor 与 Borrowed Receive 扩展 | 与 KANet 的 broker、资产化权益、covenant-owned state 和经济内核边界直接相交 |

## 3. 兼容矩阵

“一致”表示已经有明确实现证据；“概念一致”表示模型相近但尚未完成逐字节证明；“不兼容”表示不能用同一 profile 解释；“待证”表示必须生成向量再下结论。

| 范围 | KCC1 / KCC20 草案要求 | KANet 当前实现证据 | 判定 | 动作 |
|---|---|---|---|---|
| 值 ABI | 调用参数使用 PushMinimal；状态字段使用 PushExplicit；int 状态载荷为 8 字节小端 signed-magnitude | silverc 工件和 builder 已有稳定状态布局，但尚未完成全部边界值的独立逐字节核验 | 待证 | 生成 int、bool、bytes、数组和 record 的正反向量 |
| 单入口分发 | 恰好一个入口时可省略 dispatch tag | KANet 存在 without_selector=true、state.start=0 的单入口合约 | 概念一致 | 选取最小合约生成 KCC1 正向量 |
| 多入口分发 | dispatch_tag = Hash(FunctionSignature)[0:4] | 当前多入口 covenant 普遍使用 OP_0、OP_1、OP_2 等位置选择器 | **不兼容** | 历史 profile 保留；新 KCC1 profile 使用 4 字节标签 |
| P2SH 调用封装 | 参数、可选 dispatch tag、最后推入 redeem script | KANet builder 采用参数 / selector / redeem script 的 P2SH 调用结构 | 概念一致 | 对 final redeem push、最小推入和多入口标签做字节验证 |
| 状态窗口 | Program ABI 明确 state.start 与 state.len；字段顺序和编码固定 | silverc 工件暴露 state_layout；KANet 可从完整 redeem script 切分 prefix / state / suffix | 高度一致 | 输出 Program ABI 映射与 round-trip 向量 |
| 模板哈希 | Hash(LE64(len(prefix)) || prefix || LE64(len(suffix)) || suffix) | 当前实现广泛使用 Hash(prefix || suffix) | **不兼容** | 定义 legacy 与 kcc1 两种算法 ID；禁止静默替换 |
| 模板视图 | 可对部分状态字段构造和认证 template view | CloseZk 等流程已有“固定模板 + 可变状态字段”的相似结构 | 概念一致 | 生成一个可变字段与一个越界篡改的正反向量 |
| 延续输出认证 | same-template 延续必须认证模板；跨模板转移必须有授权规则 | KANet 的注册、封存、退款、结算流程已认证 continuation；部分流程显式携带目标 prefix / suffix 与模板哈希 | 高度一致 | 提炼同模板与授权换模板两组向量 |
| Covenant ID lineage | 同 ID 多输入区分 leader 与 delegator；leader 负责全局转移，delegator 做本地安全检查 | KANet shard / spine / payout 已有多输入聚合和角色分工 | 概念一致 | 构造覆盖 cardinality、重复、遗漏和错误 leader 的负向量 |
| Virtual elements | 对承诺值提供 opening；更新时验证旧 opening 和新承诺 | KANet 的 predicate root、payout root、image / template 承诺可映射到该模型 | 概念一致 | 先选择一个最小承诺，不把完整经济内核塞入 KCC1 |
| KCC20 State ABI | KCC20 使用 State[]、sig[]、byte[]，但 record 的精确规范需与 KCC1 联锁 | KCC1 中 record 名称和参数类型会直接影响函数签名与 4 字节分发标签 | **跨规范缺口** | 建议 KCC20 定义规范 record 名、字段类型、顺序，并规范引用 KCC1 |
| KCC20 descriptor | prefix、suffix、扩展状态布局、扩展 ID | 与 KCC1 Program ABI / template 已产生重叠的事实来源 | **跨规范缺口** | descriptor 应引用或嵌入 KCC1 Program ABI，避免两套状态与模板真相 |
| Borrowed Receive | 允许无需普通所有者授权向既有 state 增加 token amount | 对 covenant-owned state，外部输入可能改变 amount 和 outpoint，破坏储备、定价或 outpoint 绑定不变量 | **安全缺口** | identifier_type=0x02 默认拒绝，除非存在标准化、机器可读、逐 state opt-in |

## 4. 必须固定的历史兼容边界

### 4.1 模板哈希不是可原地升级的实现细节

KANet 现有历史算法：

    legacy_template_hash_v0 = Hash(prefix || suffix)

KCC1 草案算法：

    kcc1_template_hash_v1 =
      Hash(LE64(len(prefix)) || prefix || LE64(len(suffix)) || suffix)

两者必须拥有不同的 algorithm / profile ID。任何验证器都不得仅根据 32 字节值猜测算法，也不得把历史状态中的模板哈希重新解释为 KCC1 哈希。

### 4.2 入口选择器也不是可原地升级的字节

KANet 历史多入口合约以位置选择器分发；KCC1 以函数规范签名的哈希前四字节分发。新编译器或 adapter 可以同时“理解”两者，但一次具体调用必须被明确绑定到唯一 profile。

### 4.3 推荐 profile

| Profile | 模板哈希 | 多入口分发 | 用途 |
|---|---|---|---|
| kanet-legacy-v0 | Hash(prefix || suffix) | positional selector | 验证和继续执行历史部署 |
| kcc1-draft-2026-07 | KCC1 长度绑定哈希 | 4-byte signature tag | 新实验部署与 KCC1 向量 |
| future-kcc1-final | 最终 KCC1 指定算法 | 最终 KCC1 ABI | KCC1 Accepted 后的新生产部署 |

草案 profile 必须带版本或 commit pin；KCC1 未 Accepted 前，不应把“跟随当前草案”宣传为永久兼容。

## 5. KANet 的实证贡献流水线

真实 KANet 合约与交易 → 去项目化最小案例 → 规范化向量包 → 独立 verifier → 跨实现复现 → PR 审查意见或 KCC 候选。

每个向量至少包含：

- 被测 KCC 版本、commit 与章节；
- 编译器 / 工件版本和源代码摘要；
- Program ABI、redeem script、signature script、相关输入输出；
- 预期模板哈希、dispatch tag、状态解码结果；
- 明确的 expected accept / reject；
- 一个与正向量只差一个条件的最小负向量；
- 可由第二套实现离线复算的完整字节。

## 6. 第一批贡献顺序

### P0：立即参与草案收敛

1. 向 KCC20 提出与 KCC1 的规范联锁：精确 State record、规范类型、入口签名和 descriptor 单一事实来源。
2. 对 Borrowed Receive 的 covenant-owned state 提出默认拒绝 + 显式 opt-in。
3. 向 KCC1 提交 KANet 提炼的兼容 / 不兼容向量，尤其是模板边界与 dispatch 迁移。

### P1：建立自动一致性测试

1. silverc 工件导出器：产生 KCC1 Program ABI 和向量 manifest。
2. 独立 verifier：不得复用编译器内部解析结果作为唯一证据。
3. landed-transaction reader：从链上交易重新提取 sigscript、redeem script、state 与 continuation。
4. CI：每次编译器、builder 或规范 profile 变更都重放正反向量。

### P2：从实证中提炼后续 KCC

只有在存在至少两个独立实现后，再考虑：

- Economic Agreement Descriptor：经济协议条款、承诺根、可验证出口；
- Broker Attribution and Fee Convention：发现 / 路由归因与可验证收费；
- Trust Profile and Exit Manifest：预言机、verifier、挑战窗口与退出路径的机器可读表达。

这些主题应保持“协议可互操作性”，而不是把 KANet 的产品架构直接标准化。

## 7. 标准化成熟度闸门

一项 KANet 约定只有同时满足以下条件，才适合提炼成 KCC：

1. **独立性：** 不依赖 KANet 品牌、域名、中心服务或私有数据库。
2. **多实现：** 至少两个独立代码库能产生或验证相同字节结果。
3. **确定性：** 有规范化正向量与最小负向量。
4. **链上证据：** 至少有一次真实测试网生命周期覆盖创建、正常延续、结算 / 退款 / 退出。
5. **边界明确：** 清楚区分 consensus、convention、产品策略和运营参数。
6. **迁移安全：** 能识别版本，且不会静默重新解释历史合约。
7. **失败可恢复：** 对 oracle、indexer、broker 或 verifier 缺失时的行为有确定描述。

## 8. 结论

KANet 最有价值的角色不是抢先宣布“我们的架构就是标准”，而是成为 KCC 生态里最严格的实证者之一：

- 用真实复杂度发现草案中容易被最小示例掩盖的边界；
- 用独立 verifier 把“相信编译器”变成“验证字节”；
- 用历史 profile 证明标准迁移可以不牺牲已部署合约；
- 等约定通过多实现检验后，再把真正普适的经济协议接口提交为下一批 KCC。

这条路线既保护 KANet 的先发工程资产，也能让项目对 Kaspa 标准形成可衡量、可复现、可引用的贡献。
