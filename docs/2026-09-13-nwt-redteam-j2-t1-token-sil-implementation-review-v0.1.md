# NWT 红队复核 · T1 `KanetTestToken.sil` 实现 diff（14/15 向量 + V-T-6 缺口）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-t1-token-sil` `309246e2`（实现 + 14/15）+ `6f75394e`（V-T-6 KNOWN-GAP v0.2，源码复核）。
> 方法：**从零构建了一套独立的 silverscript v1.0.0(`@3ed9733`)编译器+cli-debugger**（不复用 J2 的 scratch clone，那份本机没留下）；用它独立编译 `KanetTestToken.sil` 并**逐字节比对**编译产物；独立跑全部 15 条向量 + 后续 4 个隔离探针；直接读 `3ed9733`/`7b1e18cc`（pinned rusty-kaspa）两处源码核对 `OpOutputCovenantId` 语义；额外拿本会话此前已验证过的 `covenant-roundtrip.test.mjs`（真实 `kaspa-wasm` 工具链）作交叉证据。

## 结论：**GREEN，可以合入侧分支，V-T-6 单独排期继续查——不阻塞交付，但在判定"T2/T3 领取路径可用"之前必须收口**

## 一、独立复核：编译产物、15 向量、4 个新探针——全部亲自重跑，不是读报告信

**编译产物逐字节比对**：从 `3ed9733` 打了一份全新 worktree，`cargo build --release` 出 `silverc`/`cli-debugger`，独立编译 `KanetTestToken.sil`(用提交的 `KanetTestToken.args.json`)——**产物与提交的 `KanetTestToken.compiled.json` 字节码逐字节相同**(3863 B，`template_hash` 完全一致)。这证明提交的编译产物真的来自这份源码,不是手填的。

**15 条向量独立跑**：拿同一份 debugger 跑 `--test-file KanetTestToken.test.json --run-all`——**结果与 J2 自报完全一致**：13 条 `expect` 精确匹配 + `V-T-6` 真失败 + `V-harness翻转臂` 正确翻红(=13条真实behavior通过, 2条"failed"里一条是设计好的翻转检查不是真bug)。**这不是我读了 J2 的 `run.log` 相信,是我自己独立编译独立跑出来的同一个结果**。

**4 个隔离探针独立跑**(`6f75394e` 新增)：`ProbeOutCovId`(2 向量)/`ProbeBoutCombo`(1)/`ProbeBoutLoop`(1)——**全部 PASS**，跟 J2 报的"三层排除法全过"一致。全部 29 个 provenance 文件 `sha256sum -c` 逐一核对，MANIFEST 与树完全对齐。

## 二、③ `OpOutputCovenantId` 语义——我独立读了两处源码，与 J2 的结论完全一致（三方互证）

直接读了 `3ed9733` 的 `compiler/compile/expression/builtin.rs:70`(codegen 1:1 映射,零介入)与 `7b1e18cc` 的 `crypto/txscript/src/opcodes/mod.rs`(**独立读到与 J2 一字不差的实现**)：
```rust
let covenant_id = output.covenant.map(|c| c.covenant_id).unwrap_or(ZERO_HASH);
```
**纯字段回显**：读该输出自己声明的 `covenant` 字段(一个 `Option<CovenantBinding>`)，没声明就是零哈希。这个字段的值是否"诚实"(genesis 场景下必须等于按真实哈希算法重算的值)由 `covenants.rs::CovenantsContext::from_tx` 在脚本执行**之外**做一次性预检强制——**opcode 本身不做任何重算，只回显**。这跟我自己独立读源码得到的结论**逐字一致**，跟 J2 的结论也一致——**三方（我、J2、源码本身）互证，语义没有任何不确定性了**，可以从"debugger 是不是在骗人"这层怀疑里彻底排除。

**追加一条 J2 没提到的交叉证据**：本会话此前审 F2-R 时**我自己跑过** `kasia-relay/src/lib/covenant-roundtrip.test.mjs`，那个测试用**真实 `kaspa-wasm` API**（不是 debugger）构造了一笔交易，输出上带一个**显式 `CovenantBinding`**（`covId == c0c0c0c0...`），当时跑出的结果是 `✅ covenant tx built`。**这证明"给一个新建输出挂一个具体 covenant_id"这件事,在这个项目实际会用来广播真实交易的工具链上,已经是一个验证过、能工作的机制**——V-T-6 的问题窗口大概率在 **silverc/debugger 这一层对 `binding=cov` 框架的处理**，不是"Kaspa 协议或这个项目的现有工具链根本做不到用新建输出承载 covenant_id"这种更严重的结构性问题。这条证据没有直接定位 bug,但缩小了"这会不会是无解死胡同"的担忧范围。

## 三、①14/15 是否够先合——**够**

理由：
- 其余 14 条(含负向量、H2/H3/多实例/NWT §1 攻击防御)都是**真实 cli-debugger 跑出来的**，不是设计文档层面的推断，我自己独立复现过一次，可信度扎实。
- V-T-6 的失败面已经从"可能是工具链根本性缺陷"（v0.1 KNOWN-GAP 的担忧）收窄到"`transferPolicy` 的 `binding=cov` 框架与已验证正确的 b-out 机制之间一个具体、未定位的交互点"（v0.2）——**范围明确、有復現路径、有留存的探针文件**，不是"不知道从哪查起"的黑洞。
- 这次合入的是**侧分支的 docs+provenance**，不涉及部署/广播/真实资金，风险面本身就低。

**批准**：14/15 + 一个范围明确、排期继续的已知缺口，够先合入侧分支。

## 四、②这个缺口是否动摇 A″ 核心（领取路由）——**目前会，但我判断大概率是可解的工具链 bug，不是设计死角；给出具体的验证要求，不是空泛的"继续查"**

**先说清楚"会不会动摇"的事实边界**：读了 `KanetTestToken.sil` 的 `ownerIsMarketInput` 实现——它**专门检查 `market_tmpl_suffix`**，即 b-in 路径目前**只认"接收方是市场模板"**这一种在场证明，不认"接收方是领取(claim)模板"。这意味着：**目前的合约代码里，b-out(新建领取覆盖模板输出)是唯一能把代币送进一个全新领取 covenant 的路径**——b-in 不是即用的备胎，它解决的是另一个场景(领取→再下注)。**如果 V-T-6 最终证实是一个无法绕过的死结,T2/T3 的"市场派彩给赢家新建一个领取 covenant"这个核心动作就真的没有替代路径**，这条我认为不该被轻描淡写。

**但我判断这不是设计死角，是一个范围已收窄的具体工具链交互 bug，理由见上面②③两节**（opcode 语义三方互证清楚、隔离探针逐层排除、真实 kaspa-wasm 工具链已证明底层机制可行）。

**如果最终排查证实这条路径在 silverc v1.0.0 debugger 里就是走不通，退路是什么**——我给两个方向，不是没想过就甩锅：
1. **换一种"接收方证明"的写法**：不用 `OpOutputCovenantId(out_k) == next_states[j].owner` 这种"直接比较字段"的形式，改用市场入口那边(T2/T3)**主动核代币输出**（H5 的既有原则：会共花的入口自己核，不外包）——即把"这个新建输出真的是领取 covenant"的验证责任从代币合约挪到市场合约那一侧，代币合约在 b-out 分支只做**宽松**的"确实新建了一个输出、金额对得上"检查，不去比较 covenant_id 具体字段。这个方向的代价是需要重新过一遍 H5 分析，但避开了 `OpOutputCovenantId` 这个具体原语。
2. **继续按现在的方向查，但换个复现路径**：不在 debugger 里查，直接拿 `kaspa-wasm` 构造一笔真实交易(参照 `covenant-roundtrip.test.mjs` 的既有模式)，看这个具体场景(b-out 新建覆盖模板输出 + `OpOutputCovenantId` 比较)在**真实签名+序列化**路径下是否复现同一个失败——如果在 wasm 路径下反而是通的，那就实锤了"问题在 debugger/silverc 对 `binding=cov` 的某个 codegen 细节，不在协议本身"，可以直接绕开 debugger 继续往下走，不必卡在这一个工具的诊断能力上。

**这两条建议之间我倾向先试②(换复现路径)，因为成本更低、且如果验证通过就能直接排除"设计需要改"这条更贵的路，不需要马上改 T2/T3 的分工设计**。

## 五、给 Bettor 的处置建议

- **GREEN，批准合入侧分支**；V-T-6 单独排期，按 KNOWN-GAP v0.2 留的探针继续（`ProbeBoutCov.sil` 那个绊了个无关编译错误，下一棒先修那个再往下查）。
- **明确一条边界，不要在后续沟通里被模糊掉**：这次合入**不等于 T2/T3 的"市场→领取"路由已经验证可行**——那条链上目前唯一的实现路径(b-out)还有一个开放缺口。判定"T2/T3 可以开始按当前 T1 形态设计落码"之前，V-T-6 必须先收口(或者 T2/T3 改路由设计，见④的退路①)，这条我按红队纪律记为一条硬性依赖，不是软性提醒。
- 建议下一棒排查时先试"用真实 `kaspa-wasm` 复现同一场景"这条路（成本低、能直接判断问题在工具链还是协议层），再决定要不要动 T2/T3 的接收方证明设计。
