# NWT 红队复核 · RootClose代币化(`60307fc1`) + 🔴主网covenant可行性阻断发现

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1190：①`e52cc887`注释同步；②`60307fc1` RootClose完整代币化；③体积评估(非安全,需判)。

## 结论：**①②GREEN。③不是"要不要瘦身"的优化问题——独立核查发现两个各自独立、任一都足以致命的
硬阻断：(a) 当前真正在跑的主网kaspad是官方v2.0.1原样二进制，其consensus层根本没有covenant这个概念
（字段都不存在，不是"关掉了"）；(b) 即便covenant能跑，RootClose的redeem witness字节数已经超过mainnet
`max_signature_script_len=10,000`硬顶60%以上，是consensus级别硬拒绝，不是费用贵。这两条独立于本次
commit本身的代码质量，是部署环境/架构层面的问题，请立即核实，优先于本commit的GREEN定案。**

## 一、①`e52cc887` —— GREEN

diff只改了CloseZkV2/PayoutShardV2.sil两处ZERO32守卫的行内注释文字，0行逻辑代码改动，确认属实。

## 二、②`60307fc1`（RootClose完整代币化）—— 独立验证，GREEN

- **字节级重编译一致**（`bytecode_length=16802`，跟commit声称完全一致）。
- **24/24向量独立跑通**。
- **caret独立确认**（翻转expect逼出verbose，共查了3条关键负向量）：
  - `V-convert_to_claim-2`(裸输出ZERO32)：精确落在`require(claimCovId != ZERO32)`（199行）。
  - `V-convert_to_claim-4`(owner改道)：精确落在`validateOutputStateWithInputTemplate`（203行）。
  - `V-convert_to_claim-6`(多塞一笔归己代币不计入)：精确落在`require(owned_total == pool_value)`（190行）。
- **ZERO32守卫本身核实是PRE-EXISTING的**（`convert_to_claim`/`convert_to_refundclaim`的`!=ZERO32`早在
  更早的`rootclose-zero32-guard`那笔就已经加上，本次只是复用变量+接上新的代币输出转移逻辑）——这正是
  我之前ZERO_HASH系统性审计里点名"风险最高、待代码确认"的两个入口，代码落地时已经带着守卫，结果是
  干净的。
- **家族一致性**：B类(`close_commit`/`refund_flip`)+A类(`convert_to_claim`/`convert_to_refundclaim`)
  的形状跟PayoutShard/PayoutShardV2/CloseZkV2已审过的B/A类模式逐字一致，无偏离。

**②本身可以GREEN定案**——但见下③，这笔GREEN不代表RootClose这条链路在主网能真的跑起来。

## 三、③🔴两个独立的、各自致命的主网可行性阻断（不是"是否要瘦身"这么简单）

### 3.1 阻断①：真实在跑的主网kaspad二进制根本没有covenant这个consensus字段

**独立核实链**（每一步都是我自己查的，不是转述）：
1. `Get-Process kaspad`查得真实运行进程路径 = **`D:\rusty-kaspa-v201\kaspad.exe`**——这正是`/d/rusty-kaspa-v201/
   rusty-kaspa-v2.0.1-win64.zip`官方预编译发布包解出来的二进制，不是本机`/d/rusty-kaspa-da`（D-a/b/c/d
   补丁开发树）编译出来的东西。
2. 通过RPC `getServerInfo()`独立查得该进程自报`serverVersion: 2.0.1`，`networkId: mainnet`，
   `isSynced: true`——跟Owner 2026-09-13裁定（`docs/DECISIONS.md` D-017，CLAUDE.md铁律0.5状态注记）
   "主网节点跑da9本机(**官方v2.0.1原样,不带D-b/c/d**)"逐字对应，不是我猜的。
3. **直接对比源码**：`/d/rusty-kaspa-da`仓库里同时有`v2.0.1`这个官方tag和当前HEAD（D-b补丁）——
   `git show v2.0.1:consensus/core/src/config/params.rs`里**完全没有`covenants_activation`这个字段**
   （grep 0命中）；而当前HEAD（D-b补丁树）的同一文件里，`MAINNET_PARAMS`/`TESTNET_PARAMS`/`DEVNET_PARAMS`
   全部是`covenants_activation: ForkActivation::never()`，只有`TESTNET12_PARAMS`/`SIMNET_PARAMS`是
   `ForkActivation::always()`。
4. **结论**：covenant（`OpInputCovenantId`/`OpOutputCovenantId`/P2SH covenant dispatch，本会话T1/T2/T3
   全部工作的运行基础）**在官方v2.0.1源码里根本不存在这个概念**——不是"字段存在但被设成never"，是这个
   字段本身是D-补丁系列后来才加的。官方v2.0.1的consensus脚本引擎**没有实现这些opcode**。真正在跑的主网
   kaspad二进制**正是这份官方v2.0.1原样二进制**（进程路径+版本双重确认）。
5. **实际后果**：任何携带`OpInputCovenantId`/`OpOutputCovenantId`/covenant dispatch的交易，广播到这个
   真实主网节点，**大概率在脚本解释层直接被拒**（未知/未实现opcode）——本会话至今为止全部T1/T2/T3的
   独立验证（`silverc`编译+`cli-debugger`跑向量）**都只在隔离模拟环境里做**，从来没有对着这个真实主网
   节点广播测试过一笔真实covenant交易，**这个假设从一开始就没有被验证过**。

### 3.2 阻断②：即便covenant能跑，RootClose的redeem witness字节数已经超过mainnet硬顶

**独立查官方源码常量**（`v2.0.1`标签同一份`params.rs`，`MAINNET_PARAMS`）：
```
max_signature_script_len: 10_000,
// Transient mass enforces a limit of 125Kb, however script engine max scripts size is 10Kb
// so there's no point in surpassing that.
```
**这是consensus硬顶，不是mempool策略，超过直接拒绝，不是费用贵的问题**。

`ShardLeaf_direct.convert_to_rootclose`的`rc_suffix`witness参数（承载RootClose除state区外的完整字节码）
长度 = `bytecode_length - state_span.offset - state_span.len = 16802 - 1 - 87 = 16714`字节——**单这一个
witness字段就已经超过`max_signature_script_len`（10,000字节）达67%**，还没算上`rc_prefix`（1字节）+
其它函数参数（`rcOutIdx`等）。**这笔交易的sigScript总长度必然超过10,000字节硬顶，会被consensus层直接
拒绝，不是"贵"、不是"要瘦身优化"，是**结构上做不到**。

文件头旧注释"~825B seal目标"（来自FoldNode/PoolRoot旧架构）跟这次代币化后的16,802B完全不是同一个量级
——旧注释描述的是揭示给`register_append`看的"模板前后缀长度"预算，不是完整字节码；但即便按这个更窄的
定义重新量，16,714字节的`rc_suffix`本身也远超10,000字节硬顶，不需要更精细的mass计算就已经确定不可行。

### 3.3 判断：这不是"要不要瘦身"的优化题，是两条独立的、任一都致命的阻断

- 就算把RootClose从16,802字节压缩到10,000字节以内（阻断②的技术修法），**阻断①(covenant在真实mainnet
  kaspad上根本不存在)依然存在**，压缩RootClose字节数解决不了这个问题。
- 反过来，就算某种方式解决了阻断①（比如mainnet kaspad换成D-补丁build——但这直接违反Owner D-017"官方
  v2.0.1原样"的裁决，不是我能建议的方向），阻断②依然会挡住任何依赖RootClose完整字节码作witness的入口。

**这两条建议现在就核实清楚，比继续往下审PayoutShardV2/CloseZkV2其它入口的正确性更优先**——如果covenant
在真实主网节点上跑不起来，T1/T2/T3这一整条线（KanetTestToken/PayoutShard/RootClose/KanetTokenClaim等）
在"官方v2.0.1原样"这个既定环境下全部是不可执行的死代码，无论逻辑审得多干净都没有意义；如果这是Owner/
Bettor已经知道并且另有计划的（比如"先把逻辑做对，激活时机是另一件事"），也需要明确说清楚，不能让下一批
真实资金迁移在这个未经验证的假设上继续往前走。

## 四、给Bettor的处置建议

- `e52cc887`/`60307fc1`两笔代码审查GREEN，可以定案（代码本身没问题）。
- **🔴强烈建议在继续任何进一步的T3落码/迁移动作之前，先核实§三两条阻断**：
  1. 找一个最小、无风险的方式确认真实主网kaspad是否真的不认covenant opcode（比如构造一个不涉及任何
     真实资金的、结构最简单的covenant交易，广播到当前主网节点，看mempool的确切拒绝原因是不是"未知
     opcode"——这个测试本身有链上足迹，需要Owner/Bettor拍板要不要做，我不擅自广播）。
  2. 如果阻断①确认成立，需要Owner/Bettor决定：是重新评估"官方v2.0.1原样"这条裁决（引入D-补丁，但这
     改变了D-017本身），还是这条T3covenant线本来就该止步于"逻辑设计+隔离测试"阶段、等未来主网真的
     支持covenant时再激活（如果是后者，现在这些正在批量导入真实KAS的relay账号，它们的"用途"跟当前
     实际能做的事之间的关系需要重新讲清楚）。
- 这条发现不是本次commit的代码质量问题，是部署环境跟架构假设之间的落差，我判断严重度足以优先于继续
  审下一批T3入口。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
