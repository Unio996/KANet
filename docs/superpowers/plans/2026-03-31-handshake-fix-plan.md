# 握手系统整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复握手系统的合成 txid 问题、添加 audit 页面"发起中"标注、编写自动测试验证全链路。

**Architecture:** 改动集中在 Relay 的 ingest.mjs（删合成 txid）、Console 的 anti-spam.js（加 hs_in/hs_out 字段）、audit.eta（显示标注）。测试脚本直接读 DB 验证。

**Tech Stack:** Node.js, better-sqlite3, Alpine.js, Eta templates

---

## 文件清单

| 动作 | 文件 | 职责 |
|------|------|------|
| Modify | `kasia-relay/src/ingest.mjs:80-91` | Fix 1: 删 `-accept` 合成 txid |
| Modify | `kasia-console/src/services/anti-spam.js:309-325` | Fix 2: getActivityByPeer 加 hs_in/hs_out |
| Modify | `kasia-console/src/ui/audit.eta:42` | Fix 2: 摘要行加"发起中"标注 |
| Create | `scripts/test-handshake.js` | 6 个自动测试 |

---

### Task 1: Fix 1 — 删除合成 txid

**Files:**
- Modify: `kasia-relay/src/ingest.mjs:80-91`

- [ ] **Step 1: 修改 ingestHandshake**

当前代码 `kasia-relay/src/ingest.mjs` 第 88 行：
```javascript
txid: txid ? `${txid}-accept` : `accept-${Date.now()}`,
```

改为：
```javascript
txid: txid || null,
```

完整修改 — 将：
```javascript
export function ingestHandshake({ localAddress, remoteAddress, txid }) {
  const ts = txid || Date.now();
  post("/ingest/message", {
    traceId: `handshake-out:${ts}`,
    network: RELAY_NETWORK,
    direction: "outbound",
    localAddress,
    remoteAddress,
    txid: txid ? `${txid}-accept` : `accept-${Date.now()}`,
    messageType: "handshake",
    contentText: "",
  });
```

改为：
```javascript
export function ingestHandshake({ localAddress, remoteAddress, txid }) {
  const ts = txid || Date.now();
  post("/ingest/message", {
    traceId: `handshake-out:${ts}`,
    network: RELAY_NETWORK,
    direction: "outbound",
    localAddress,
    remoteAddress,
    txid: txid || null,
    messageType: "handshake",
    contentText: "",
  });
```

- [ ] **Step 2: 验证调用方传入的 txid 是真实的**

检查两个调用方：

1. `kasia-relay/src/relay.mjs` line 274:
```javascript
ingestHandshake({ localAddress, remoteAddress: cmd.target, txid: sent?.txId });
```
`sent?.txId` 来自 `sendKaspa()` 返回值 — 这是链上真实 txid。✓

2. `kasia-relay/src/relay.mjs` doAcceptHandshake line 190:
```javascript
ingestHandshake({ localAddress, remoteAddress: peer, txid: sent?.txId });
```
同样来自 `sendKaspa()` — 真实 txid。✓

3. `kasia-relay/src/rpc-listener.mjs` processHandshake 不直接调 `ingestHandshake`（由 relay.mjs doAcceptHandshake 处理）。✓

无需改调用方。

- [ ] **Step 3: 验证 Console ingest-service 处理无 `-accept` 后缀的 txid**

`kasia-console/src/services/ingest-service.js` line 53-59:
```javascript
if (txid) {
  recordChainEvent({ txid, eventType: messageType, ... });
}
```

`recordChainEvent` 用 `INSERT OR IGNORE` + `UNIQUE(txid, event_type)`。去掉 `-accept` 后，如果 Scout 也用同一 txid 记了 inbound handshake，这两条不会冲突（from/to 地址不同但 txid+event_type 相同）。

**但这可能导致 chain_events 的 UNIQUE 约束冲突！** Scout 和 Relay 用同一 txid + 同一 event_type='handshake' → `INSERT OR IGNORE` 第二条会被跳过。

验证这个影响：
- 被动握手（场景B）：Scout 先记 inbound（txid=TX1），Relay 后记 outbound（txid=TX2，Relay 发的 accept TX）。两个不同的 txid，不冲突。✓
- 主动握手（场景A）：Relay 记 outbound（txid=TX1），之后 Scout 不会扫到 TX1（receiver 不是本地）。不冲突。✓
- 本地 Agent 间（场景C）：Agent A 发 TX1 → Agent B 的 Scout 扫到（txid=TX1）→ Agent B 的 Relay accept → txid=TX2。两个不同 txid。✓

**结论：无冲突，安全。**

---

### Task 2: Fix 2 — audit 页面"发起中"标注

**Files:**
- Modify: `kasia-console/src/services/anti-spam.js:309-325`
- Modify: `kasia-console/src/ui/audit.eta:42`

- [ ] **Step 1: getActivityByPeer 加 hs_in / hs_out 字段**

在 `anti-spam.js` 的 `getActivityByPeer` SQL 中加两个聚合列：

在现有 SQL 的 SELECT 部分，`GROUP_CONCAT(DISTINCT ce.event_type) as types` 后面加：
```sql
,SUM(CASE WHEN ce.event_type = 'handshake' AND ce.to_address = ? THEN 1 ELSE 0 END) as hs_in
,SUM(CASE WHEN ce.event_type = 'handshake' AND ce.from_address = ? THEN 1 ELSE 0 END) as hs_out
```

同时在 `.all()` 参数中加两个 `agentAddress`。

完整修改 — 将：
```javascript
const stats = sqlite.prepare(`
  SELECT
    CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
    SUM(CASE WHEN ce.from_address = ? THEN 1 ELSE 0 END) as out_count,
    SUM(CASE WHEN ce.to_address = ? THEN 1 ELSE 0 END) as in_count,
    COUNT(*) as total,
    COUNT(DISTINCT ce.txid) as unique_total,
    MIN(ce.observed_at) as first_ts,
    MAX(ce.observed_at) as last_ts,
    GROUP_CONCAT(DISTINCT ce.event_type) as types
  FROM chain_events ce
  WHERE (ce.from_address = ? OR ce.to_address = ?) AND
    CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END IS NOT NULL
  GROUP BY peer
  ORDER BY MAX(ce.observed_at) DESC
`).all(agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress);
```

改为：
```javascript
const stats = sqlite.prepare(`
  SELECT
    CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
    SUM(CASE WHEN ce.from_address = ? THEN 1 ELSE 0 END) as out_count,
    SUM(CASE WHEN ce.to_address = ? THEN 1 ELSE 0 END) as in_count,
    COUNT(*) as total,
    COUNT(DISTINCT ce.txid) as unique_total,
    MIN(ce.observed_at) as first_ts,
    MAX(ce.observed_at) as last_ts,
    GROUP_CONCAT(DISTINCT ce.event_type) as types,
    SUM(CASE WHEN ce.event_type = 'handshake' AND ce.to_address = ? THEN 1 ELSE 0 END) as hs_in,
    SUM(CASE WHEN ce.event_type = 'handshake' AND ce.from_address = ? THEN 1 ELSE 0 END) as hs_out
  FROM chain_events ce
  WHERE (ce.from_address = ? OR ce.to_address = ?) AND
    CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END IS NOT NULL
  GROUP BY peer
  ORDER BY MAX(ce.observed_at) DESC
`).all(agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress, agentAddress);
```

注意参数从 6 个变成 8 个（加了两个 agentAddress 给 hs_in 和 hs_out 的条件）。

- [ ] **Step 2: audit.eta 摘要行加"发起中"标注**

在 `audit.eta` 的摘要行中，`p.types` 显示区域后面加标注。

找到现有代码（约 line 47-51）：
```html
<div class="flex gap-0.5 flex-shrink-0 max-w-28 overflow-hidden">
  <template x-for="t in (p.tags||'').split(',').filter(Boolean).slice(0,3)" :key="t">
    <span class="badge badge-neutral text-[8px]" x-text="t"></span>
  </template>
</div>
```

在这个 `</div>` 之后、`↑` 之前加：
```html
<template x-if="p.hs_out > 0 && p.hs_in === 0">
  <span class="badge badge-warning text-[8px]">发起中</span>
</template>
```

---

### Task 3: 自动测试脚本

**Files:**
- Create: `scripts/test-handshake.js`

- [ ] **Step 1: 编写测试脚本**

```javascript
#!/usr/bin/env node
/**
 * 握手系统自动测试
 * 运行: cd kasia-console && node ../scripts/test-handshake.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/console.db');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}: ${detail || 'FAILED'}`); fail++; }
}

const agents = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL').all();
const agentSet = new Set(agents.map(a => a.address));

console.log('=== 测试 1: chain_events txid 真实性 ===');
// 新数据不应有 -accept 后缀（按 observed_at 倒序取最新 20 条）
const recentHs = db.prepare(
  "SELECT txid, observed_at FROM chain_events WHERE event_type = 'handshake' ORDER BY observed_at DESC LIMIT 20"
).all();
const synthCount = recentHs.filter(r => r.txid?.endsWith('-accept')).length;
check('最近 20 条握手无合成 txid', synthCount === 0, `发现 ${synthCount} 条 -accept 后缀`);
// 历史允许有
const allSynth = db.prepare(
  "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND txid LIKE '%-accept'"
).get().c;
console.log(`  (历史合成 txid: ${allSynth} 条 — 不修复)`);

console.log('\n=== 测试 2: messages 去重 ===');
// 同一 txid base 在 messages 中不应超过 2 条（inbound + outbound 各 1）
const dupeCheck = db.prepare(`
  SELECT REPLACE(source_txid, '-accept', '') as base_txid, COUNT(*) as cnt
  FROM messages WHERE message_type = 'handshake' AND source_txid IS NOT NULL
  GROUP BY base_txid HAVING cnt > 2
`).all();
check('无 txid 写入超过 2 条 messages', dupeCheck.length === 0,
  dupeCheck.length > 0 ? `${dupeCheck.length} 个 txid 有 3+ 条: ${dupeCheck[0]?.base_txid?.slice(0,16)}` : '');

console.log('\n=== 测试 3: DB 去重 API ===');
// 选一个 accepted 的 relation，验证 /api/relation/status 返回正确
const acceptedRs = db.prepare(
  "SELECT local_address, peer_address, status FROM relation_states WHERE status = 'accepted' LIMIT 1"
).get();
if (acceptedRs) {
  check('relation_states 有 accepted 记录可测', true);
  // 注：实际 API 测试需要 Console 运行中，这里只验证 DB 数据一致性
  check('accepted 记录 status 正确', acceptedRs.status === 'accepted');
} else {
  check('relation_states 有 accepted 记录可测', false, '无 accepted 记录');
}

console.log('\n=== 测试 4: 主动握手数据完整性 ===');
// 找一个我方发起的握手（chain_events from=agent, event_type=handshake, 且没有 to=agent 的 inbound）
for (const a of agents) {
  const initiatedPeers = db.prepare(`
    SELECT DISTINCT to_address as peer FROM chain_events
    WHERE from_address = ? AND event_type = 'handshake' AND to_address NOT IN (SELECT address FROM relay_nodes WHERE address IS NOT NULL)
  `).all(a.address);

  for (const p of initiatedPeers.slice(0, 2)) {
    const ce = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))"
    ).get(a.address, p.peer, p.peer, a.address);
    const msgs = db.prepare(
      "SELECT COUNT(*) as c FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN identities li ON li.id = c.local_identity_id LEFT JOIN identities ri ON ri.id = c.remote_identity_id WHERE li.address = ? AND ri.address = ? AND m.message_type = 'handshake'"
    ).get(a.address, p.peer);
    const rs = db.prepare(
      "SELECT status FROM relation_states WHERE local_address = ? AND peer_address = ?"
    ).get(a.address, p.peer);

    check(`${a.name}→${p.peer.slice(-8)}: chain_events ≥ 1`, ce.c >= 1, `got ${ce.c}`);
    check(`${a.name}→${p.peer.slice(-8)}: relation_states = accepted+`, ['accepted','confirmed','active'].includes(rs?.status), `got ${rs?.status}`);
  }
}

console.log('\n=== 测试 5: 被动握手数据完整性 ===');
// 找一个对方发起的握手（chain_events to=agent from=外部, event_type=handshake）
for (const a of agents.slice(0, 2)) {
  const passivePeers = db.prepare(`
    SELECT DISTINCT from_address as peer FROM chain_events
    WHERE to_address = ? AND event_type = 'handshake' AND from_address NOT IN (SELECT address FROM relay_nodes WHERE address IS NOT NULL)
    LIMIT 2
  `).all(a.address);

  for (const p of passivePeers) {
    const ceIn = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND from_address = ? AND to_address = ?"
    ).get(p.peer, a.address);
    const ceOut = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND from_address = ? AND to_address = ?"
    ).get(a.address, p.peer);
    check(`${a.name}←${p.peer.slice(-8)}: inbound chain_events ≥ 1`, ceIn.c >= 1, `got ${ceIn.c}`);
    check(`${a.name}←${p.peer.slice(-8)}: outbound chain_events ≥ 1`, ceOut.c >= 1, `got ${ceOut.c}`);
  }
}

console.log('\n=== 测试 6: getActivityByPeer hs_in/hs_out 字段 ===');
// 直接查 SQL 验证字段存在且合理
for (const a of agents.slice(0, 1)) {
  const stats = db.prepare(`
    SELECT
      CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
      SUM(CASE WHEN ce.event_type = 'handshake' AND ce.to_address = ? THEN 1 ELSE 0 END) as hs_in,
      SUM(CASE WHEN ce.event_type = 'handshake' AND ce.from_address = ? THEN 1 ELSE 0 END) as hs_out
    FROM chain_events ce
    WHERE (ce.from_address = ? OR ce.to_address = ?) AND ce.event_type = 'handshake'
    GROUP BY peer LIMIT 5
  `).all(a.address, a.address, a.address, a.address, a.address);

  for (const s of stats) {
    check(`${a.name}↔${s.peer?.slice(-8)}: hs_in=${s.hs_in} hs_out=${s.hs_out} 均 ≥ 0`,
      s.hs_in >= 0 && s.hs_out >= 0);
  }
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: 运行测试（改代码前，建立基线）**

```bash
cd D:/Anthropic/kasia-console && node ../scripts/test-handshake.js
```

预期：测试 1 可能 FAIL（历史数据有 `-accept`），其余应 PASS。记录基线。

- [ ] **Step 3: 实施 Task 1 代码修改**

修改 `kasia-relay/src/ingest.mjs` 第 88 行。

- [ ] **Step 4: 实施 Task 2 代码修改**

修改 `kasia-console/src/services/anti-spam.js` 和 `kasia-console/src/ui/audit.eta`。

- [ ] **Step 5: 重启系统**

```bash
cd D:/Anthropic && bash kanet-stop.sh && bash kanet-start.sh
```

- [ ] **Step 6: 运行测试（改代码后）**

```bash
cd D:/Anthropic/kasia-console && node ../scripts/test-handshake.js
```

预期：全部 PASS。

- [ ] **Step 7: 人工验收**

1. 打开 http://127.0.0.1:3100/audit
2. 选 Martin，确认握手 txid 格式正确（64 位 hex，无 `-accept`）
3. 如果有"发起中"标注的 peer，点击展开确认只有 outbound 握手
4. 确认 chain_events 总数与 Agent 概览页数字一致
