# OP_PICK Codegen Bug — 团队总攻执行方案 v2.1

> **Status**: ARCHIVED（2026-07-07 KANet-UI 补记·D-004 文档硬门）— 本方案执行使命已于 2026-07-06 14:44 完成（见 §9 收官，真实 ZK settle LANDED txId `4ec9ddd1...`），OP_PICK bug 已修复+验证收官，本文档转为历史排查/方法论存档，不再是施工依据。下方 "CURRENT（取代 v2；v2 取代 v1）" 是文档内部 v1/v2/v2.1 版本号语境下的旧标注，保留供追溯。

> **Status**: CURRENT（取代 v2；v2 取代 v1）
> **作者**: Bettor（架构师帽·2026-07-06）· v2 修订合并自 Claude 高级架构审 · v2.1 修订合并自第二轮架构审(A-F 六点)
> **v2.1 修订摘要**: 🔴 **A** §1 顶部加权威横幅，明确根因唯一出处在 §2 Tier1、§1 全文降级为历史排查存档 🔴 **B** 落码前三步核对(§1.5)状态更新为**三步全部完成**，不再是待办 🟠 **C** §5 层2 示例改为"机制推导枚举"表述，不是单点声明 🟠 **D** 候选点状态统一钉死为"deny"(证据:修复后 minrepro+repro3 符号栈自检全绿+写侧 trace 净效应=0) 🟡 **E** 文档阶段声明更新为"落码验证中"，不再是"待设计审" 🟡 **F** Tier0 对照组由"待补"改为"已被消融矩阵取代，不再单独造"
> **根因唯一权威陈述（一句话，其它地方提到的都以此为准）**：`compile.rs:3754`(`compile_byte_sequence_cast_call`) 处理 `byte[](val,size)` 2 参数动态 size 分支时多写一行 `*ctx.stack_depth += 1;`（无对应 opcode emit）。**修复=删这一行**。
> **当前阶段（2026-07-06 13:1x 更新）**：修复已落码+§5层1-3全过+NWT代码审GREEN。**首次真实广播已发生**：流程上跳过了 Bettor 第二个确认点(违规，J2 已认+报，本次不追究)；技术上失败模式从"pick at invalid location"变为"script ran, but verification failed"——**独立证实 OP_PICK bug 确已修好**，当前团队在追一个**新的、独立的**问题(疑似 `ScriptPubKeyP2SH` 构造字节格式跟 gate UTXO 实际 scriptPubKey 不匹配，NWT 定位中)。资金安全，两个测试 UTXO 原封未动。
> **📋 方法论沉淀（第二轮架构审提炼，重要）**："两人独立收敛到同一假设"(J1 定位 alpha-renaming 管线 + J2"这比我假设精确太多"表态认同) ≠ "假设已被验证"——那次"确认"是 **echo**，真正的 **verify** 是随后 J1 自己跑的消融矩阵，直接推翻了这个"双人确认"的结论(真凶另有其处，见 §2 Tier1)。**这是本次排查最值得记入团队方法论/ANTI-PATTERNS 档案的一条**：echo 和 verify 是两个不同证据等级，前者比一人猜测强，但不能当后者用。J1 亲手 deny 自己提出的假设，是值得肯定的科学姿态，不是失败。
> **⬜ 非阻塞待办清单（详见 COORD-LEDGER 对应节，不重复维护两份）**：① offset139 静默取错值 forensic(追溯修复前旧字节码，确认那次"合法" PICK 是否其实取错了值，只是被 offset143 的崩溃挡住没暴露)② Tier1/Tier2 口径校正(见下方 §2 Tier2 状态更新)③ 同族 cast 函数 grep(排除第三处同款 bug)④ minrepro+8 个 iso 变体固化进 cargo test 永久回归集⑤ PoolSpine_v0_7_1.sil live 状态待 KANet-UI 澄清。

---

## 0. 一句话目标

把"13 轮 bisect 靠猜"的模式，换成**可复现、可插桩、可自证**的系统诊断流程；顺带把这次挖出来的调试基础设施**升格为 silverc 永久防线**，不只是修一个 bug。

## 1. 问题画像 — ⚠ 历史排查存档，非施工依据（见顶部权威陈述 + §2 Tier1）

> **🔴 权威横幅（v2.1 新增，A 项）**：**根因已于 2026-07-06 12:57-12:58 最终确认，唯一权威陈述见文档顶部 + §2 Tier1。本节(§1)以下全部内容是历史排查推理过程的存档**——按时间顺序保留了三轮被推翻的中间假设（"两个不同 binding 争用同一 index" → `compile_runtime_variable_definition` → `lower_inline_functions.rs` alpha-renaming），**全部已被排除，不是根因**。保留是为了给后来者看清"probe over model"这套方法论是怎么一步步逼近真相的，**不许**从本节任何一条画像出发构造新的复现用例或修复方案——一律以顶部"根因唯一权威陈述"为准。

<details>
<summary>历史排查记录（点击展开，仅供追溯，不作施工依据）</summary>

- **已证实症状（chain/bytecode 级，这部分不变，是排查的起点）**：`_j2_closezk_repro3.sil` 编译产物偏移 143 处 `OP_PICK idx=9` 越界（pop 掉 idx 后栈长=9，需 idx<9）；偏移 139 处不同 binding（`guestPayoutRoot`）同 idx=9 是合法的（当时栈长=10）。两次 PICK 之间字节码为 `OP_CAT/OP_SHA256/OP_CAT`，净栈 −2。真实广播被节点拒绝："pick at an invalid location"，资金无损失（两个测试 UTXO 原封不动）。
- **假设①（12:39，已 deny）**：早前 handoff memory 猜测"同一 witness 变量被引用两次"——已证伪。真相是两个不同 witness 参数（`guestPayoutRoot`/`gateSuffix`）先后引用，编译器给了相同的硬编码 index=9。
- **假设②（12:44-45，已 deny）**：怀疑 `compile_runtime_variable_definition`(compile.rs:1336-1349) 每条变量声明语句 RHS 都从 `stack_depth=0` 重新起算，若净效应非 +1 则脱节。J2+J1 独立交叉收敛到此，但后续证明不是精确根因所在——这是"多算 1"这个症状的**表层观察位置**，不是**产生多算的那一行**。
- **假设③（12:50，已 deny）**：J1 7 行源码级复现指向 `lower_inline_functions.rs` 的 alpha-renaming 管线。**J1 本人在 12:58 用消融矩阵推翻了这条**——alpha-renaming 管线本身没有 bug，只是恰好把触发 bug 的变量重命名成 `__inline_0_a`，这个重命名动作暴露了 bug 的现象，但不是 bug 的所在地。
- **候选点 `compile_introspection_expr` 的 `InputSigScript` 分支（J1 12:38 提出）**：**状态 = deny**。deny 证据：真根因（`compile.rs:3754`）修复后，minrepro + repro3 的符号栈自检全绿 + 写侧 trace 显示该手写 opcode 块净效应确为 0（不参与本次 bug）。（D 项：候选点状态统一钉死，不再留悬置措辞。）
- 已确认死路：任何 `.sil` 层面 workaround（降栈/reorder/inline）——13 轮 + 这次都试过仍 pick fail。只能修 silverc 编译器本身。

(详见 memory `project-j2-oppick-investigation-handoff-2026-07-06`。)

</details>

## 1.5 落码前三步核对 — ✅ 三步全部完成（2026-07-06 13:0x）

> B 项修订：本节从"待办清单"更新为"完成记录"。三步都已有具体证据，不再是 gating TODO。

1. **✅ 算术对账**：真根因确定后重新核算——`compile_byte_sequence_cast_call` 的多余 `+= 1` 使净效应从 +1 变 +2，多算 **恰好 1**。J2 独立核对 journalHash 表达式里 `byte[](attestedWinner,1)` 只出现 **1 次** → 多算 +1 → 精确解释"idx=9 该是 8，恰好差 1"这个原始观测。算术吻合，机制闭环，非巧合。**§5 层 2 的预注册 diff 现在有了机制基础**（见下方 C 项修订）。

2. **✅ 触发条件消融（由 J1 隔离测试兑现，非单独再造 3 用例）**：J1 在隔离 clone 里用"强制 2 次下游引用绕开 `lower_local_aliases` 别名消除confound"的方法，跑了 **8 个隔离变体（iso_a 到 iso_g + 原始 minrepro）**，覆盖了消融矩阵要求的范围（去 cast / 不同 concat 项数 / 引用次数变体）。**结论**：concat 链长度、cast 位置**全部无关**；真正触发条件只有一个——RHS 里任意位置出现 `byte[](val,size)` 这个 2 参数动态 cast 拼写形式，且该局部变量后续被真实引用（不被别名消除）。**F 项修订**：Tier 0 原计划"待补对照组"（A/B 之间无中间栈变化的版本）**不再单独造**——这个消融矩阵已经是更精确、更完整的对照组，直接取代它。

3. **✅ 潜伏面扫描（已执行，命中一处，已排查收口）**：J2 grep 全部现有 `.sil` 发现 `PoolSpine_v0_7_1.sil` 命中同款模式（`yesB`/`noB`/`shardCntB` 三处 `byte[](val,size)` 声明+下游引用）。**排查结论（三方独立证据交叉·详见 COORD-LEDGER）**：①今晚 lv3rz/k3cnf/dyljb 实际结算走的是 `PayoutShard.sil`（非 `PoolSpine_v0_7_1.sil`），其仅有的两处 cast 用法都是一句话内立即被 `blake2b` 消费、不单独命名成变量再引用——不匹配精确触发条件（J2 实测编译对齐结构验证零越界）②NWT 独立旁证：250/250 已结算市场 `settle_txid` 全部成功落链零拒绝，与"系统性取错值"假设矛盾③`PoolSpine_v0_7_1.sil` 本身在代码库里找不到任何 importer，live 状态存疑（待 KANet-UI 澄清，非紧急，不影响今晚结算正确性结论）。**今晚实际结算未受此 bug 影响，三方证据确认，非运气巧合。**

**三步全过。下一步不是"继续核对"，是 §3 分工里的落码 + NWT 代码审 + §5 四层验收。**

## 2. 诊断策略回顾——三层方法论本身的成效评估（非待办，是事后复盘）

### Tier 0：造最小复现 — ✅ 完成，方法论验证有效

J2 造的 87 字节 `_j2_minrepro_double.sil` 精确复现了完整 230 字节 covenant 里的同款 bug，证明"造最小复现"这个杠杆点选对了——后续所有消融、诊断都在这个小用例上快速迭代完成，没有再回到大 covenant 上盲测。

### Tier 1：确定性插桩 — ✅ 根因锁定

读侧插桩（`emit_copy_binding_to_top`）+ 写侧插桩（J1 在 RHS 编译后断言 `stack_depth==1`）双管齐下，最终由 J1 的写侧诊断在源码级（不用反猜字节偏移）精确锁定：

**根因 = `compile.rs:3754`（`compile_byte_sequence_cast_call` 函数），处理 `byte[]()` 2 参数动态 size 形式分支时多写一行 `*ctx.stack_depth += 1;`，无对应 opcode emit。姐妹函数 `compile_bytes_call`（`bytes(val,size)` 写法）的等价分支没有这行多余代码，是对的——只有 `byte[]()` 这个拼写形式坏。修复=删这一行。**

验证：①J1 隔离 clone 重编后 8 个隔离 repro 全部不再触发诊断 + 完整现有 cargo test 套件 55 个测试 0 失败 0 回归 ②J2 独立代码核对 `compile_byte_sequence_cast_call`(3741-3758行) vs 姐妹函数 `compile_bytes_call`(3661-3671行 2 参数分支)逐行对比，确认多余行位置 ③算术对账（见 §1.5 步骤①）精确吻合。

### Tier 2（架构级，一次性免疫，非本次专用）：把调试模拟器升格为编译期自检 — 🟡 核心技术已就地验证，永久化未开始（🟠2 修订，见下方口径校正）

> **🟠2 口径校正（第二轮架构审抓出的 Tier1/Tier2 时序矛盾，已修正）**：此前 §5 层1 写"符号标签匹配"，字面上是 Tier2 Level2 的能力，但本节曾标"⬜未开始"——这是文档内部的时序矛盾（承诺了工具还不存在的检查）。**实际情况**：J2 在落码验证阶段**已经就地在调试模拟器里实现了符号标签追踪**，并对完整 230 字节 covenant 的全部 7 处 PICK 做了 exhaustive bounds+符号标签双重检查（13:07，全部通过）——**Level 2 的核心技术已经真实跑过、不是空中楼阁**，只是还没有"编译进 silverc 本身、每次编译自动跑"这个永久化形态。下面两级分开说清楚：
> - **✅ 已完成**：符号标签追踪能力本身(手写模拟器里)，已在 minrepro + 完整 repro3 covenant 上跑过并给出 exhaustive 结果。
> - **⬜ 未完成**：把这个能力**固化成 silverc 编译流程自带的强制自检**（每次编译任何 `.sil` 都自动跑，而不是靠人手动调用调试脚本）——这才是"永久防线"的真正含义，仍未开始，不阻塞今天 LAND。

J2 已经手写了一个**跟 live VM opcode 语义完全对齐**的反汇编模拟器（踩过 `0xaa=OpBlake2b` 不是 `OP_HASH256` 那个坑之后修对了）。这个模拟器目前是调试脚本形态，符号标签追踪能力已经加进去并验证有效，但还没接进编译器主流程。

- **提案**：把这个模拟器接进 silverc 编译流程本身，**编译完成后、返回字节码前，自动跑一遍**。自检分两级：
  - **Level 1 — bounds**：对每一条 `OP_PICK`，用模拟栈校验 `idx < 当前模拟栈长`，不满足就编译期直接报错。
  - **🔴 Level 2 — 符号栈追踪（强制）**：模拟栈不只记长度，**每个元素带来源标签**（witness 参数名 / 中间值 hash 描述）。每条 `OP_PICK` 校验"取到的标签 == 编译器意图取的 binding"。理由：同一类 off-by-N 错误有两种表现——越界（节点拒绝，可见）和**界内取错值（节点接受，静默错）**。只查 bounds 等于只防可见的那半。今晚 `PoolSpine_v0_7_1.sil` 那次潜伏面排查就是这条防线的第一个真实预演，值得正式做进 Tier 2 corpus 验证。
- **模拟器自身先验证再上岗**：模拟器已经错过一次（0xaa 事件）——升格为编译期 gate 前，先在**现有全部 `.sil` 编译产物 corpus** 上跑一遍，与 live VM 已知接受/拒绝结果对齐，全绿才接入。
- **路径敏感性范围声明**：确认模拟器是线性走字节码还是路径敏感。如果目标合约含条件分支（OP_IF 类），线性模拟的栈深在分支汇合处不成立——需加范围声明或实现分支双路径模拟。
- **提交纪律**：这条改动只加自检断言，不改任何 emit/codegen 逻辑本身，不影响本次修复路径。可以在修复落地之后再做（不阻塞今天的 LAND 目标）。**emit 修复与 Tier 2 自检基础设施必须分 commit**（回滚修复时不把防线一起滚掉）。

## 3. 分工（J2 + J1 双人攻，但避免同文件竞态）

- **J2**：owns Tier 0 最小复现 + Tier 1 读写双侧插桩 + trace 采集 + **实际落码修复**（在 `/d/silverscript` 主 clone）。
- **J1**：owns 独立代码通读 + 隔离环境消融验证（`D:/silverscript-j1-isolated`，未碰 J2 共享 clone，NWT 补强①已落实）+ 提出候选修复点，J2 落码后转 co-review 角色。
- **✅ diff budget（最终版，取代文档内所有更早版本）**：修复只碰 **`compile.rs` 的 `compile_byte_sequence_cast_call` 函数、3754 行这一处**——删掉多余的 `*ctx.stack_depth += 1;`。任何对 `stack_bindings.rs` / `lower_inline_functions.rs` / `compile.rs` 其它函数的顺手改动都需要单独解释，不能默认捎带。
- **NWT sign-off 边界**：本方案(设计)已过 NWT 一审+二审 GREEN；实际 emit 修复 diff 落地前**另需 NWT 第三次审——落码代码审**，三次审不合并（设计审 v1 → 设计审 v2 → 代码审）。
- **隔离**：`/d/silverscript`（本地工具，非 live 节点）+ `D:/silverscript-j1-isolated`；涉及 rusty-kaspa-zksdk-isolated 的任何验证仍绝不碰 live `D:/rusty-kaspa`。

## 4. 检查点节奏（不停，但不失明）

- **纯调试/插桩/读代码/落码前验证** = 可逆、不广播 = **不停**，Owner 指令优先。
- **每 ~30-45 分钟**必须在频道报一次现状（本轮实际执行密度远高于此，进展速度快时可以更密）。
- **"轮"的定义**：一轮 = 一个明确假设完成插桩→trace 采集→diff 分析→得出明确 confirm 或 deny 结论。**本次实际只用了 3 轮就从症状走到根因确认**（12:39 假设① deny → 12:44-45 假设② 表层观察 → 12:50-12:58 假设③ deny + 真根因 confirm），Plan B 的"3 轮未收敛"触发条件未触发，不需要启动。
- 只有**广播动作本身**才触发"三重核对不因赶时间省"的谨慎档位。

## 5. 验收标准（四层，逐层过了才算"真修好"）

1. **最小复现层**：Tier 0 的触发版编译后，模拟器对整个脚本每一条 PICK 做双重检查：① `idx < 模拟栈长`（bounds）② 符号栈标签匹配——取到的元素来源 == 该 binding 应指向的 witness 参数。J1 8 个隔离 repro 已验证 bounds 全绿（诊断不再触发），符号标签匹配待 J2 落码时一并跑。

2. **结构层（🟠 C 项修订 + 🟠1 二轮架构审再修订：枚举范围比"每个触发位点一条"更宽）**：**🔴 关键修正（第二轮架构审抓出）**：根因是"cast 处虚增 `+1` 污染 `stack_depth`"——污染影响的**不是"含 cast 的那个变量"一处 PICK**，而是**污染点之后、同一 stack_depth 作用域内所有后续 binding 引用的 index 计算**。预注册 diff 的枚举粒度必须是"**污染点下游全部 PICK**"，不是"触发点本身"。以 `_j2_closezk_repro3.sil` 为例：污染源在 offset136(`byte[](attestedWinner,1)`)，其下游至少两处受影响——**offset139(`guestPayoutRoot`)和 offset143(`gateSuffix`)都要预测**，不能只预测触发cast的那一处。**实测结果（13:07 已发生，回填对账）**：offset139 idx 从 9→8，offset143 idx 从 9→8，两处都变了，且都是修复后重编时**实际观测到**的变化——这跟"污染点下游全部受影响"的机制预测吻合，不是意外。**这项事后回填对账本身就是层2的实质内容**，往后如遇到类似 bug，落码前须先枚举污染点下游全部 PICK 再预测，不能只预测触发点。

3. **值匹配层**：`blake2b(gatePrefix+journalHash+gateSuffix) == blake2b(完整 redeem)` 这条 non-vacuous binding 恒等式在新字节码上重新验一遍，仍然成立。

4. **live-node 接受层**：真实广播（用**全新的一次性测试 UTXO**，不复用已冻结的 jepu1/gate 测试台）——必须真被节点接受。**必须带正确的 `computeBudget` 声明**（已知坑：groth16 验证 script units 14002807 远超默认限额 109999，需 `computeBudget=1500`），不能默认省略，否则可能在同一层撞不同的坑被误判成"OP_PICK 没修好"。**层 4 只证明"没越界"，不证明取值正确**——语义正确性由层 1+2+3 共同承担，层 4 不得被引用为"修对了"的唯一证据。**这层过了，才轮到用 J1 真 proof 的 UTXO 做最终广播**（八命门 + Owner 批闸）。

## 6. Plan B（未触发，保留备查）

Tier 1 只用 3 轮就收敛到精确根因，**Plan B 触发条件（3 轮插桩未锁定具体行）未满足，不需要启动**。原方案保留：若未来遇到同类 off-by-N 且短期内定位不到精确行，可考虑把"binding 后续引用靠穿透递归计数器算相对 PICK 深度"换成"绝对偏移寻址"这个结构性方案，但**触发时验收必须同步升级**——全量现有 `.sil` corpus 回归 + P2SH 兼容性影响评估（改栈布局=全量合约地址变，影响面是全量合约，不得沿用 §5 四层原样通过）。

## 7. 我（Bettor）的角色

协调 + co-verify + 落链闸，**全程 read-only**——不碰 silverc 代码。收 J2/J1 的 trace/候选修复点/落码 diff，判断是否够格进入下一层验收（对照 §5 标准逐条打勾），推动 NWT 三次审（设计审 v1+v2 + 落码代码审），最后把关广播三重核对 + Owner 批闸。

## 8. 收尾两项（🟡3，第二轮架构审补充，非阻塞）

1. **同族 cast 函数 grep(2分钟量级)**：`compile_bytes_call`(`bytes(val,size)` 写法，干净) vs `compile_byte_sequence_cast_call`(`byte[](val,size)` 写法，有 bug)——待 grep 同族其它 cast 函数/其它 arity 分支，排除还有第三处同款"`stack_depth += 1` 无对应 emit"。防"修了这个拼写形式，另一个拼写形式还埋着一处"。
2. **回归 fixture 固化 + 证据降权**：**"55 个 cargo test 0 回归"这个证据要如实降权**——这套测试之前就没拦住这个 bug 本身，它的绿只证明"没改坏别的东西"，不证明"修对了"；真正的修对证据是 J1 的 8 个 iso repro + 符号栈 exhaustive 检查。**待办**：把 minrepro + 8 个 iso 变体收编进 cargo test 作为**永久回归 fixture**（可与修复同 PR、分 commit）——消融矩阵"一次投入两次收益"的承诺，要落到这一步才算真正兑现，否则这批诊断用例用完就散，下次同类 bug 又要从零造。

---

## 9. 🎉🎉🎉 收官（2026-07-06 14:44）：完整真实 ZK settle LANDED

**txId `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`——KANet 历史上第一笔完整真实 ZK settle 链上交易，NWT 独立核实（续约地址活 UTXO，金额+outpoint 精确匹配）。**

本方案从 v1 出稿到这一刻，完整走完：设计审(v1+v2)→ 根因定位(§1.5三步核对) → 落码(compile.rs:3754单行删除) → NWT落码代码审GREEN → §5四层验收全过 → J1真实Groth16 proof接入(环境阻塞→整机重启修复→真实proving) → 最终广播全套确认点独立核实 → LANDED。全程零资金损失，每个关键节点独立核实（不自审）。详细技术链条与全队贡献见 `docs/iteration/COORD-LEDGER.md` 对应里程碑条目 + memory `project-first-complete-real-zk-settle-landed-2026-07-06`。

**诚实标注**：这是"机制端到端跑通"的第一笔实证，不是生产化/规模化方案——后续委员共识层、多片支持、gate脚本规模化等仍是独立课题，本方案到此为止不越界声称更多。

---

**当前阶段**：✅ **已完成**。本方案的执行使命结束。
