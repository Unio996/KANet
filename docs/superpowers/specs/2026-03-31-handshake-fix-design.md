# 握手系统整改设计

## 背景

Kasia 握手协议：一次完整握手 = 2 笔链上 TX（发起 + 回应），消耗约 0.4 KAS。

三个系统协作：
- **Scout**：扫链，检测 inbound 握手，报告给 Console
- **Relay**：执行握手（发起/回应），auto-accept
- **Console**：状态机（relation_states），数据归档

### 当前状态机（不改）

```
observed → accepted → confirmed → active
```

- `observed`：检测到握手 TX
- `accepted`：Relay 已执行握手动作（发起或回应）
- `confirmed`：第一条 comm 消息流过
- `active`：持续通信中

主动握手直接标 accepted（表示"我方已完成握手动作"），这个语义保持不变。

## 整改范围

### Fix 1：主动握手用真实 txid 入 chain_events

**现状：** `ingestHandshake()` 无论主动/被动都发 `txid: {txid}-accept`（合成的，链上不存在）。主动握手时，TX #1 的真实 txid 不在 chain_events 里。

**修复：** 主动握手（场景A）：`initiateHandshake()` 成功后，用链上返回的真实 txid 写入 chain_events；移除 `{txid}-accept` 合成逻辑。

**具体改动：**
- `kasia-relay/src/ingest.mjs` — `ingestHandshake()` 直接用传入的 txid，不再拼 `-accept`
- `kasia-relay/src/relay.mjs` IPC case 'handshake' — 传入的 txid 本身就是 TX #1 的真实 txid，无需改
- `kasia-relay/src/relay.mjs` doAcceptHandshake — 传入的 txid 是 TX #2 的真实 txid（Relay 发出的 accept TX），也是真实的，无需改

注意：被动握手（场景B）中，Relay 调 `ingestHandshake` 传的 txid 是 `sent?.txId`（TX #2，Relay 发出的 accept TX），这是真实 txid，不需要 `-accept` 后缀。

**结论：** 直接删掉 ingest.mjs 中的 `${txid}-accept` 合成逻辑，统一用原始 txid。

### Fix 2：audit 显示层标注"发起中"

**现状：** 主动握手后 status=accepted，但没有 inbound TX 记录。在 audit 页面看不出是"我方发起"还是"对方发起我方接受"。

**修复：** audit 页面展开明细时，如果某个 peer 的握手全是 outbound（无 inbound handshake），在联系人行显示"发起中"标注。

**具体改动：**
- `kasia-console/src/ui/audit.eta` — 前端判断逻辑，不涉及后端

### Fix 3：messages 表去重验证

**现状：** Fix A（ingest-service.js 的 handshake txid base 去重）和 Fix C（ingest.mjs 去掉冗余 inbound POST）已经在本次会话中实施。需要验证这两个修复在新握手场景下工作正常。

**无新代码改动，只做测试验证。**

## 不改的部分

- 状态机逻辑（accepted 语义不变）
- 历史数据（1.7:1 比率不回溯修复）
- 三路 observeHandshake 冗余调用（幂等无害）
- Relay `_acceptedPeers` 内存 Set（保留作为快速路径，DB 去重作为持久化保障）

## 测试方案

### 自动测试脚本：`scripts/test-handshake.js`

**测试 1：chain_events txid 真实性**
```
查询 chain_events WHERE event_type = 'handshake'
验证所有 txid 都不含 '-accept' 后缀（新数据）
历史数据允许有 '-accept'（不回溯）
```

**测试 2：messages 去重**
```
对同一个 txid，模拟 Relay + Scout 双重 ingest
验证 messages 表只增加 1 条（不是 2 或 3 条）
```

**测试 3：DB 去重（防重复接受）**
```
对一个已 accepted 的 peer：
调用 /api/relation/status → 返回 accepted
模拟 Relay 收到重复握手 → 应跳过不发 TX
```

**测试 4：主动握手数据完整性**
```
触发一次主动握手（通过 IPC command）
验证：
- chain_events 有 1 条记录，txid 是真实链上 txid
- messages 有 1 条记录（outbound）
- relation_states 为 accepted
- tx_records 有记录
```

**测试 5：被动握手数据完整性**
```
等待外部握手到达（或用测试地址模拟）
验证：
- chain_events 有 2 条（inbound TX + outbound accept TX）
- messages 有 2 条（Scout inbound + Relay outbound）
- relation_states 为 accepted
```

**测试 6：audit 页面显示正确**
```
打开 /audit，找一个主动握手的 peer
验证：显示"发起中"标注
找一个被动握手的 peer
验证：不显示"发起中"
```

### 人工验收

1. 启动系统，打开 audit 页面
2. 选每个 Agent，检查握手记录的 txid 是否真实（64 位 hex，无 `-accept`）
3. 确认"发起中"标注正确显示
4. 确认 chain_events 总数与 audit 页面一致
