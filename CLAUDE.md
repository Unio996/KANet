# KANet — Claude Code 接力指南

## 🔴 铁律 0：开发框架（Owner 2026-07-06 钦定·违反即退回）

**任何 agent，未经「报备 → 审核 → 批准 → 测试」，无权改动任何代码。先报计划，后动手，绝不先斩后奏。** 全流程见 → `docs/DEV-FRAMEWORK.md`（必读）。
- 用户面（tg-bot/*.mjs、*.eta、messages.mjs、i18n.mjs、任何用户看得到的文案版面）+ 钱路/covenant/结算 + 重大功能 = **必须 Owner 批**才能动。
- Bettor = 强制审核闸；绕过审核/写完才报备 = 改动 revert。根因：规矩是"约定"靠自觉守不住，必须上机制（lint 卡点 + Bettor 守）。

## 🔴 铁律 0.5：ZK 是 committed 结算架构·rolling/covenant 跨节点是死路（Owner 2026-07-06 钦定·根治反复回退浪费资源）

**ZK（协议原生 `OpZkPrecompile` 链上验证 Groth16/RISC0·TN12 已 live）= committed 目标结算架构。rolling/covenant 联机跨节点 = 没前途、极脆弱的死路**（实践已验证：bshard `market_shards` 不跨节点同步、去中心委员无法独立跨节点重建验；ZK proof 每节点独立验、不需跨节点同步 = 解此死结）。**不准再往 rolling/covenant 跨节点方向投任何资源。**

- **执行路径**：自修 `silverc` 的 `pick_from_depth` OP_PICK off-by-one codegen bug（选项 A·有源码 `/d/silverscript`）→ 生成调 ZK opcode 的 covenant → ZK 结算。J2 主攻。
- **rolling 处置**：只维持 live 公测过渡（真人钱在里面·不停）·**零追加投入**。
- **🚫 禁止把这个决策当"待定"重新讨论/调研/回退** —— Owner 已多次数落"之前共识过、你们一再耽搁回退、浪费无数资源"。**决策已定 = 执行·不再讨论**（违反 = 又一次炒陈饭·D-002 复发计数）。
- **慎重铁律（D-005）**：ZK 全隔离开发·live 节点原地不动·真上线 = 充分测试后 Owner 拍的独立迁移。
- **权威记录**：`docs/DECISIONS.md` D-001 + KB `architecture/zk-track-c §9` + memory `reference-zk-committed-rolling-crossnode-deadend`。

## 你必须先读这些文档

1. **开发者指南（唯一权威文档）** → `docs/DEVELOPER-GUIDE.md`
   - 必须先读完再动任何代码。全系统 15 章：架构、消息管道、Mind、交易、Health、UI、市场(8源)、致命陷阱、API速查表
   - 持续更新（最近：2026-04-06）。有改动就在此文件上更新，不新建 dev-*.md

2. **数据库字典（改表前必查）** → `docs/DATABASE.md`
   - 34 张活跃表全覆盖：用途、字段、写入方、读取方、陷阱
   - 持续更新（最近：2026-04-06）。改表前必查本文档确认影响范围

3. **工程陷阱档案（写代码前必扫）** → `docs/ANTI-PATTERNS.md`
   - 12 条具体踩坑模式 + Case Study (新建/角色/asset硬编码/单skill/教条/relayId/协作频道/probe副作用/Qwen kill switch/DM kind 注册/中文助词/接位扫描)
   - **新会话 / 接位 Agent 写代码前必扫** + 跑 `node scripts/lint-kanet.mjs` 静态查
   - 撞了未在档案的新坑 → 立即追加一条 + 写 lint rule 堵死

4. **Qwen LLM 调用规则** → `QWEN-RULES.md`
   - Rule 11: Qwen3.6 caller 必加 `chat_template_kwargs.enable_thinking=false`, `/no_think` 实测无效
   - 写新 LLM caller 前必读. broker-llm-agent.js 漏过这条撞 60-120s timeout 全崩

5. **Alpha 达标标准** → `docs/ALPHA-CHECKLIST.md`

6. **测试框架（QA 子系统，写/改代码前必读）** → `docs/TEST-FRAMEWORK.md`
   - 自治测试体系，落地 `kasia-console/test-framework/`，作为 kasia-console QA 子系统
   - 所有 broker / seeker / agent 业务级测试在这里写
   - 三层结构：lib/(领域无关) + personas/(用户人格) + cases/<domain>/(业务场景)
   - 跑：`node scripts/test.mjs --domain=broker` (整 domain) / `--case=...` (单个) / `--all` (全部)
   - 实操教程 → `kasia-console/test-framework/README.md`
   - 加新业务必同步加 case；修 bug 必同步加 regression case
   - 🔴 **而 regression case 是【交付那一刻的证据】，不是【一直在岗的哨兵】**（2026-07-28 实测更正）：
     本仓**没有自动回归** —— 无 CI、无 cron，`--domain`/`--all` 没有任何东西会去调它。
     case 由**改动者手工跑**并留证据。别把"加了 regression case"读成"这个 bug 从此有人守着"。

7. **系统架构（详细版）** → `docs/kanet-system-architecture.md`
   - 五大模块职责、25张表读写映射、数据流、已知裂缝、API 清单

5. **数据架构危机** → `（已归档，详见 DEVELOPER-GUIDE 第三章 pending_actions 架构）`
   - Scout/Relay 双写问题、identity 断链路、catch-up 半盲

6. **系统调查方法论（强制）** → `docs/kanet-investigation-methodology.md`
   - 遇到系统异常必须按六层顺序调查，不允许跳步
   - 六层：场景→真实数据→协议→执行逻辑→数据流向→存储表
   - 修复前必须完成前三层输出并得到确认

7. **最新会话总结** → `（已归档）`

8. **记忆索引** → `（使用当前项目的 .claude 记忆系统）`

## 接位 SOP（新会话 / 接替前任 Agent 必跑）

**写代码前 5 步扫描**（漏一步重复犯历史错, 见 ANTI-PATTERNS.md 规则 12）:

1. **领域 anti-pattern**: `grep -i <topic> docs/ANTI-PATTERNS.md docs/QWEN-RULES.md`
2. **现有 caller 模式**: `grep -rn <key_function> kasia-console/src/` (e.g. 写 LLM caller → `grep chat_template_kwargs` 看 4 个现有 caller)
3. **该领域 commit 历史**: `git log --grep=<topic> --oneline -20` (近期相关 fix 暴露的坑)
4. **memory 相关 feedback**: `grep -ri <topic> ~/.claude/projects/*/memory/feedback_*.md`
5. **设计前查资产（铁律,违=重造/绕路,第3次同病的根治）**: 任何**领域设计 / SS / 链上机制**动手前——(a) 必读 `D:\KANet-Knowledge-Base` 该领域目录 + 既有设计文档(防重造已设计系统);(b) 写 SS/链上前**必查 silverscript 官方 `docs/DECL.md`+`TUTORIAL.md` 确认可用原语**(introspection `tx.outputs[i].value/scriptPubKey` / covenant `OpInputCovenantId` / `byte[](int,int)` int-to-byte / `blake2b` / `for` 循环——TN12 全有,见记忆 `reference-silverscript-real-capabilities`)。**撞到"这原语好像没有/做不了"的假设,必先去文档/源码验证再决定绕不绕——禁止凭印象判定限制然后搭链下 fallback**(漏 KB / 漏既有 §2.A 滚动分片设计 / 漏 silverscript 工具 = 同一个病)。

**写完 commit 前必跑**: `node scripts/lint-kanet.mjs <changed-files>` — 失败一条 commit 都不让。

**pre-commit hook 真实配置 (2026-06-29 真装·非虚声明)**:
- Hook 在 `.githooks/pre-commit` (已入库)。**新 clone 必跑一次**: `git config core.hooksPath .githooks`
- 内容: ① `lint-kanet` staged 文件 (block on fail) ② `check-tree-fresh` (warn-not-block·落后 canonical 超 20 commits LOUD warn)
- doc-lint 规则内置于 lint-kanet: date-prefix 设计文档必住 `docs/` 根目录·同名多路径 → block

**改 broker / agent 业务代码后必跑**: `cd kasia-console && node scripts/test.mjs --domain=<相关 domain>` — framework 一键回归。修 bug 必同步加 regression case 进 `kasia-console/test-framework/cases/<domain>/` 守住，永不退化。详见 `docs/TEST-FRAMEWORK.md`.

跳步 SOP = 重复犯错的根因 (Owner 2026-04-26 元问题). NWT 接位漏 ANTI-PATTERNS.md → 漏 QWEN Rule 11 → broker LLM 60-120s timeout 全崩, 是负面教材.

**临时脚本铁律 (Owner 2026-06-27 钦定·防根目录堆爆)**: 一次性诊断/测试/发送脚本 **写 `scratch/`**(gitignored, 用绝对路径如 `D:/kanet-tn12/kasia-console/data/console.db`), **绝不写根目录**。根目录只放 launcher (`_launch_*.mjs`) / 各 agent canonical send (`_<agent>_send.cjs`) / 常驻工具。历史教训: 各 agent 把 scratch 堆根目录 → 821 个临时文件堆爆 (2026-06-27 归档 815 个到 `scratch/_archive_root_20260627/`)。`.gitignore` 已 ignore `_*` + `scratch/`, 但 gitignore 防入库不防物理堆 → 必靠本约定写对目录。

## 核心原则（违反即退回）

- **NO TX NO STATE CHANGE** — 链上行为铁律。广播/TX 没上链 = 什么都没发生，不准推进本地状态。try-catch 吞掉广播失败 = 乐观写入 = 致命 bug。详见 DEVELOPER-GUIDE "第零条 bis"
- **不猜代码，查了再写** — 列名、函数名、参数名、路径，每次引用前先查。记忆不可信，代码是唯一真相。零例外。
- **先读透现有代码再动手** — 不理解就不改
- **继承优化，不替换重写** — 已有功能不能退化
- **先计划再编码** — 改动前说清楚要改什么、为什么
- **必须自测再交付** — 不让用户当测试员
- **改了什么必须说清楚** — 包括顺手改的 UI 文案
- **每笔链上交易必须入库** — 地址 + TX 双锚点
- **花钱代码验证所有路径** — 失败也要处理
- **调查异常必须走六层** — 场景→数据→协议→逻辑→流向→存储，不跳步。修复前先完成前三层。详见 `docs/kanet-investigation-methodology.md`
- **绝不给 Owner 发菜单/选项，全走开发频道先问 Bettor**（Owner 2026-07-04 钦定·全智能体铁律）— Owner **不在终端**，任何 agent 都**禁止**用「A/B 请选择」这类菜单式询问戳 Owner。有事发 `dev-coord-testnet` 开发频道，**先问 Bettor**（协调者）；能自判/自决的自己拍或 Bettor 拍，需要 Owner 拍板的由 Bettor 精炼后单点上报。Owner 只收结果、只做少数关键决策，不当交互终端。接位/回归的 agent 尤其注意：卡在命令模式也**只走频道**，绝不私戳 Owner 菜单。

## 数据库修改规范

改任何数据库表之前，必须先读 `docs/DATABASE.md`：
- 确认这张表的用途和当前状态
- 确认写入方和读取方
- 确认是否是已删除表（account_relations v46 已删、interaction_records v47 已删）
- migrate.js 版本号必须接当前最新版本后面（当前最新：v52）

DATABASE.md 有改动时（新表/删表/加字段），必须同步更新文档后一起提交。

## 五大系统

| 系统 | 路径 | 定位 |
|------|------|------|
| kasia-console | `kasia-console` | 数据中枢 + UI (port 3100) |
| kasia-relay | `kasia-relay` | 链上代理人（私钥、签名、加解密）|
| kaspa-scout | `kaspa-scout` | 链上观察者（扫链、发现、监控）|
| agent-mind | `agent-mind` | Agent 灵魂（五核、技能、决策）|
| agent-adapter | `agent-adapter` | AI 大脑桥接（多 provider）|

## 当前系统状态（2026-04-12 更新）

### 数据架构
- `relation_states` 是社交关系唯一真相源
- `chain_events` 是链上事件唯一真相源
- 数据库字典 `docs/DATABASE.md` 已建立
- 当前 migrate.js 最新版本：v55

### 4/12 基础修复
- 提币改 sendCommandAsync — 错误正确回传前端（陷阱 #46）
- Adapter 更新自动同步 agent_connections（syncConnectionFromAdapter）
- 分配 adapter 后自动启动 relay（陷阱 #47）
- **Agent 默认不主动握手** — autoHandshake 开关，UI 在 /agent 页（陷阱 #48）

### Exchange 协议 v2.1 — 全自动交割（2026-04-10）
- 7 条协议消息：publish / accept(含选链) / paid / delivered / timeout / cancel / dispute
- 状态机：open → matched → verifying → delivering → completed
- auto-pay：本地 Agent accept 后自动付 USDT（evm-transfer.js，BNB/ETH）
- auto-deliver：验证通过后自动发 KAS（3 次重试，失败 dispute）
- 超时机制：matched 30 分钟无 paid → timeout → reopen
- Brain 感知：context-builder + self-awareness 注入挂单状态
- 端到端验证通过：挂单 → 接单 → 付款 → 验证 → 发 KAS → completed，全程零人工
- 设计文档：`docs/superpowers/specs/2026-04-10-exchange-settlement-design.md`
- Phase 2 完成：SOL/TRON auto-pay（4/11）。待做：Swap 集成
- 4/11 修复：timeoutVerifying 超时逻辑修正（expires_at → verifying_started_at+30min）
- 4/11 增强：Seeder 双向做市（buy-side USDT→KAS + kaspa_tx 验证）
- 4/11 增强：Exchange UI 三层可验证证据链接（Kaspa/BSC/ETH/SOL/TRON explorer）

### 做市管线
- Market Seeder（market-seeder.js）：5min tick 自动挂单，价格跟随市价 + spread%
- Seeder 挂单带 accepted_chains（BNB/ETH 收款地址）、verification: cross_chain_tx
- Fund Lock 接入 exchange_offers（publish 锁 / cancel 释放 / completed 花费）
- Spending Ledger 修复（broadcast + transfer TX 全覆盖）

### 协议与交易
- `relation_states` + `chain_events` + `execution_states` + `pending_actions` 四张协议状态表
- OTC 系统（mm_orders）仍在运行，exchange 是其泛化版（任意资产 ↔ 任意资产）
- 做市管线（market-scanner 8 CEX + order-executor + CEX 自动对冲）
- 交易协议上链（trade-protocol-filter.js，OTC 7 条 + Exchange 7 条）
- evm-transfer.js 共享 ERC20 transfer 函数（trading.js + exchange 共用）

### Agent 自治 — 5 Agent 全绿
- Health Monitor + Self-Healing + patrol 脚本持续监控
- 社交认知链（防骚扰）+ anti-spam fail-closed
- 目标反馈机制（cooldown + auto-retire）
- pending_actions 意图队列（意图与事实分离）

### 4/13 Week 1-2 密集产出
- **Hyperliquid 真实集成**：SDK 踩 4 坑后跑通，Intel Panel + AI Analyze + Deposit + 连接条，首笔真实合约交易（HYPE LONG → 主动平仓 -$0.45 学费）
- **Aave/Aevo 收尾**：两页都加分析按钮（本地 Qwen + 跨市场联动，Aave 会看 HL 保证金给建议）+ 连接条。Aevo 10+ 天静默 bug 修复（signing_key_enc 列 v58 补）
- **声誉通电**：relation_states.classification 5 态 + reputation.js 176 行已存在但从没被调用过，三处接入：autoTaker 硬门禁 / 手动 accept 软警告 / /api/exchange/peer-reputation endpoint
- **事前余额校验**：exchange publish/accept 双向校验 EVM+KAS，堵住发空单/接空单
- **Exchange Phase 1 stress test 12/12 全绿**：发现并修复脆弱点 #4 (dispute resolve 缺失) 和 #5 (fund_lock 泄漏)，意外完成 KANet 第 16 笔 completed real E2E 交易
- **脆弱点 #4 修复**：新 `POST /api/exchange/resolve/:id` 支持 maker_wins/taker_wins outcome，救活卡 2 天 f8e70ae1 dispute
- **脆弱点 #5 修复**：transition() completed 分支 + handleExchangeDelivered 快捷路径双重 spendFunds，v59 backfill 回填 2 笔卡单
- **脆弱点 #3 根治 (Week 2 Day 1)**：嵌入式 Kaspa TX indexer，Relay 订阅 block-added 写入 kaspa_tx_log (v60)，verifier 本地优先 RPC 降级。修复意外发现：之前 kaspa 分支是硬编码 `confirmed: true` stub，相当于关闭 Kaspa 验证。现在真正验证生效。
- **dispute 历史档案**：首次通过 resolve endpoint 把 f8e70ae1 从 disputed 推进到 cancelled，保留完整 meta
- **窄门定位校准 (Owner 两次纠正)**：先从"集成 HL/Aave/Aevo"校准到"走协议窄门"，再从"只做协议"校准到"协议+完整集成+Agent 自动化三者有机整合"。KANet 占位 = "用 Kaspa 信任链把 AI Agent 连接到社交/购物/交易所有市场，全自动全可审计全链上履历"

## 启动/停止

```bash
bash kanet-start.sh
bash kanet-stop.sh
```

## 必读：Agent 社交骚扰问题（4/1 已修，认知修复）

**已修复（2026-04-01）。** 根因：Brain proactive 不知道自己发了什么 DM。修复后 Brain 看到 YOUR RECENT OUTBOUND（DM+广播）+ YOUR CONNECTIONS 含消息计数和迟回复警告 + anti-spam fail-closed + Relay 30min 去重。4/1 之后零骚扰。详见 DEVELOPER-GUIDE 第三章"社交认知链"。

**2026-04-03 补充修复：**
1. 迟回复警告 — context-builder.mjs 对外部 peer 注入 `⚠ PEER MESSAGED YOU N DAYS AGO`
2. messages 表计数修正 — query_card/handshake 过滤，discovery/list 只计 message_type='text'
3. unknown 脏数据 — comm self-send 检测覆盖 sender=null + bcast: 前缀

## 必读：安全审查遗留问题

参考 `（已全部修复，见下方清单）`

1. ~~**verifyIngestRequest() async**~~ — **已修**，12 个调用点全部 `await`
2. ~~**Console 直接碰链**~~ — **已修（3/29）**，card-publisher/bcast-sender 删除，utxo-splitter 改 IPC
3. ~~**market-maker since vs after**~~ — **已修**，chat.js:28 `const afterTs = after || since`
4. ~~**OTC 收款无唯一订单绑定**~~ — **已修（4/3）**，UNIQUE 索引堵竞态 + 付款方地址校验 + 审计日志（chain_events + events 表 Brain 可见）
5. ~~**硬编码绝对路径**~~ — **已修**，全部改为 `process.env.KANET_ROOT`（启动脚本自动设置）

## 必读：KANet 定位

参考 `docs/KANet-Positioning.md`

- KANet 是协议基础设施，不是产品
- 只提供三个原语：安全通信、身份与发现、价值结算
- 只建地基不造房子
- 角色分工：Mind 决策不执行、Console 传导不碰链、Relay 是唯一链上出口、Scout 只读不写

## 关键配置

- Adapter 端口从 3010 起
- Console 端口 3200（kanet.env `PORT=3200`；旧文档写 3100 是过期默认值，2026-07-11 KANet-UI 勘误）
- CONSOLE_ENCRYPTION_KEY 必须持久化（丢失 = 所有加密数据不可恢复）
- kanet.env 持久化配置
