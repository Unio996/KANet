# KANet 数据真相源审计 — relation_states 贯穿度分析

> 2026-04-04 诊断。起因：用户发的"你好！"消息被 history-fetcher 补全、Relay 成功解密，
> 但写入了一个孤立的 conversation（无 remote_identity_id），UI 看不到。

---

## 现状：两套系统各自为政

```
系统 A: relation_states（设计上的唯一真相源）
  local_address + peer_address → status / trust_level
  ✓ contacts/list UI 读这里
  ✓ Mind context-builder 读这里
  ✓ anti-spam 读这里

系统 B: conversations + messages（实际数据存储）
  local_identity_id + remote_identity_id → 消息历史
  ✓ conversations UI 读这里
  ✓ Brain 回复写这里
  ✓ Episode 系统读这里

问题：A 和 B 之间的桥梁是 identities 表的 address ↔ id 映射，
但这个映射在多个环节断裂。
```

---

## 断裂点清单

### 断裂 1: ingestMessage 的 remoteAddress 为 null → 孤立 conversation

**位置：** `ingest-service.js:42` → `ensureConversation(network, localAddress, remoteAddress, traceId)`

**逻辑：** 如果 `remoteAddress` 为 null → `remoteId` 为 null → `upsertConversation` 查不到已有 conversation（因为已有的有 remote_identity_id）→ 创建新的空 conversation。

**触发场景：**
- history-fetcher 补全 comm 消息时，Relay 用 `findAddressByAlias` 找 sender，找不到就传 null
- comm 协议是 self-send，extractSender 对 self-send TX 可能返回 null

**影响：** 消息写到孤立 conversation，UI 看不到。

**正确做法：** 已知 localAddress 和 `for_address`（relation_states 里的 peer），应该直接用地址查 relation_states 拿到 peer_address 作为 remoteAddress。

### 断裂 2: conversations 和 relation_states 不联动

**现状：**
- `conversations` 表用 `local_identity_id + remote_identity_id`（identity UUID）
- `relation_states` 表用 `local_address + peer_address`（Kaspa 地址）
- 两者之间通过 `identities` 表的 `address ↔ id` 映射关联
- 但创建 conversation 时不检查 relation_states

**影响：**
- contacts/list（读 relation_states）显示有这个联系人
- conversations UI（读 conversations）可能找不到对应会话
- 同一个 peer 可能有多个 conversation（从不同路径创建的）

### 断裂 3: 消息计数来源不统一

**contacts/list 的消息计数：** 从 `chain_events` 表读（`comm`/`comm_sent`/`comm_received`）
**conversations 的消息计数：** 从 `messages` 表读（`COUNT(*) WHERE conversation_id = ?`）
**两者可能不一致。**

### 断裂 4: handshake 推进 relation_states，但 comm 消息不一定

**ingest-service.js:78-88：** handshake → `observeHandshake()`
**ingest-service.js:91-98：** text → `confirmSession()` + `activateRelation()`

但如果 remoteAddress 为 null（断裂 1），`confirmSession` 和 `activateRelation` 不会被调用（它们需要 localAddress + remoteAddress）。

---

## 应该的样子：relation_states 贯穿全链路

```
链上 TX 到达
  ↓
Scout/Relay 识别消息类型
  ↓
查 relation_states: local_address + peer_address
  → 状态推进（observed → accepted → confirmed → active）
  → 拿到确定的 local + peer 地址对
  ↓
查 identities: address → identity_id
  → 必有结果（handshake 阶段已创建 identity）
  ↓
查 conversations: local_identity_id + remote_identity_id
  → 找到已有 conversation（handshake 阶段已创建）
  → 绝不创建新的（relation_states 里有记录 = 一定有 conversation）
  ↓
写 messages: conversation_id + sender + receiver
  → 一定不为 null
  ↓
UI 读 conversations + messages
  → 一定看得到
```

**核心原则：任何消息写入 messages 表之前，必须先通过 relation_states 确认身份。如果 relation_states 里没有这对地址 → 消息来自未知来源 → 不应该写入 conversations（写入 chain_events 做归档即可）。**

---

## 修复方案

### 阶段 1: 修复 ingestMessage 的 conversation 查找逻辑

**改 `ensureConversation`：**
1. 如果 remoteAddress 为 null → **不创建 conversation**，返回 null
2. 如果 remoteAddress 有值 → 先查 relation_states 确认这对地址存在
3. conversation 查找用 **address** 不用 identity_id（避免多个 identity 指向同一地址的问题）

### 阶段 2: 修复 history-fetcher → Relay 的 sender 传递

**改 `/ingest/historical-comm`：** 存 `from_address`（从 API 拿到的）
**改 `/ingest/pending-comms`：** 返回 `from_address`
**改 Relay catch-up：** 不用 `findAddressByAlias`，直接用返回的 `from_address`

### 阶段 3: 清理孤立数据

- 删除 remote_identity_id 为 null 的 conversations
- 把其中的 messages 重新关联到正确的 conversation

---

## 数据流向图（修复后）

```
            relation_states（唯一真相源）
              ↕ 读/写
          ┌─────────────────────────────────┐
          │   ingest-service.js             │
          │                                 │
TX 到达 → │ 1. 查 relation_states(local,peer)│
          │    → 确认身份                    │
          │ 2. 查/创建 identity(address)     │
          │    → 拿到 identity_id           │
          │ 3. 查 conversation(local,remote) │
          │    → 拿到 conversation_id       │
          │ 4. 写 messages                  │
          │ 5. 推进 relation_states 状态     │
          └─────────────────────────────────┘
              ↕
          contacts/list  → 读 relation_states
          conversations  → 读 conversations + messages
          Mind context   → 读 relation_states
          Episode        → 读 chain_events + messages
```
