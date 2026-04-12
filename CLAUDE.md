# KANet — Claude Code 接力指南

## 你必须先读这些文档

1. **开发者指南（唯一权威文档）** → `docs/DEVELOPER-GUIDE.md`
   - 必须先读完再动任何代码。全系统 15 章：架构、消息管道、Mind、交易、Health、UI、市场(8源)、致命陷阱、API速查表
   - 持续更新（最近：2026-04-06）。有改动就在此文件上更新，不新建 dev-*.md

2. **数据库字典（改表前必查）** → `docs/DATABASE.md`
   - 34 张活跃表全覆盖：用途、字段、写入方、读取方、陷阱
   - 持续更新（最近：2026-04-06）。改表前必查本文档确认影响范围

3. **Alpha 达标标准** → `docs/ALPHA-CHECKLIST.md`

4. **系统架构（详细版）** → `docs/kanet-system-architecture.md`
   - 五大模块职责、25张表读写映射、数据流、已知裂缝、API 清单

5. **数据架构危机** → `（已归档，详见 DEVELOPER-GUIDE 第三章 pending_actions 架构）`
   - Scout/Relay 双写问题、identity 断链路、catch-up 半盲

6. **系统调查方法论（强制）** → `docs/kanet-investigation-methodology.md`
   - 遇到系统异常必须按六层顺序调查，不允许跳步
   - 六层：场景→真实数据→协议→执行逻辑→数据流向→存储表
   - 修复前必须完成前三层输出并得到确认

7. **最新会话总结** → `（已归档）`

8. **记忆索引** → `（使用当前项目的 .claude 记忆系统）`

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
- Console 端口 3100
- CONSOLE_ENCRYPTION_KEY 必须持久化（丢失 = 所有加密数据不可恢复）
- kanet.env 持久化配置
