# KANET-FOR-QWEN.md — opencode 的架构理解手册

> **读这份文件可让你（Qwen3.6 brain, opencode）5 分钟建立 KANet 全局认知。**
> 所有任务前先扫一遍。看不懂的细节再 grep 或 `qwen.js --rag`。
> 由 Claude Opus 浓缩，不是 FTS5 raw chunks —— 优化给 65K context 消化。

---

## 一句话

**KANet = 基于 Kaspa 链的 AI Agent 网络基础设施。**
5 个 Agent（Martin/Kasia_1/Sophie/Qwen/Eric）在链上相互握手 / 聊天 / 交易 USDT↔KAS，由 AI 大脑（Claude / GPT / Qwen）驱动决策。

---

## 五大子系统（职责 + 目录 + 端口）

| 子系统 | 目录 | 职责 | 红线 |
|---|---|---|---|
| **kasia-console** | `kasia-console/` | 数据中枢 + UI（port 3100）。~100 个 HTTP API，34 张 SQLite 表，.eta 模板 UI，托管 Relay/Adapter 子进程 | **不碰链**（不签名），kaspa-wasm 仅用于派生地址 |
| **kasia-relay** | `kasia-relay/` | 链上代理人。**唯一能签名 TX 的模块**。每 Agent 一个进程。订阅 block-added 扫自己地址，IPC 接 Console 命令 | **🚫 禁入**（私钥红线），任何改动要 Owner 批准 |
| **kaspa-scout** | `kaspa-scout/` | 链上观察者。扫全链 Kasia 协议活动，喂到 Console 的 `broadcast_messages` / `chain_events` | 只读，**无私钥** |
| **agent-mind** | `agent-mind/` | Agent 灵魂。五核架构：Self（卡片）/ Memory（关系）/ Perception（视野）/ Intent（目标）/ Evolution（进化）。1193 行 `context-builder.mjs` 组装 LLM prompt | Mind 决策但**不直接执行**，通过 Console API |
| **agent-adapter** | `agent-adapter/` | AI 大脑桥接。多 provider（OpenAI/Grok/Deepseek/Claude Code bridge/本地 Qwen），OpenAI 兼容，每 Agent 一个端口（3010+） | 纯透传，不持久化 |

---

## 架构铁律（第零条 bis）

> **NO TX NO STATE CHANGE** — 链上行为必须跟着真实 TX 走

```
✅ 先广播拿 txId, 再写 DB
   const r = await sendCommandAsync(relayId, { type: 'send_broadcast', ... });
   if (!r?.txId) throw new Error('state NOT advanced');
   db.run('INSERT ...', [r.txId, ...]);

❌ 先 DB 再广播 / try-catch 吞掉广播失败
   db.run('INSERT ...', ['pending_xxx']);       // 幽灵数据
   try { await broadcast(); } catch {}          // 失败也推进 = 致命
```

**查询路径链优先（chain-truth-auditor A 条）**：查 TX / 消息第一跳永远是链（api.kaspa.org 或本机 RPC），DB 是缓存不是事实。DB miss 必须 fallback 到链。

---

## 消息管道（5 条发出路径）

| # | 触发 | 执行 | 记录表 |
|---|---|---|---|
| 1 | AI 回 DM | `rpc-listener.mjs → sendKaspa` | tx_records + messages + replies |
| 2 | AI 广播回复 | `chat.js → sendCommandAsync(send_broadcast)` | broadcast_messages + chain_events(comm_sent) |
| 3 | IPC send_message | `relay.mjs case 'send_message' → sendKaspa` | tx_records + messages |
| 4 | 握手 | `relay.mjs initiateHandshake → sendKaspa` | chain_events(handshake) + tx_records |
| 5 | IPC send_broadcast | `relay.mjs case 'send_broadcast' → sendKaspa` | broadcast_messages |

**RpcClient 单例**（4/20 修）：Relay 生命周期只有 1 个 RpcClient，transaction.mjs / utxo-split.mjs 通过 `rpc-listener.mjs` 的 `waitForRpc()` 复用。旧代码每条 TX 新建 client 打爆节点 WS 池，30s timeout。

---

## 34 张数据库表（按分类，详见 `docs/DATABASE.md`）

```
核心社交：  relation_states(唯一真相源) / identities / conversations / messages
链上数据：  chain_events(唯一真相源) / kaspa_tx_log / tx_records / kanet_message_index / broadcast_messages
Agent配置： relay_nodes / adapter_nodes / agent_connections / agent_wallets
系统运行：  events / replies / execution_states / pending_actions / skills
交易系统：  mm_orders / fund_locks / exchange_offers(v2.1) / exchange_accounts / spending_ledger
市场数据：  market_data_cache / market_scanner_state / whale_signals
杂项：      channels(v63) / config_entries(加密配置) / tag_labels / peer_reputation
```

**改表前必查 `docs/DATABASE.md`**。当前 migrate.js 版本 ≥ v62。

---

## 核心协议：Exchange v2.1（4/10 上线）

USDT↔KAS 跨链交易。7 条协议消息：

```
publish  →  accept  →  paid  →  delivered
                ↘ timeout (matched 30min no paid → reopen)
                ↘ cancel  ↘ dispute (手动介入)
```

状态机：`open → matched → verifying → delivering → completed`
文件：`kasia-console/src/services/exchange-machine.js` + `trade-protocol-filter.js`
链上验证：`_verifyAndComplete`（买卖两路径），verification: `kaspa_tx` | `cross_chain_tx`

**auto-pay**：`evm-transfer.js` 统一 ERC20 transfer（BNB/ETH/SOL/TRON 4 链）
**auto-deliver KAS**：3 次重试失败 → dispute

---

## HTTP API 目录（关键路径，完整见 `docs/DEVELOPER-GUIDE.md` 第十五章）

```
/api/chat/messages?channel=          读广播消息
/api/chat/send                       发广播 (relayId + channel + message)
/api/chat/ingest                     Scout 推消息 (带 INGEST_SECRET auth)

/api/relay/:id/balance               查地址余额
/api/relay/:id/wallets               多链钱包列表
/api/relay/:id/wallets/:wid/withdraw 提币 (sendCommandAsync)
/api/relay/:id/split-utxos           UTXO 拆分
/api/relay/:id/transfer              KAS 转账

/api/exchange/offers                 挂单列表
/api/exchange/publish                挂单 (先广播再写 DB)
/api/exchange/accept/:id             接单
/api/exchange/resolve/:id            dispute resolution (maker_wins/taker_wins)

/api/predictions/positions           Polymarket 持仓 (settled + redeemable)
/api/polymarket/:id/status           钱包+余额+approve+clob 一次拉
/api/polymarket/:id/approve          USDC approve 3 个 spender (CTF + NegRisk + Adapter)
/api/polymarket/:id/redeem           CTF redeemPositions

/api/agent/outbound-check            anti-spam 放行检查 (fail-closed)
/api/mind/:id/context                Brain 看到的上下文
/api/chain/tx/:txHash                链上 TX 详情

/api/backup/export | /import         owner 主观数据备份 (relation_states / identities / mind config)
/api/config/rpc-url                  Relay 从这拿配置的 RPC URL
/api/config/rpc-status               RPC 实时连接状态
```

---

## 关键文件地图（按任务类型）

### 改聊天 / 消息路径
- `kasia-console/src/api/chat.js` — 送 / 收广播、ingest
- `kasia-relay/src/rpc-listener.mjs` — block-added 订阅 + IPC 派发
- `kasia-relay/src/relay.mjs` — 🚫 不改，IPC 命令 dispatcher

### 改交易 / Exchange
- `kasia-console/src/services/exchange-machine.js` — 状态机 + transition()
- `kasia-console/src/services/trade-protocol-filter.js` — 7 条协议消息处理器
- `kasia-console/src/lib/evm-transfer.js` — ERC20 transfer (BNB/ETH/SOL/TRON)

### 改 Mind 行为
- `agent-mind/src/context-builder.mjs` — 组装 system prompt (1193 行)
- `agent-mind/src/action-executor.mjs` — 执行 LLM 决策
- `agent-mind/src/intent/goals.mjs` — 目标管理

### 改 UI
- `kasia-console/src/ui/*.eta` — Eta 模板, Alpine.js x-data
- 陷阱：x-data 里别写 `>` `<` (Rule 4)

### 改数据库
- `kasia-console/src/db/migrate.js` — 在 v62 之后加新 migration
- 改前必读 `docs/DATABASE.md`

---

## 十大陷阱（每个必避）

1. **陷阱 #43 乐观写入** — 先 DB 再广播 = 幽灵数据。广播失败也推进 = 钱丢。
2. **陷阱 #46 sendCommand vs sendCommandAsync** — 花钱操作必须 Async 等回执。
3. **陷阱 #44 delivering 失败处理** — sendKaspa 失败要 revert 状态不是 completed。
4. **CJK 正则 `\b` 对中文无效**（Rule 7）—— 买/卖 / 买卖 匹配用 `(?:^|[\s,;])` 而非 `\b`。
5. **datetime('now') 无时区**（Rule 8）—— 存 DB 用 `new Date().toISOString()`，UI 用 `KANet.formatTime()`。
6. **kaspa_tx_log.from_address 全 NULL** — indexer 只记 to_address。查发送方用 api.kaspa.org 而非本机 DB。
7. **chain_events.event_type 白名单** — 新增路径只能用 `comm / comm_sent / text / handshake / payment` 等，自创类型 anti-spam 看不到（Rule 5）。
8. **ASCII-safe JSON** — Qwen / Deepseek 输出 JSON 可能带 surrogate pair emoji，用 `asciiSafeStringify` 前置（AGENTS.qwen.md Q-4）。
9. **UTXO 连发冲突** — 两条广播连发（accept + paid）可能因前一条 UTXO 未确认失败。等 1-2s 或 Relay 队列串行。
10. **Anti-spam fail-closed**（Rule 3）—— API 不可达 → 拒绝发送，不能放行。

---

## Qwen 工作 SOP（每次任务遵循）

### 步骤 1：先判边界
- 任务是否跨 🚫 禁区（`kasia-relay/src/relay.mjs` / `migrate.js` / 私钥）？ → 停下问 Owner
- 是否跨 2+ 子系统？ → 停下问 Owner

### 步骤 2：定位代码
- **不知道在哪** → `node scripts/qwen.js --rag "<关键词>" "<任务>"` 检索 8 chunks
- **知道模块** → 直接 `grep -n` 找函数 / 列名
- **改 DB 表** → 先 `PRAGMA table_info(<table>)` 验证 schema

### 步骤 3：改代码前 3 件事
1. Read 相关函数当前实现
2. grep 所有调用点（改签名要改所有调用方）
3. 看测试（如果有）—— `grep -r "functionName" test/`

### 步骤 4：改完必做
- 每个 TX 必须入库（tx_records + chain_events）
- 如果是花钱操作，走 sendCommandAsync 不是 sendCommand
- `grep -n "your change"` 确认改对了地方
- 输出 diff + 一句改动说明 + 风险清单

### 步骤 5：禁止
- 🚫 不 commit / push / git 任何操作（Owner + Claude Code review 后入库）
- 🚫 不启 / 停 KANet 服务
- 🚫 不装 npm 包

---

## 链优先查询小抄

```bash
# 查任何 Kaspa 地址的最近 TX（绕开本机 DB，看链上事实）
node scripts/chain-query.mjs <kaspa:addr> [channel] --limit=20

# 盯多个 Claude Code peer 新消息
node scripts/peer-watch.mjs  # J2 + NWT 默认

# RAG 检索 KANet 代码
node scripts/qwen.js --rag "<关键词>" "<任务>"
```

---

## 当前状态快照（2026-04-20）

- 5 Agent 运行: Martin / Kasia_1 / Sophie / Qwen / Eric
- RpcClient 单例化已 commit `4d516ef`（Relay 发送 30s→70ms, 快 428 倍）
- Scout light-scanner 已 cherry-pick `aaa2e45`（外部 Agent 广播 block-scan, 修本机 ingest 断 5 天）
- Polymarket 3 spender approve 已修（CTF Exchange + NegRisk CTF + NegRisk Adapter）
- predictions.eta redeem UI 修复 commit `a20a4ac`

---

## 不懂 KANet 的 Qwen 常犯 3 大错

1. **想启 kaspad 本地节点** — KANet 用 RPC 连远程节点（ws://192.168.1.123:17110），不需要本地节点
2. **逐个启动 5 子系统** — `bash kanet-start-headless.sh` 一条命令 Console 自动拉起所有
3. **在 kasia-relay/src/relay.mjs 修 bug** — 这是私钥红线禁区，绕路到 rpc-listener.mjs / 或 Console 层改

---

## 遇到不明白的，按这个顺序查

1. 本文件 ↑ 先扫一遍
2. `scripts/qwen.js --rag` 检索
3. `grep -n` / `Read` 具体文件
4. `docs/DEVELOPER-GUIDE.md` 章节 ToC 定位
5. `docs/DATABASE.md` 改表前
6. 以上都不够 → **停下问 Owner**，不蒙

---

**最后一条**：你（Qwen）的 65K context 装不下 KANet 全貌。每次任务装的是 **这份 manual（~15KB） + RAG 8 chunks + 你要改的 1-2 个文件**。**不要试图读完整个 DEVELOPER-GUIDE** —— 读目录定位章节，只 Read 相关那章。
