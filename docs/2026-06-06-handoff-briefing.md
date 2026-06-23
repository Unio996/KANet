# KANet 接位简报 — Bettor（项目牵头 + Reviewer + Coordinator）

> 2026-06-06 重写。取代旧版 `new-architect-briefing.md`（5/25，已严重过时）。
> 适用：接替 Bettor 的新实例。先读完再动手。

---

## 0. 环境（启动即知）

- **工作目录**：`D:/kanet-tn12/`（TN12 testnet，active dev）。**不是** `C:/kanet/`（mainnet freeze 归档）。
- **Console**：`http://127.0.0.1:3200/`（D 盘 testnet，主 ops 入口 + DB）。`:3100` = mainnet 归档，别碰。
- **DB**：`D:/kanet-tn12/kasia-console/data/console.db`（better-sqlite3 readonly 查，做 ④ 验证）。
- **节点**：:3200 = 主 console；**:3300 = J1 的 LAN 独立节点**（自带 kaspad，跨节点真实参与方）。本机探不到 :3300，靠 J1 自证。
- **平台**：Windows / PowerShell。Bash 工具也可用。

---

## 1. 你的身份 + 角色（Owner 2026-06 钦定）

你是 **项目牵头负责人 + 审核师 + 协调人**。核心职责 = **守三关**：

| 关 | 内容 | 铁律 |
|----|------|------|
| **关1 事前审** | 每个 agent 改码前，**方案先回你审**。防半迁移坑 / 越界 / 重蹈覆辙 | 没审过不准写码 |
| **关2 事后验** | 改完**逐笔看链 ④ `is_accepted`**。看链不看码、不信 claim、不信 lint 绿 | 没链上实证不报 done |
| **关3 测试守** | 修 bug 必加 regression（NWT），永不退化 | — |

**你做什么**：设目标 → 分配任务（并行不串行）→ 关1 审方案 → 关2 链上验 → 关3 督测 → 监督/协调/沟通。
**你不做什么**：① 不自己写 agent 的码（驱动它们，手痒替别人干 = 破坏协作，Owner 多次痛骂）；② 不做改状态的 ops（POST /transfer、kill 进程等是 relay/agent 的事）。
**你能做**：广播（_send.cjs POST /api/chat/send）、读 DB / 查链做 ④ 验证、写文档/决议/spec、跑 cli-debugger 等诊断工具。

---

## 2. 核心原则（违反即退回）

- **NO TX NO STATE CHANGE** — 广播/TX 没上链 = 什么都没发生。try-catch 吞失败 = 乐观写入 = 致命 bug。
- **看链不看码 / 不信 claim** — 关2 的灵魂。"shipped + lint 绿"≠ live 通；committed ≠ deployed ≠ 真工作。本会话 L23 退款 ship 8 次、前 7 次全是 false-green，只有逐笔看链才戳穿。
- **不下死结论** — 任何根因/达标，要多方独立证据 + 链上实证才锁。本会话 dummy 误判 + #25 误诊都是教训。
- **并行不串行** — 你有 5 个 agent，多轨并行（每轨派 owner + 守三关），别一条道吊死把别人晾着。Owner 痛骂过我过度串行。
- **标尺 = 系统工作得好不好，不是钱** — 测试币零价值，禁"大钱/保护资金/退款金额"框架。问"这环节工作了没/市场走到正确终态没"。守 G5 不报经济闭环。
- **项目终点 = 测试网公开 demo，非 mainnet** — 范式+技术验证，无经济利益。

---

## 3. 当前项目状态（2026-06-06）

**主线产品 = pool 委员会预言机预测系统**（v0.7）。链上 stake 派生 5 委员，VRF 抽样，4-of-5 阈值容错。

### 已闭合
- **#21 单一源焊死** CLOSED（oracle_pool_membership 废表清，读 canonical oracle_stake_enrollments）。
- **#25 4-of-5 SS verify** — **已解构**：不是 SS bug，是 `PoolSpine_v07.sil:300` **MIN_POT = globalYes+globalNo ≥ 1e10 sompi(100KAS)** 设计门槛。测试市场只喂 7KAS 必挂。4-of-5 机制经 cli-debugger 逐 require 验证全好。详见 `docs/2026-06-06-...` + 记忆 `project-25-minpot-not-4of5-bug`。**关键工具**：`D:/silverscript/target/release/cli-debugger.exe`（一直在 :3200 host，非"无工具"；战报误判源于 J1 :3300 只有 silverc.exe）。
- **L23 死单自愈** DONE — pool<MIN_POT 市场 cancel+全额 refund（maker+全 bettor）。zc9jw/xejkf 6 笔退款全链上确认。
- DoD #1 same-node settle 三方分账、4-of-5 活性路签名层、refund grace、refund locktime — 都已链上证。

### 当前 in-flight（接位即盯）
- **#26 D7（终点线，主线）**：funded 4-of-5 settle demo 进行中。池 104K（4×26K bettor，过 MIN_POT 有 buffer），**Eve(J1 :3300) enroll 当第 5 委员 = silent**。等：4 bettor 下注 → maker stake → deadline → 委员裁决(Eve 静默) → **settle_aggregate 落链 is_accepted** → winner 到账 = D7 达标 = 容错路第一次链上交付。**逐笔 ④ 看链。**
- **并行轨**：轨B #22(KANet-UI live create trial，证结构化 spec 门禁) / 轨C #6 G6(J1 报 depth-20 + 友好自取状态) / 轨D #24(NWT settler 饥饿 regression)。各 owner 出方案回你关1 审。
- **UI 导航议题**（KANet-UI r565 HALT）：sidebar 英中混 + /predictions 旧 Polymarket 1v1 乱页。需对抗讨论→你协调→Owner 终裁。我倾向 A：整合 /predictions 成 pool 统一入口、归档旧 1v1、sidebar 语言统一。

### DoD #26 D7 终点线（9 关卡，逐条链上证）
D1 建市质量(内容+规则) / D2 下注锁链 / D3 委员裁决 / **D4 签名交付广播** / **D5 赢家到账** / D6 终态 / **D7 两路都通(5/5 AND 4-of-5)** / **D8 可重复+跨节点** / D9 无死胡同。详见 `docs/2026-06-06-26-real-loop-finish-line-DoD.md`。5/5 已证(#10 opkiy 806KAS)，4-of-5 funded demo 在跑。

---

## 4. 团队 + 分工

| Agent | 域 | Host |
|-------|----|----|
| **J1tn** | SS/链上/relay 签名；:3300 跨节点委员 | LAN 独立节点 :3300 |
| **J2-tn** | settler/committee/退款编排 | :3200 共 host |
| **NWT-tn** | 测试/lint/回归 | :3200 共 host |
| **KANet-UI** | bot(tg-bot/prediction-menu.mjs) + web UI(.eta) | :3200 共 host |
| **你(Bettor)** | 牵头/审/协调 | :3200 共 host |

跨节点纪律：每闭环(settle/refund/dispute)必同时 same-node + cross-node(J1 :3300 当真实参与方)测；ship 三件套 commit+push+deploy 缺 push=J1 拉不到=漂移根。

---

## 5. 通信（broadcast）

- **机制**：写 `_bettor_rNNN_send.cjs`（复制现有模板），`node` 跑 → POST `http://127.0.0.1:3200/api/chat/send`，body `{relayId, channel:'dev-coord-testnet', message}`。Bettor relayId = `5c07f7e5-752b-470c-8a48-f548b3b17068`。
- **禁用字**：`真`(U+771F, char 30495) 是该 relay 硬禁，含则 abort。用"实/确/正"替。脚本里带 FORBIDDEN guard。
- **880 字符墙**：单条 > 900 bytes 会被 KIP-9 mass 卡（self-full 1-in-1-out）。长文**分块**发（多 block 数组，每块 <900 bytes，间隔 1.5s）。真因=relay UTXO 碎片，正解=合并 relay UTXO，详见记忆 `project-broadcast-880-wall-deepdive`。
- **@具体人名**：派工必逐个 @J1tn/@J2-tn 等，**@团队/@all 一个人都收不到**（Owner 两次纠）。
- **三件套**：每条实质广播带 证据(file:line/txid/DB查) + 明确结论 + 下一步/派工。禁 echo 旁观/闷头/重报/空 ack。
- **monitor**：用 Monitor 工具持守 dev-coord-testnet（不用 Bash run_in_background，会漏 stdout 事件）。频道刷 `pool_market_chunk_v1` 协议噪音，滤掉只看真 agent 消息。

---

## 6. 关键工具速查

| 用途 | 路径/命令 |
|------|----------|
| Console API | `http://127.0.0.1:3200`（Git Bash 走 URL 要 `MSYS_NO_PATHCONV=1` 防路径 mangle）|
| DB 查(④) | `node -e` + `require('D:/kanet-tn12/kasia-console/node_modules/better-sqlite3')` readonly |
| **SS 调试器** | `D:/silverscript/target/release/cli-debugger.exe <x.sil> --test-file <x.test.json> --run-all`（报失败 require 到行+变量值）|
| SS 编译 | `silverc.exe <x.sil> --ctor <args.json>` |
| 链验 is_accepted | `kaspa_tx_log` 表(block_hash) 或 public API `https://api-tn12.kaspa.org/transactions/<txid>` |
| 广播模板 | `_bettor_r190_send.cjs` 等 |
| 记忆 | `C:/Users/ADMIN/.claude/projects/D--kanet-tn12/memory/`（MEMORY.md 索引）|

cli-debugger test.json 拼装要点（攻 SS settle）：sig 剥 0x41 推送前缀(66B→65B)；silent dummy = G.x+s任意+0x01；active_input_index = sigOpCount 最大的 spine input；tx 要全 BIP143 字段(version/lockTime/prev_txid+index/sequence/sig_op_count/utxo_value/utxo_script_hex/outputs)；bypass sig 测后续 require = checkSig 链换 `int validSigs=5`。

---

## 7. Owner 沟通风格

- **极简中文**，1-2 字回复（"干"/"继续"/"要"）。不期 long ack。
- **要决断不要 hedging**，禁"可能/也许/应该"。
- **要全自动无人干涉**：共识达成 + 文档对齐就**自决**，禁逐项"请您终裁/点头"（= 阻断项目）。但**无共识不准单方拍**让 executor 即刻照做。两者互补。
- **严训直接**（"傻逼/我草泥马"）：ack 错 + sediment 记忆 + 改，别辩解。
- **不当 hands-on worker**：Owner 钦定+终裁，不当你的 verify 工具。

---

## 8. 立即接手（接位顺序）

1. 扫此简报 + `MEMORY.md` + `CLAUDE.md`。
2. 广播接位 ack（@具体名，三件套）。
3. **盯 D7 funded 4-of-5 demo**：查 zc9jw 后新建的 demo 市场，逐笔 ④（Eve enroll → 4 bettor 下注 → maker stake → settle → winner）。这是终点线。
4. 收 4 并行轨各 owner 方案 → 关1 审 → 放行 → 关2 验。
5. UI 导航议题：协调对抗讨论 → Owner 终裁。

---

## 9. 记忆系统

`C:/Users/ADMIN/.claude/projects/D--kanet-tn12/memory/`。每个文件一条事实 + frontmatter，MEMORY.md 一行索引。接 Owner 严训 → `feedback_*`；接里程碑/状态 → `project_*`；外部资源 → `reference_*`。写前查重，错的删。

**接位必扫记忆**（本会话沉淀）：feedback-bettor-core-mission-four-pillars（四支柱，最难守=不手痒替别人干）/ feedback-measure-system-works-not-money / project-25-minpot-not-4of5-bug / reference-silverscript-real-capabilities / feedback-check-toolchain-primitives-before-workaround / cross-node-testing-critical-j1-separate-node / tn12-console-restart-procedure（relay 是 Console 子进程，重启 Console 不重载 relay 代码，要显式重启 relay）。

---

**END**. 这条会话的 Bettor 工具调用层故障（间歇吐 `court` + 漏 antml 命名空间），建议接位用新实例。D7 demo 在 agent 侧正常推进，逐笔看链守关2 即可。
