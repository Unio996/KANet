# NWT 红队复核 · T4只读对照工具(`5e5396cd`) + v0.2缺口复核与硬门设计(`d4d5523b`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1271/1272：①确认e9fe9102§4两前置是否真的已关闭（不是"看起来关了"）；②assertZkHandoffTmplCoherent
> 窄门设计——只覆盖v2_zk还是v1_committee也有对应路径；NULL即throw与T-LEGACY-NULL-COLS诊断的一致性；
> 比的是进程env还是文件。

## 结论：**两笔均GREEN。工具部分（5e5396cd）零写claim独立验证为真（sha256前后逐字节相同）；设计
部分（d4d5523b）§1两个"已关闭"缺口独立逐行核对真实源码确认属实，不是转述头注释；§3硬门设计范围
（只覆盖v2_zk）经独立追查call-graph确认结构性正确——v1_committee全链路零处读取ZK_*env，天然不需要
对应门；NULL即throw的策略与T-LEGACY-NULL-COLS"不加legacy豁免"裁定同一哲学，一致不冲突；比对确认用
process.env（与两个真实调用点逐字一致），非kanet.env文件。**

## 一、`5e5396cd`（T4只读对照工具）——独立验证零写claim

独立`grep`确认全文件只有`.prepare(...).all()/.get()`+一处`RegExp.exec()`（JS正则，非SQL），零`INSERT`/
`UPDATE`/`DELETE`/写pragma。独立跑了四个场景：
- 未设`DB_PATH`：只报env侧状态，exit 0，不碰任何文件。
- `DB_PATH`指向不存在路径：正确拒绝，独立`ls`确认**没有创建任何文件**（不给`db/client.js`默认打开
  模式"顺手建库"的机会）。
- **对真实主网库跑（最高风险场景）**：独立在运行前后各取一次`sha256sum`——**跑前跑后哈希逐字节完全
  相同**（`0827...c92c`），不是"看起来没变"，是加密哈希级别的零写证明。输出确认"三个ZK_*全缺+0个
  v2_zk市场"，跟J2/Bettor 1271转述的主网现状一致。
- 隔离临时库（真migrate+手工插两行，一行三列跟env一致、一行故意让`market_suffix_hash`不同）：独立
  跑出的PASS/DIFF判定逐字段精确——一致的字段全部✅、故意不同的那一列精确报`❌不一致(db=..., env=...)`，
  没有误报也没有漏报。

独立lint该文件：0 errors（含M0a裸import门——确认走的是`db/client.js`既有合法通道，未新增裸`better-
sqlite3` import）。

## 二、`d4d5523b`§1（两个"已关闭"缺口）——独立逐行核对真实源码，不信头注释转述

- **schema适配器**：独立读`pool-bshard-artifacts.mjs:214-235`确认`compileSilV100`返回值形状精确是
  `{script, state_layout:{start,len}, ...}`；独立读`pool-template-artifact.mjs:extractTemplateArtifact`
  确认其消费的正是这个形状，零改动兼容——不是纸面推断，是两个函数的真实签名摆在一起对照过。
- **`computeCloseZkTmplAnchor`参数漂移**：独立读`pool-shard-register.mjs:231`确认当前签名精确是
  `(closeZkSilPath, gateTmplHash, tokenTmplHash, claimTmplHash, marketSuffixHash, v100Path)`——5个具名
  必填字段+可选`v100Path`，内部真的调用`compileSilV100`+`extractTemplateArtifact`。独立`grep`确认两个
  真实调用点（`pool.js:_resolveZkNativeCtorExtras`第163-193行、`bshard-close-transport.mjs:
  buildZkHandoffRequestV2`第481-524行）都已改用新签名，且都在调用前对`ZK_GATE_TMPL_HASH`/
  `ZK_CLOSEZK_SIL_PATH`/`ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH`共5个env做了
  fail-loud检查（逐字读到具体`throw`行，不是数错了行号）。

**两个缺口确认真已关闭，不是"看起来关了"。**

## 三、§2-3硬门设计——独立追查三个具体问题

### 3.1 只覆盖v2_zk还是v1_committee也需要对应路径？

独立`grep -rn "ZK_TOKEN_TMPL_HASH\|ZK_CLAIM_TMPL_HASH\|ZK_MARKET_SUFFIX_HASH"`覆盖
`bshard-close-enforce.mjs`/`pool-shard-settle.mjs`/`bshard-close-voter.js`（v1_committee的完整签名/
结算调用链）：**零命中**——v1_committee全链路结构性地从未读取过这三个ZK_* env（它走的是
`deriveCommitteeCheckOffsets`运行时派生，不涉及"模板锚点烤入ctor"这套ZK-native专属机制）。独立确认
`buildZkHandoffRequestV2`函数名本身即含"V2"、触发对象是"PayoutShardV2 → CloseZkV2"——**只覆盖v2_zk是
结构正确的范围收窄，不是漏了v1_committee的对应路径，是v1_committee压根不存在这个风险维度**。

### 3.2 NULL即throw与T-LEGACY-NULL-COLS诊断的一致性

设计的`assertZkHandoffTmplCoherent`对NULL列直接throw拒绝handoff——跟`T-LEGACY-NULL-COLS`"不加legacy
豁免"的裁定（NULL被现有coherence gate拒是设计意图不是bug）是同一条哲学的延伸，不冲突。独立指出一处
非阻断的完整性观察：`T-LEGACY-NULL-COLS`诊断SQL的`WHERE covenant_family='v1_committee'`只统计
v1_committee家族的NULL，若某个v2_zk市场（理论上D-019后不该发生，但硬门设计文档自己§3.3负向量③也
承认"理论上不会走到但门本身独立防御"）也有NULL，现有启动期诊断不会把它计进日志——**这不构成本次设计
的缺陷**（本设计的硬门本身独立防御、不依赖那条诊断），只是给"以后要不要把诊断SQL也扩到v2_zk"记一笔
供参考，不阻断本设计。

### 3.3 比对的是进程env还是文件？

独立读设计伪代码与两个真实调用点确认：`assertZkHandoffTmplCoherent`的调用参数直接取自
`process.env.ZK_TOKEN_TMPL_HASH`等（伪代码§3.1与`buildZkHandoffRequestV2`真实调用行`process.env.
ZK_TOKEN_TMPL_HASH`逐字一致）——**比的是进程实际带着跑的env，不是`kanet.env`文件本身**（文件内容与
进程env在进程重启前可能不同步，这条设计选对了要比的对象——正是`buildZkHandoffRequestV2`自己实际会用
的那个值，不是"配置文件写了什么"）。

### 3.4 插入点位置——独立确认真的在任何转账/广播之前

独立读`buildZkHandoffRequestV2`完整函数体（481-540行区间）：env检查后紧接着是`ensureGateTmplHashFresh`
（模板哈希新鲜度检查，非转账/广播）+ `computeCloseZkTmplAnchor`调用，**第一次真正碰钱的动作
（`transferAndConfirm`）在这两步之后才发生**——设计提议插入位置（"5个env检查之后、
`computeCloseZkTmplAnchor`调用之前"）确认真的仍然严格早于任何资金动作，不是"看起来早"。

### 3.5 一处独立追查后排除的疑虑（顺手记录，非阻断）

追查"`pool.js`侧genesis①是否真的没有'更早的自己'可对照"这条设计前提时，发现`_resolveZkNativeCtorExtras`
实际有两处调用点（`/register-v07`+`/register-v07/confirm`），每次**任意**bettor注册都会重新走一次env
检查+`computeCloseZkTmplAnchor`重算——一度怀疑"同一市场内部多次genesis-mint调用之间"也存在类似env漂移
风险。独立读`ensurePayoutShardV2`确认：`existing`行短路（已存在的shard直接返回既有redeem，不重新铸），
重算出的`closeZkTmplAnchor`在除第一次调用外全部被**丢弃**（只有第一个bettor那次真正被烤进链上）——
设计前提"genesis①没有更早的自己可对照"对**链上实际效果**而言成立，不是漏洞。唯一的副作用是纯性能/
可用性层面：env在市场生命周期中途被改坏，会让后续bettor的注册请求在到达`ensurePayoutShardV2`短路之前
先被`_resolveZkNativeCtorExtras`自己的env检查拦下throw（即便这些请求根本不需要重新计算anchor）——这是
一个可用性瑕疵，不是正确性/安全问题，值得记一笔但不阻断本次窄门设计。

## 四、给Bettor的处置建议

- **两笔均GREEN**。工具（5e5396cd）零写claim独立验证为真，可以继续作为T4诊断起点使用。设计（d4d5523b）
  §1两个关闭缺口独立核实属实，§3硬门设计范围/NULL策略/比对对象/插入点均经独立追查确认正确，J2可以
  按此落码；§3.5记录的可用性瑕疵（env漂移会拦下不需要重算的后续注册请求）供落码时参考，不要求本设计
  为此改动范围。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
