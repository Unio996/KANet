# NWT 红队复核 · V-T-6 根因定位 v0.3（Bettor 2h 派单退路②）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 🔴 **状态注记（2026-09-15 · J2 · 账本 1417/1418 · 不改本文件下方 NWT 原文）**：本文件"结论：判断为真"
> 一节最终判定为**误判**——4 个探针的失败根因是探针自己的交易构造有基数错误（只有 1 个输出且属于外部
> covenant，`next_states.length` 却填 1，撞上 `binding=cov` wrapper 自己的续约输出数基数检查），不是
> `binding=cov` 框架对外部输出内省失效。决定性反证见 `docs/DECISIONS.md` D-018 同日期状态注记。本文件
> 下方"独立复现全部 FAIL"这个观测事实本身没有错（4 个探针确实都 FAIL），错的是"为什么 FAIL"这个归因——
> 这次没有重新独立复算 NWT 的 kaspa-wasm 哈希交叉验证部分（那部分与本次反证无关，结论不受影响）。
> 🔴 **联署注记（2026-09-15 · NWT · 账本 1421 · 同样不改下方原文）**：Bettor 派我核两件事：①复跑
> `docs/provenance/2026-09-15-j2-vt6-retraction-cardinality-bug/` ②回查本文件下方 2×2 矩阵所依据的
> 全部探针，看是不是也全是"组内续约输出数=0 而 `next_states.length` 填 1"这个错误形状——**如果有哪个
> 形状正确却仍然失败，撤销就撤早了**。**结果：撤销成立，且是我自己独立坐实的，不是转述**。① 我自己另开
> 一个隔离 worktree，用全新 pin 二进制真跑了 `Repro.sil`/`ReproNoCheck.sil`，A/C 两条向量结果与
> `run.log` 一致；我还多做了一步——把 A/C 两笔交易分别喂给 `ReproNoCheck.sil`（`require(true)`，无
> covenant-id 检查），**两笔都 PASS**，独立证实两笔交易本身在结构上都是合法的，C 唯一失败原因就是那条
> `require`，不是别的隐性检查。② 我把当年立案时用到的**全部 7 份探针文件**（`ProbeBoutCov.sil`/`2`/`3`/
> `4`/`ProbeOutCovId`/`ProbeBoutLoop`/`ProbeBoutCombo`，不止账本提到的"4 新 + 3 旧"这个数，我把 scratch
> 里能找到的全部都翻出来查了一遍）对应的 test.json 逐个数了输出——**全部 7 份都是同一个错误形状**：交易
> 总共只有 1 个输出，且这个输出的 covenant_id 跟 active input 不同（0 个属于本组续约），而每一份 `.sil`
> 都在 `next_states`/`ClaimState[]` 里声明了 1 个元素，对不上。**没有一份探针是"组内续约输出数配平、
> 形状本身正确"的对照，本文件下方"结论：判断为真"这一节从立案第一天起就没有真正排除过"失败原因是基数
> 检查"这个可能性——这是我自己的方法论漏洞，不是 J2 一个人的**。上面 J2 的注记说"这次没有重新复算
> kaspa-wasm 哈希交叉验证部分"——这条我认可范围划分本身没问题（那部分测的是`covenantId()`算法等价性，
> 跟"探针交易形状对不对"是两件独立的事），但连带提醒：本文件下方那段 kaspa-wasm 交叉验证的结论本身
> 依然成立，只是"V-T-6 存在"这个总判断不再由它加上探针结果共同支撑，现在只由本文件其余部分（工具链
> 无执行引擎那部分）单独站着，读者如果只截取"判断为真"这个结论，必须连着这两条注记一起读。
> 审对象：`0d9a1f61`（`KNOWN-GAP-V-T-6.v0.3.md`，4 个新探针 + kaspa-wasm 交叉验证）。
> 方法：独立读了 `kaspa-wasm` 的 `kaspa.d.ts`（不信"没有执行引擎"这句话，自己查了全部导出）；**自己写了一组跟 J2 不同的测试输入**，独立调用真实 `kaspa-wasm` 的 `covenantId()` 与 `genesis_covid.mjs` 的 JS 复刻比对（比"复用 J2 同一组输入"更强的验证——证明的是算法等价，不是"这一组数字凑巧对上"）；独立编译+跑了全部 4 个新探针。

## 结论：**判断为真——这是工具链层限制，走"改设计"（退路①）的方向正确**

## 一、"kaspa-wasm 没有执行引擎"——独立核实为真

自己 `grep` 了 `kaspa.d.ts` 全文找 `Script|Covenant|VM|Engine|TxScript`——**确认没有任何脚本执行/验证类的导出**，只有 `ScriptBuilder`（构造脚本用）、`isScriptPayToScriptHash` 之类的判定 helper，`verifyMessage` 只验签名消息跟 tx 脚本无关。**"拿真实 kaspa-wasm 跑一遍 covenant 脚本看 pass/fail"这条路径确实做不到**，J2 这条没有夸大。

## 二、`covenantId()` 交叉验证——独立复现，且用了不同的测试输入（更强的证明）

**没有照抄 J2 的测试向量**，自己现场编了一组不同的输入（`transactionId` 全零、`index=0`、单个 `authOutput` 用一个自造的 P2SH 脚本），先踩了一个我自己的坑（第一次调用漏传 `scriptPublicKey` 的 `{version, script}` 结构，传了裸字符串，得到一个不匹配的结果——**这个不匹配是我自己参数搭错、不是算法有问题**，补上 `version:0` 后）：

```
wasm covenantId (显式 version=0): 73a2363d8a2654185944b7bc7f793efaa19aba1b46ecef4beced085eed07d10f
genesis_covid.mjs(J2 v0.2 复刻) : 73a2363d8a2654185944b7bc7f793efaa19aba1b46ecef4beced085eed07d10f
```

**完全一致**。这比"用 J2 同一组数字重放一遍"更有说服力——**证明的是算法本身等价，不是某一组特定输入凑巧对上**。J2 v0.2 的哈希复刻确认无误，debugger 链接的共识层实现与真实生产 `kaspa-wasm` 语义一致，**协议层没有分裂**，这条排除彻底。

## 三、4 个新探针——独立编译独立跑，结果与 J2 报告逐一一致

```
ProbeBoutCov(binding=cov + 循环 + 两原语组合)         : FAIL
ProbeBoutCov2(同上, 去掉循环直接下标0)                : FAIL(排除"循环构造导致"假设)
ProbeBoutCov3(只留 OpOutputCovenantId)                : FAIL(排除"两个原语组合才坏")
ProbeBoutCov4(只留 validateOutputStateWithTemplate)   : FAIL(反向确认, 同上)
```
四个探针独立复现全部 FAIL，跟 v0.2 已验证 PASS 的"纯 entry 形态"探针（`ProbeOutCovId`/`ProbeBoutCombo`/`ProbeBoutLoop`，我在上一轮已经独立跑过）放在一起看——**这是一组干净的 2×2 隔离矩阵**：两个原语各自单独在 `entry` 里对外部输出内省都行，各自单独在 `binding=cov` 里对外部输出内省都不行。**这不是"猜测收窄"，是真的做了对照实验排除了"循环语法"和"两原语组合才触发"这两个具体假设**，剩下唯一还站得住的解释就是 `binding=cov` 框架本身的问题。

## 四、给 Bettor 的判断：工具链层 bug 还是设计要改——**两者都是，因果关系讲清楚**

- **是工具链层的真实限制**：三层独立证据（协议层源码语义读了两次、真实 wasm 哈希函数交叉验证、10 个探针的系统性排除法）收敛到同一个结论——`binding=cov` 框架不能正确处理"对不属于当前 covenant 的输出做内省"，这不是猜测，是排除法排出来的。我没有找到任何反证。
- **但"是工具链 bug"不等于"等工具链修好"是唯一出路**：这个 bug 修复需要动 `silverscript-lang` 的编译器源码（`binding=cov` 的 codegen 逻辑），这不在这个项目的控制范围内、也没有时间线保证。**正确的响应是绕开这个限制，不是等它被修**——而"绕开"恰好等于"改设计"：把接收方验证责任从代币合约的 `binding=cov` 函数挪到市场/领取合约的手写 `entry` 里。
- **这条路不是临时凑出来的补丁**：`P12MarketA2.sil` 的 `payout_claim`（本会话前几轮已经反复审过、独立验证过运行期向量的既有探针）**从一开始就是手写 `entry`，从不调用 `OpOutputCovenantId`**——这恰好是这次排除法定位到的"安全区"。也就是说，**走这条路不是发明新模式，是确认 P12 那条既有设计路线本来就是对的，KanetTestToken.sil 这次自己在 `transferPolicy` 里重新验证 b-out 目标才是那个不该走的分支**。

**批准走退路①（改路由设计）**。请 J2 按这个方向出 T1/T2/T3 路由变更稿，我审的时候会重点看：①新划分下 NWT §1"自建 trivial covenant"攻击由谁挡、挡的形式是否跟原来的 `OpOutputCovenantId` 检查等价严格（不能因为挪了位置就顺手松了口）；②H5"在场≠同意"的落点是不是准确挪到了市场/领取合约那一侧，没有留出一个两边都以为对方会核的空隙；③14 条向量 + 4 个 v0.2/v0.3 探针要不要重新过一遍以确认新设计下这些既有结论仍然成立。

## 五、其余记档

- 43 个 provenance 文件全部 `sha256sum -c` 通过，MANIFEST 与树对齐。
- `binding=cov` codegen 具体是哪一行代码出的问题——v0.3 没有下钻到这一层（超出 2 小时预算），这条本身不影响"走退路①"这个决策，留给以后有人想真的去修 silverc 时用（4 个探针文件已保留）。
