# KANet 决策日志 (DECISIONS.md) — 单一真值·防"炒陈饭"

> **为什么有这份**: Owner 2026-07-06 点出根因——"碎片化决策，老文档老决策早作废但没删没标，隔段时间又翻出来炒陈饭"。今晚 ZK/covenant 混乱就是 6/30 ZK 文档从没标"已被取代"、被翻出来当现行计划。
> **本文是"当前有效决策"的唯一权威索引。任何设计文档与本文冲突，以本文为准；老文档必须按下方机制标状态。**

---

## 📋 文档生命周期机制 (强制·不靠自觉)

**每份 `docs/YYYY-MM-DD-*.md` 设计/决策文档,顶部必须有状态头:**

```
> **Status**: CURRENT | SUPERSEDED-by <doc>(date) | ARCHIVED
```

- **CURRENT** = 当前有效,可据此决策/实现
- **SUPERSEDED-by X(date)** = 已被 X 取代,仅存档,**勿据此决策**。顶部再加醒目横幅:
  `> ⚠️ 本文档已被 [X] 取代于 [日期]·仅历史存档·勿据此决策实现`
- **ARCHIVED** = 历史记录(复盘/调查),非可执行计划

**卡点(TODO 落 lint-kanet)**: `docs/YYYY-MM-DD-*.md` 无 Status 头 → commit 亮灯。

---

## 🔴 当前有效的战略决策 (CURRENT)

### D-005 ZK/工具链研究隔离铁律 — 绝不碰 live 节点 (2026-07-06 · Owner 钦定·灾难级约束)
- **Owner 警告**: "这个不能轻易迭代·换了整个系统都会塌·慎重" + "你们自己去搜索研究"。
- **铁律**: ZK feasibility / silverc / rusty-kaspa 工具链研究 = **纯隔离**(独立 checkout / 测试环境)。**绝不 rebuild、绝不替换 live 节点的 rusty-kaspa build(1.1.1-toc.1 Toccata)**——覆盖 live 二进制 = 崩 bshard + 全部 live 市场 + 结算 daemon(配 memory reference-tn12-mining-external-bridge / covenant-wasm-breaks-selffull:绝不 rebuild D:/rusty-kaspa / 绝不 inprocess)。
- **可行性 ≠ 采用**: 就算 OP_PICK 在 silverc v2.0.x 修了 = 只是"ZK 技术可行"的证据。**采用/迁移 live 节点 = 另一个慎重的、充分测试的、Owner 拍板的独立决策·live 在那之前原地不动。** 研究归研究·迁移归迁移。
- **研究产出边界**: Track1 = 可行性结论(能编/不能编 + 证据)·零 live 触碰。
- **🔴 具体路径钉死(2026-07-06 near-miss·J2 自查拦下)**: **`D:/rusty-kaspa` = LIVE TN12 节点 `kaspad.exe` 的实际运行目录**(`D:\rusty-kaspa\target\release\kaspad.exe`)。**绝不在此目录 cherry-pick/build/任何写操作**——会污染 live 二进制、崩全 TN12 + 所有 live 市场。J2 差点在此 cherry-pick zk-sdk·例行查路径发现是活目录·及时停手。**R0ScriptBuilder/zk-sdk 等 → 全新独立 clone 目录**(如 `D:/rusty-kaspa-zksdk-clone`·独立 target/·跟 live 零关系)。
- **🔴 通用习惯(NWT 提·记 memory 族F)**: **任何写/build 操作前先查目标路径是不是活进程的目录**(tasklist/wmic 查 kaspad.exe/node.exe 实际路径)——"操作前查目标是否活"·别凭'我以为隔离'的印象(J2 一度错判 D:/rusty-kaspa 已隔离=只读·实为 live)。



### D-004 统一知识框架 — KB 做成唯一 durable 家·知识层上单一真值纪律 (2026-07-06 · Owner "把 KB 统一" · Bettor 出方案)
- **根因(读完 OIL-v0.3 框架后定位)**: 框架的**状态层(Ledger)有单一真值纪律**(§8.4 频道→Ledger 铁律),但**知识层(KB + 265 memory + 散 docs)从没上同纪律** → 知识散在四处、无单一入口、KB 烂尾在 6/28 → 每轮新 agent 拼碎片 → 漂移/炒陈饭。
- **方案: 每类知识一个家·分层定死**:
  | 层 | 唯一家 | 内容 | 纪律 |
  |---|---|---|---|
  | durable 知识 | **KB `D:/KANet-Knowledge-Base`** | 架构/定位/invariants/roles/ZK-covenant 决策 | 单一真值·状态头·持续 un-stale |
  | 当前决策口径 | **`docs/DECISIONS.md`** | 战略决策日志·谁取代谁 | 接位第一读·防炒陈饭 |
  | 协调状态 | **`docs/iteration/COORD-LEDGER.md`** | 当前进度/派工(框架 §1/§8.4 已有) | 频道→Ledger 铁律 |
  | 易变 sediment | **`.claude/.../memory`** | session 事实/feedback | 反增殖·按族合并·durable 提升进 KB(D-003) |
- **四个动作**:
  1. **KB README = 单一入口**: 每个接位从 KB README 进 → 路由到各层当前状态。
  2. **接位路由补缺口**(今天查实的): 每个 `开发智能体接位/*-接位.md` 必读**加 KB README + docs/DECISIONS.md**。
  3. **KB un-stale**: 更新 `06-ai-memory-system.md`(路径/纪律) + 把这周结算/ZK-covenant durable 知识沉淀进 `KB/architecture/`。
  4. **维护节律绑 D-002 retro**: 每轮 retro 把 memory 按族合并→durable 提升进 KB、标废文档、un-stale KB。KB 不再烂尾。
- **🔴 硬门(Owner 2026-07-06 裁定·防知识层规则49)**:
  1. **KB git 化 = 前置**(单点必须版本化·no commit no history)。✅ **DONE**: `D:/KANet-Knowledge-Base` git init·baseline `19a4155`·57 文件。后续 un-stale 均可考古 diff。
  2. **#3 大整合禁一把梭**(=知识层整页重写·规则49同病)。硬要求:
     - **清单先行(feature manifest)**: 264 memory 全量编号列表 → 每条标去向(合并进 KB 哪个文件 / 显式"弃置+理由")。**禁"合并后对不上账"**。清单出来先报,不动手。
     - **按族分族门控**: 每族一个 STOP 点·**合并 commit 与标废 commit 分开**·禁一周末干完 264 报 done。
     - **"方向 accept ≠ 免门控"**: Owner 认的是方向·不是免门控·每批 STOP 报告显式确认。
  3. **🟠 旧址同轮盖章(进 DoD·缺一不算完)**: 每合并一族·docs/ 对应旧址**同轮**挂状态头 `SUPERSEDED-BY: KB/<path>`——否则 agent 走老路照吃陈饭·真相源从 4 变 5。
  4. **🟡 顺序修**: 接位已先于 KB un-stale 路由(#1 先于 #3)→ 接位话术写死**"以 KB 状态头为准·无状态头条目视为 OPEN·不作施工依据"**(已补进 5 接位·下方)。
- **⚪ 疗效验收(唯一)**: 7/8 retro 加计数 **"本周炒陈饭事件数"**(agent 引用已废决策/重开已决议题次数)。此数不降 = KB 白建。落 FRAMEWORK-RETRO-TEMPLATE 表2。
- **纪律记账(Owner 2026-07-06)**: "已动手·不等" 仅限 Owner-裁-additive·**执行方不自封 additive**·下不为例。

### D-003 统一记忆框架 restore — 反增殖·反漂移 (2026-07-06 · Owner 诊断根因 · Bettor 认+落)
- **Owner 诊断**: "不断产生新记忆文件 = 碎片化根源 = 一直在漂移。我们有统一记忆框架,你早忘了。" 查实成立。
- **查实的漂移证据 (3 条·代码/文件级)**:
  1. 统一框架**存在且有定义**: `D:/KANet-Knowledge-Base`(KB·结构化) + `KB/infrastructure/06-ai-memory-system.md`(记忆系统框架·4 类 memory + MEMORY.md 索引 <200 行纪律)。
  2. **框架文档自己 stale**: `06-ai-memory-system.md` 最后更新 **2026-05-24**·还写记忆目录=`C--kanet`(D 盘迁移前老路径·实际已在 `D--kanet-tn12`)·框架没跟迁移更新。
  3. **纪律全废**: `.claude/.../memory/` **265 个文件**(框架写死 <200 行否则 truncate·早超·索引 truncate=框架自我失效)·KB 最后实质维护 ~**6/28**·这周结算/ZK/covenant 全散进碎片、**零回流 KB**。
- **对齐既有框架的修 (绝不另造新框架·那正是漂移)**:
  1. 更新 `06-ai-memory-system.md` 到现状(路径 `D--kanet-tn12`·当前纪律)·un-stale。
  2. **265 memory 按族合并**(DB-lag 族 / ZK-covenant 族 / phantom-leaf 族...)→ 回 <200 索引限。同 D-002 表2"规则档案健康度"的合并纪律,同一反增殖母题。
  3. **durable 知识沉淀回 KB**(结算架构现状 / ZK↔covenant 决策 → `KB/architecture/`·引 `docs/DECISIONS.md`)。
  4. **唯一更新纪律**: 新沉淀进【既有结构】——KB 存 durable 架构/决策·memory 存 session-fact(带合并纪律)·DECISIONS.md 存决策日志。**禁止散造新顶层文件/新框架。**
- **与 D-002/文档 lifecycle 的关系**: 文档 lifecycle(状态头) + D-002(规则档案不膨胀) + D-003(记忆反增殖) = **同一个反漂移系统的三个面**。母题都是 Owner 2026-07-06 诊断的"碎片化→炒陈饭→漂移"。

### D-002 框架迭代回路 (2026-07-06 · qzdh7nar 提 · Bettor 裁定采纳)
- **问题**: 框架只有"写入路径"(踩坑→沉淀规则),没有"迭代回路"(规则生效了吗→复发了吗→升级还是合并)。纯被动:每条规则的发现成本 = 一次真实损失 + 一次 Owner 暴怒。成熟度错标为"零事故",应为**同坑复发率 + 踩坑到机制化周期**(框架对 LLM 永不完备)。
- **裁定采纳的四机制**:
  1. **复发计数→升级非重申**: ANTI-PATTERNS "前科"从叙事变度量·复发=规则失败·"再次强调"是禁语(口头重申遵从率仅 70-90%)。
  2. **执法阶梯 L1-L4** (L1 文化/L2 checklist 门控/L3 lint 半机械/L4 结构性不可能): 任何在 L_n 复发的规则**自动升 L_n+1**。**细化(Bettor)**: L4"物理不可能"(如收回整文件 Write)只对**修复类任务**;**明确批准的重构类**走 D-编号解锁,否则真重构做不了。
  3. **定期框架 retro + 防档案自膨胀**: ANTI-PATTERNS append-only 已 49 条·会重演碎片化病(装不下→扫不全→等于没写)。CLAUDE.md 必读只留 **≤10 硬闸**,其余索引;"永不新建"管规则(能并进旧条不开新号);连续两期零触发的 L2 规则降载。
  4. **框架变更走 D-编号 + 先谈后做**: 每次改框架(加规则/升执法层级/合并)记一条 D-编号含推翻理由 → 框架有版本史·不能拿旧框架条文炒陈饭。
- **度量廉价**: 不建面板·retro 人工数三个数(复发次数/diff 预算超支/STOP 违规)。
- **交付物**: `FRAMEWORK-RETRO-TEMPLATE.md`(议程+三计数表+升级/合并/降载判定)·锚 **2026-07-08 go/no-go 首次 retro**·用世界杯软启动这周真实数据跑第一圈。qzdh7nar 出·Bettor 审。
- **触发本条的元事件**: 规则 49(整页重写)其实早有前科(retail-dex 1990 行/规则 1)却拖到 7 月才升硬闸——周期太长,正是本回路要治的。


### D-001 结算验证机制 — ZK 为 committed 目标架构 (2026-07-06 · Owner 拍板翻案 · 取代 7/3 rolling)
> **下轮 agent 查这条=现行决策。ZK 是 committed 方向·别再当'待定'重新讨论(炒陈饭 Owner 已数落两次)。KB §9 = 震荡史料·本条=最终决策。**

- **🔴 战略决策(2026-07-06 Owner 拍板·正式翻案 7/3)**: **ZK = committed 目标架构。** 理由(Owner 原话+技术依据): **"rolling 联机跨节点根本没戏·实践已验证"**——bshard rolling shard `market_shards` **不跨节点同步**(:3300 读不到·COORD-LEDGER 线6 记载)·去中心委员无法独立跨节点重建验 → cross-node/production 死路。**ZK proof 每节点独立验·不需跨节点同步 → 解此死结。** (Owner 强调此为"之前共识"·被团队 drift 遗忘·= 本 DECISIONS.md 反炒陈饭要根治的正是这个。)
- **🔧 执行路径 = 选项 A**: **自修 silverc `pick_from_depth` off-by-one codegen bug**(OP_PICK·有源码 `/d/silverscript`·13 轮 bisect 定位过·targeted 补丁)→ 生成调**协议原生 ZK opcode**(OpZkPrecompile·TN12 已 live)的 covenant → ZK 结算。**J2 主·J1 回来有 13 轮记录加速。**
- **🟢 rolling 处置**: **保持 live 公测运行(不停·真人钱在里面·三场 955 赢家已闭合)·但不再追加投入**——降为过渡/live-continuity·非目标架构。
- **⚠ 慎重铁律(D-005)**: 全隔离开发·live 节点原地不动·ZK 真上线 = 充分测试后 Owner 拍的独立迁移决策。
- **supersedes 链**: 6/28 Owner 钦定 ZK → 6/30 单片/多片 PROVEN(委员签名) → 7/3 rolling(过渡) → **7/6 Owner 拍板 ZK committed(本条·最终·rolling 降过渡)**。
- **✅ 执行路径实证达成(2026-07-06 14:44)**：选项 A(自修 silverc OP_PICK codegen bug)完成——根因定位(`compile.rs:3754`)+单行修复+cargo test全绿+§5四层验收全过。**KANet 历史上第一笔完整真实 ZK settle 交易 LANDED**(txId `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`，NWT 独立核实)——OP_PICK 修复+non-vacuous binding+continuation state转换+J1真实RISC0 guest算出的真实Groth16 proof(非fixture)全部环节首次同时在活链验证通过，零资金损失。详见 COORD-LEDGER 对应里程碑条目 + memory `project-first-complete-real-zk-settle-landed-2026-07-06`。**诚实标注**：这是"机制端到端跑通"的第一笔实证，尚未讨论生产化/规模化路线(委员共识层/多片等)，不越界声称"生产就绪"。

---

## ⚠️ 关键澄清: "ZK" 标签被误用 (2026-07-06 查实)

**今晚混乱的技术根源**: 文档里 **"ZK" 这个词被松散地贴在两块不同的东西上**,造成 Owner 以为在用密码学 ZK、实际是 committee-sig:

| 叫法 | 实际机制 | 状态 |
|---|---|---|
| "多片 ZK 自动结算" (6/30 卡) | **委员盲签 + driver-enforce (covenant)** ·文档原文"非 covenant 验 payoutRoot·委员盲签·非 production-trustless" | **在跑** (就是现在的结算) |
| 真·密码学 ZK proof (groth16) | RISC0 电路 + 链上验证证明 | **单片 pb73v LANDED·多片从未交付** (卡 silverc 编译器 bug) |

**正名规矩 (即刻)**: committee-sig/covenant 的活**不准叫 "ZK"**。"ZK" 一词只指真·密码学零知识证明。旧文档标题含 "ZK" 但机制是 committee-sig 的,必须在状态头注明。

---

## 📜 ZK ↔ covenant 决策时间线 (查实·git+文档+代码)

- **2026-06-02**: bshard 滚动分片设计 (押注侧 1→∞ 片·mass 封片) = Owner 终裁共识。**但其中"链下 committee-sig 结算"部分当时即被 Owner catch 推翻**,要求重做 trustless 链上。→ 押注侧滚动机制有效;结算信任侧待重做。
- **2026-06-20**: SIZE 墙 (9999 字节) → **committee-sig pivot** (迭代 consolidate·非 on-chain fold) 绕开。结算落回 committee-sig/covenant。
- **2026-06-28**: covenant settle 一整天炸脆性 bug (NUM2BIN/sighash/dup-addr...) → **Owner 钦定转真·ZK** (一周前既有方向)。复盘: `2026-06-28-zk-settle-pivot-retrospective.md`。
- **2026-06-30**: 单片真·密码学 ZK e2e LANDED (pb73v)。多片"ZK settle"装配卡 (Owner '干') → **但机制实为 committee-sig** (`2026-06-30-multishard-zk-settle-integration-card.md`·标题"ZK"名不副实)。
- **2026-07-01 ~ 07-06**: 多片 committee-sig/covenant 结算作为运行路径,加 rolling payout-shard(>1024)、daemon 自治、self-heal 等——**全是 covenant 路的工程化**,真密码学 ZK 未再推进。
- **2026-07-06**: 公测暴露 covenant 脆性 → Owner 重申 **ZK 唯一路径·作废 committee-sig 老路**。→ 见 D-001。

---

## 待补 (2026-07-06 建立·后续填全)
- [ ] 全库 `docs/*.md` 逐份加 Status 头 (Bettor 驱动)
- [ ] 6/30 ZK 卡等"ZK 名不副实"文档加 SUPERSEDED/正名头
- [ ] lint-kanet 加 Status-头缺失卡点
- [ ] J2 出密码学 ZK 多片 blocker 可行性核实 → 填 D-001 待办
