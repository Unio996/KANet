# KANet Dev Channel Tier 2.2 — N-way Group Coordination propose v2 (2026-05-28)

**Status**: v2 post Owner architect review, pending NWT + Bettor + J1 second review + Owner final ack
**Source**: Owner 2026-05-28 dialogue (= "N agent 形成共识推进项目" 设想) + Owner 2026-05-28 09:18 architect review (= 3 炸弹 fix mandatory)
**Principle**: 复用 Tier 2.1 70% (chain + sig + ingestor pattern), 新建 30% (group schema + mesh+hub tunnel + group API)
**ETA**: ~10h pure dev (= v1 7h + Owner 炸弹 fix +3h), ship-ready 2 工作日

## v2 changelog (= Owner architect review 2026-05-28)

Owner caught 3 ship-block 炸弹 + 2 minor 必修 (= 不能留 Tier 3):

| # | Owner critique | Fix in v2 |
|---|---|---|
| 炸弹 1 | mesh 部分失败是 default 不是 edge case (= N=4 全 mesh 概率 38% @ p=0.85) | Q1 改: mesh attempt + 即时 hub fallback, 任一 tunnel 失败自动降级。Ship signal 改"mesh+fallback 后全 member 可达"。+~2h. |
| 炸弹 2 | forming 状态缺 timeout (= 任一 member 不 ack → 永久 stuck + 占 slot) | schema 加 `forming_expires_at`, ingestor tick check 超时 → `status='expired'` 释放 slot。+~30min. |
| 炸弹 3 | threshold 语义混淆 (= join vs vote 是两件事) | schema 拆 `join_threshold` (= 多少 ack 后 active, 通常=N) + `vote_threshold` (= 群内 propose 通过票数, 可 < N)。+~30min. |
| Minor 1 | Q5 checkpoint 目的说清楚 | 加: hash anchor 防抵赖 (= 仅事实 occurred); 内容审计需 plaintext archive (= Tier 3) |
| Minor 2 | Q7 区分 MAX_GROUP_SIZE=4 vs MAX_CONCURRENT_GROUPS=4 | 加: MAX_GROUP_SIZE (= 单群人数上限) vs MAX_CONCURRENT_GROUPS_PER_AGENT (= 一 agent 同时参与群数) 两个独立常量 |

ETA v1 7h → v2 ~10h。仍 2 工作日内。

---

## 1. 背景 / 问题陈述

Tier 2.1 ship 后, 2 个 agent 可链上配对 + UDP 隧道协作。但实际 KANet 工作模式经常**多方共识** (= 比如 KANet-UI + NWT + Bettor 三方 sprint 同时推 Tier 2.1 + 测框架 + settle)。

Owner 真挑 (2026-05-28):
> "在链上不止一个 Agent, 可能 2 个也许 3 个 4 个结对成立一个新的频道, 全力推进一个共识项目。这个系统能很好支持吗?"

= Tier 2.1 单 1-vs-1 pair 不够, 需 N-way (N≤4) group。

### 1.1 控制面 / 数据面 / 共识面 三分

跟 Tier 2.1 一致 + 加 consensus 层:

| 层 | 用途 | 速度/成本 |
|---|---|---|
| 控制面 (chain) | group_invite/group_join_ack/group_propose envelope | 慢/贵/公开 |
| 数据面 (mesh tunnel) | 群内文件/实时 stream | LAN-like/0 KAS/私密 |
| **共识面 (chain vote intent)** | 群内 propose+vote 决策 (= 复用 Tier 1 envelope) | 公开可审 |

### 1.2 跟 5-Layer Trust Stack 对齐

- **L1 Kaspa** = group_invite 上链, 不可抵赖
- **L2 AI Agent native** = 每 agent 自动决定 join/leave
- **L3 Universal fact** = M-of-N consensus 满, status=active 全链可证
- **L4 Reputation portable** = 历史 group 协作 → 加 "曾参与 N 个 group" 标签
- **L5 Trust routing** = 找新 group 协作者时查 L4

---

## 2. 复用 vs 新建 inventory

| 组件 | 当前 Tier 2.1 1v1 | N-way 复用度 |
|---|---|---|
| envelope 验证框架 | validateEnvelope() | 直接复用 + 加 group_* 分支 |
| chain ingestion pattern | pair-ingestor.mjs | 复制 → group-ingestor.mjs |
| ed25519 签字协议 | 单 pubkey verify | N pubkey verify, 同算法 |
| HTTP sig verify middleware | peer-coord.js verifyPairSignature | 同 logic, members[] resolve |
| broadcast_messages 表 | 共享 chain | 不动 |
| STUN discovery | stun-discovery.mjs | 复用 |
| nat-tunnel.mjs 框架 | 1-target hole punch + QUIC frame | 扩 multi-target mesh |
| anti-spam infra | rate limit | 复用 |
| vote intent (Tier 1) | 公开 propose+vote | **直接复用做群内共识** |

**复用率: ~70%** (= 框架/协议/数据层全可复用)

---

## 3. 新建详细 (= 30%)

### 3.1 新 envelope intents (= dev-channel-v1.js)

```javascript
// 新加 VALID_INTENTS
'group_invite',        // 发起人广播
'group_join_ack',      // 每个加入者签字
'group_propose',       // 群内 propose (= 配合 vote intent)
// vote intent 已存在, 直接复用作群内投票
```

#### group_invite envelope
```json
{
  "v": 0,
  "tag": "general",
  "intent": "group_invite",
  "subject": "Group invite: Tier 2.1 docs co-author (3-of-3 consensus)",
  "body": "...",
  "payload": {
    "group_scope": "tier21-docs-coauthor-2026-05-28",
    "members": [
      { "addr": "kaspatest:qqA...", "role": "initiator" },
      { "addr": "kaspatest:qqB...", "role": "co" },
      { "addr": "kaspatest:qqC...", "role": "co" }
    ],
    "join_threshold": 3,
    "vote_threshold": 2,
    "forming_ttl_seconds": 3600,
    "scope_description": "共建 dev-channel-tier2-1 docs, 3 人都签 PR 才 merge, 群内 propose 2-of-3 多数过",
    "initiator_nat_endpoint": { "ip": "203.0.113.42", "port": 51820 },
    "initiator_ed25519_pubkey": "<base64>",
    "tunnel_protocols": ["udp-signed-v1"]
  }
}
```

#### group_join_ack envelope
```json
{
  "v": 0,
  "tag": "general",
  "intent": "group_join_ack",
  "subject": "Group ack from Agent B",
  "ref": "<group_invite_txid>",
  "payload": {
    "group_scope": "tier21-docs-coauthor-2026-05-28",
    "joiner_addr": "kaspatest:qqB...",
    "joiner_nat_endpoint": { "ip": "198.51.100.99", "port": 51821 },
    "joiner_ed25519_pubkey": "<base64>"
  }
}
```

#### group_propose envelope
```json
{
  "v": 0,
  "tag": "general",
  "intent": "group_propose",
  "subject": "Propose: merge PR #42 (= group internal vote)",
  "ref": "<group_id (= invite_txid)>",
  "body": "...",
  "payload": {
    "proposal_id": "merge-pr-42",
    "vote_expires_at": "2026-05-28T12:00:00Z"
  }
}
```

之后用 Tier 1 现有 `vote` intent + `ref=group_propose_txid` 投票。

### 3.2 新 schema (= migrate.js v149)

```sql
CREATE TABLE agent_groups (
  group_id TEXT PRIMARY KEY,           -- invite_txid (= 唯一 deterministic)
  scope TEXT NOT NULL,                 -- "tier21-docs-coauthor-2026-05-28"
  scope_description TEXT,
  initiator_addr TEXT NOT NULL,
  initiator_pubkey TEXT NOT NULL,
  members_json TEXT NOT NULL,          -- [{addr, pubkey, nat_endpoint, joined_txid, joined_at}, ...]
  -- 炸弹 3 fix: join vs vote semantic 拆 (Owner architect review)
  join_threshold INTEGER NOT NULL,     -- 多少 ack 后 status='active' (通常 = N, 全员到位)
  vote_threshold INTEGER NOT NULL,     -- 群内 propose 通过票数 (可 < N, 多数即可)
  current_member_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'forming'        -- forming → active → completed → dissolved → expired
    CHECK (status IN ('forming','active','completed','dissolved','expired')),
  tunnel_status TEXT DEFAULT 'pending',
  -- 炸弹 2 fix: forming timeout 防 stuck (Owner architect review)
  forming_expires_at INTEGER,          -- ms timestamp, ingestor tick check 超时 → status='expired'
  established_at INTEGER,
  last_activity_at INTEGER,
  bytes_total INTEGER DEFAULT 0
);
CREATE INDEX idx_agent_groups_forming_expires ON agent_groups(forming_expires_at) WHERE status='forming';
CREATE INDEX idx_agent_groups_status ON agent_groups(status);
CREATE INDEX idx_agent_groups_initiator ON agent_groups(initiator_addr);

CREATE TABLE group_chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_group_chat_group_time ON group_chat_log(group_id, sent_at);
```

### 3.3 新 services/group-ingestor.mjs (~200 LOC)

Pattern 复制 pair-ingestor:
- 扫 broadcast_messages 含 `"intent":"group_*"`
- group_invite → INSERT agent_groups (status='forming')
- group_join_ack → UPDATE members_json append + current_member_count++
- 达 threshold → status='active'

幂等 + 30s periodic tick (= 跟 pair-ingestor 同 schedule).

### 3.4 nat-tunnel.mjs 扩 mesh

当前 `openTunnel({ peer_endpoint, peer_pubkey, ... })` → 1 connection。

新增 `openGroupMesh({ group_id, my_addr, my_keypair, members[] })`:
- 自动 spawn N-1 个 openTunnel (= 跟所有别人)
- N=3 → 3 tunnels (= 每人跟另 2 人)
- N=4 → 6 tunnels (= N×(N-1)/2)
- 上限 N=4 (= MVP 限制, Tier 3 加 hub fallback)
- `groupMesh.broadcast(data)` = 同时 send 给所有 peer
- `groupMesh.on('data', (from_addr, data) => ...)` = 收任一 peer 数据

**N>4 报 error** (= 真群协作 4 人脑容量极限, 多了用 hub-style 才合理, 留 Tier 3)。

### 3.5 新 api/group-coord.js (~250 LOC)

| route | auth | 用途 |
|---|---|---|
| `GET /api/group/list` | none | 我参与的所有 group |
| `GET /api/group/:id/status` | none | group state + members + tunnel status |
| `POST /api/group/:id/chat` | sig (group members only) | 群组 chat |
| `GET /api/group/:id/messages` | none | chat 历史 |
| `POST /api/group/:id/propose` | sig | 群内 propose (= 触发 chain envelope) |
| `GET /api/group/:id/consensus` | none | 所有 propose 投票状态 (= JOIN broadcast_messages vote intent) |

Sig verify: from_addr 必在 agent_groups.members_json + 同 pair-coord ed25519 算法。

---

## 4. ETA breakdown (v2 含 Owner 炸弹 fix)

| 件 | v1 ETA | v2 ETA | 复杂度 |
|---|---|---|---|
| dev-channel-v1.js 加 3 intent (= validate 分支) | 30 min | 30 min | 简 |
| v149 migration (agent_groups + group_chat_log + forming_expires + join/vote_threshold) | 30 min | 30 min | 简 |
| services/group-ingestor.mjs (~250 LOC, 含 forming timeout check) | 1 h | **1.5 h** (+30 min 炸弹 2) | 中 |
| nat-tunnel.mjs 扩 mesh-attempt + hub fallback + per-peer fail detection | 2 h | **4 h** (+2 h 炸弹 1) | 难 |
| services/group-relay.mjs (= hub relay daemon, ~80 LOC) | - | **30 min** (新, 炸弹 1) | 中 |
| api/group-coord.js (~280 LOC, 含 join/vote threshold logic) | 2 h | **2.5 h** (+30 min 炸弹 3) | 中 |
| smoke test 三方 + 强制 fallback case + forming timeout case | 1 h | **1 h** | 中 |

**总 v1 7h → v2 ~10 h, 2 工作日 ship-ready**

---

## 5. Ship signal (= Tier 2.2 通过条件)

- ✓ v149 migration apply, agent_groups + group_chat_log 表 OK
- ✓ group_invite envelope validate strict (= 含 negative cases)
- ✓ 3 agent 同时发 group_join_ack → ingestor 自动 status='active'
- ✓ 3-way: mesh attempt + 任一失败自动降级 hub fallback, **全 member 可达** (= 不要求 mesh 100% 通)
- ✓ /api/group/:id/chat sig verify fail-closed (= 非 member 一律 403)
- ✓ /api/group/:id/propose 用 vote_threshold (非 join_threshold) 计票
- ✓ 任一 member 30 sec 内不 ack group_invite → group 仍 forming, 60min TTL 后 ingestor 标 expired + 释放 slot
- ✓ N=4 测一次 (= 6 mesh tunnel + 强制 1 失败 → hub fallback 接管)
- ✓ MAX_GROUP_SIZE / MAX_CONCURRENT_GROUPS_PER_AGENT 两个 limit 各自 enforce
- ✓ join_threshold=3 + vote_threshold=2 配置实测 (= 3 全员 ack 才 active, 群内 propose 2 票即过)

---

## 6. 真挑 / Open questions (= ask review)

### Q1. Mesh vs Hub for tunnel topology (= v2 Owner 炸弹 1 修)

⚠ v1 错: 推 "mesh only, hub Tier 3"。Owner 实证: N=4 全 mesh 概率仅 38% @ p=0.85 hole punch (= 0.85^6), 真实更低。**mesh 部分失败是 default 不是 edge case**, hub fallback 必须 Tier 2.2 ship-block。

**v2 propose: mesh-attempt + 即时 hub fallback (任一 tunnel 失败自动降级)**

实施:
1. group active → 所有 member 互相 hole punch (= mesh attempt, 3-15 sec)
2. 任一 pair tunnel 失败 (= 3s timeout) → 标记 needs_fallback
3. fallback 机制:
   - 选 1 个 reachable member 当 hub (= 优先 group_invite initiator, 不可达就轮选)
   - 失败 pair 通过 hub relay 通信
   - hub member 跑 simple relay daemon (= 加 ~80 LOC)
4. ship signal §5 改: "mesh + fallback 后全 member 可达" (= 不要求 mesh 100% 通)

ETA: +~2h (= mesh fallback + relay daemon + 失败检测)

### Q2. Consensus 阈值 (= v2 Owner 炸弹 3 修)

⚠ v1 错: 用单 `threshold` 字段表达"成立 + 投票"两件事。Owner 实证: join 和 vote 语义不同, 必拆。

**v2 propose: 拆 `join_threshold` (= 群成立要多少人 ack, 通常 = N 全员) + `vote_threshold` (= 群内 propose 通过票数, 可 < N 多数即可)**

由 invite 发起人在 envelope payload 指定两个值。例:
- 3 人协作严格场景: `join_threshold=3, vote_threshold=3` (= 全员 ack 成立 + 全员同意通过)
- 3 人协作灵活场景: `join_threshold=3, vote_threshold=2` (= 全员 ack 成立 + 多数通过)
- 不允许 `join_threshold < N` (= MVP 简化, 群成立要全员到位)

### Q3. 后加入 member?
- 允许 (= 现有群可纳新成员, 需所有现 member 多数 ack)
- 不允许 (= 群成立时锁定, 加新人需重新建群)

**propose: 不允许 (= MVP 简化, Tier 3 加 dynamic membership)**

### Q3-bis. forming 状态 timeout (= v2 Owner 炸弹 2 修)

⚠ v1 漏: 3-of-3 任一 member 不 ack → 群永久 stuck `forming` + 占 MAX_CONCURRENT_GROUPS slot。

**v2 propose**: schema 加 `forming_expires_at` (= invite 时 spec, 默认 60min), pair-ingestor 30s tick 检查:
- 现 status='forming' AND now > forming_expires_at → UPDATE status='expired'
- expired group 释放 MAX_CONCURRENT_GROUPS slot
- 发起人可重新 invite (= 新 group_id, 不复用)
- UI 显示 expired group 在 "历史" tab 不在 active

### Q4. 群解散
- 自动 (= 所有 member 提议 dissolve + 阈值满)
- 发起人单方 (= 1 voice)
- 时限 (= 群有 max lifetime, 比如 7 day, 续期需 vote)

**propose: 自动 + 阈值 (= status=dissolved 后归档, members 都可发起 dissolve_propose)**

### Q5. 群 chat 消息也上链 (vs 仅 tunnel)? (= v2 Owner minor 1 修)

⚠ v1 模糊: "tunnel + 周期 checkpoint hash" 没说清楚 hash 防什么。Owner 实证: hash anchor 只防抵赖 (= 仅证明 chat 发生过), 不证内容审计 (= hash 不能反推内容)。

**v2 propose:**
- **默 tunnel** (= 高带宽 + 私密, 群内通信不公开)
- **每 30min 自动签 chat hash anchor 上链** — 防抵赖 (= 证 "这段时间有 X 个 chat, 内容 hash=Y", 双方都不能否认), 不证审计内容
- **内容审计 (= 谁说了什么) 不在 Tier 2.2 scope**, 由各 member 本地保留 plaintext + ed25519 sig (= self-archive, Tier 3 加 dispute-resolve archive 上链)

### Q6. group_propose 是否触发 group 内所有 member 自动 notify?
- 是 (= tunnel push)
- 否 (= 各自 poll API)

**propose: 是 (= group-coord.js tunnel broadcast 通知 + UI badge 闪烁)**

### Q7. cross-group member 冲突? (= v2 Owner minor 2 修)

⚠ v1 错: "上限 4" 两个不同的 4 混淆。Owner 实证: MAX_GROUP_SIZE vs MAX_CONCURRENT_GROUPS_PER_AGENT 是独立常量。

**v2 propose: 两个独立常量**

```javascript
const MAX_GROUP_SIZE = 4;                       // 单群人数上限 (= N≤4, mesh tunnel 实战能打通)
const MAX_CONCURRENT_GROUPS_PER_AGENT = 4;      // 一 agent 同时参与的 active group 数上限 (= 防 spam join)
```

例:
- agent 同时在 4 个不同 3-人 group ✅ (4 < MAX_CONCURRENT_GROUPS_PER_AGENT)
- agent 在 1 个 5-人 group ❌ (5 > MAX_GROUP_SIZE)
- agent 在 5 个不同 group ❌ (5 > MAX_CONCURRENT_GROUPS_PER_AGENT)

Tier 3 可调 (= hub topology 后 MAX_GROUP_SIZE 可放大; reputation 高 agent 可 MAX_CONCURRENT_GROUPS_PER_AGENT 提升)

---

## 7. KI 沉淀 backlog

- nat-tunnel N-target hole punch 顺序 (= 同时 fire 还是 round-robin?)
- mesh tunnel 部分失败 (= 4 个里 1 个打不通) 怎么 fallback?
- threshold 满后, 后到 ack 还接受不? (= MVP 不接, 视为已 form 成熟群)

---

## 8. 真诚 surface (= KANet-UI 视角)

- **大头工作 = nat-tunnel 扩 mesh**, 单 tunnel 复杂度 → N×N coordination
- **真不确定性 = sync N agent fire time**. 链上 broadcast 不同步, ingestor 等齐慢慢自然形成
- **真捷径 = 跟 Tier 2.1 复用 70%**, 仅 envelope + 1 service + 1 API + 1 schema 新
- **风险 = mesh 一处断 = 群协作中断**, Tier 3 加 hub fallback 是必要 hardening

---

— KANet-UI-tn propose, ask NWT + Bettor + J1 review + Owner final ack
