# Broker Architecture Deep Dive

**Version**: v0.1 (Step 1 of PZ-BROKER-deep-dive-and-fix)
**Date**: 2026-05-04
**Owner**: J2 (implementor) + Architect (claude.ai)
**Scope**: broker 4 stage × 8 dimension = 32 sections, 真 file:line + schema dump + grep output, 不抽象
**Sediment status**: Stage 1 (握手) WIP — reference 模板; Stage 2-4 pending

---

## Table of Contents

- [Stage 1 — 握手 + 即时 accept reply](#stage-1--握手--即时-accept-reply)
- [Stage 2 — 用户意图识别](#stage-2--用户意图识别) (pending)
- [Stage 3 — 快速形成订单 (publishOffer)](#stage-3--快速形成订单-publishoffer) (pending)
- [Stage 4 — 订单执行 + 反馈](#stage-4--订单执行--反馈) (pending)
- [跨 stage 风险点](#跨-stage-风险点) (pending)

每 stage 8 dimension:
- **A** 真涉及 file (path + line range)
- **B** 真表 + schema (full DDL)
- **C** 真协议消息 schema (JSON)
- **D** 真角色 + 数据流 (end-to-end trace)
- **E** State ownership (KI-20 event-sourced)
- **F** 健康监控 (KI-16 alive vs functioning)
- **G** 用户体验 (KI-17 三层 + KI-18 平台无关)
- **H** Sanity check (KI-24 broker 智能 reject)

---

## Stage 1 — 握手 + 即时 accept reply

**真 status**: 5/4 真 ship cycle 完成 (5 P0 修 + 真 e2e + 漏洞 #3 telemetry catch #9)。 真模板 reference for Stage 2-4。

### Dimension A: 真涉及 file

| File | line range | 职责 |
|------|-----------|------|
| `kasia-relay/src/rpc-listener.mjs` | 575-727 | handleBlock 真扫块, classifyPayload, isToUs (5/4 #9 修), processHandshake 6 step (Step 1 ingestTx → Step 5 atomic claim → Step 6 acceptHandshake + sendKaspa) |
| `kasia-relay/src/rpc-listener.mjs` | 132-149 | isToUs (5/4 漏洞 #9 fix: 加 inputs sender check 排除自己 outbound) |
| `kasia-relay/src/rpc-listener.mjs` | 720-746 | outer catch (5/4 漏洞 #3 fix: 加 ingestEvent telemetry handshake_processing_failed) |
| `kasia-relay/src/rpc-listener.mjs` | 680-688 | claim fail 不 markSeen (5/4 漏洞 #6 fix: 让 catch-up 真 retry) |
| `kasia-relay/src/chain.mjs` | 136-162 | acceptHandshake (反向 0.2 KAS) + initiateHandshake (主动 0.2 KAS) |
| `kasia-relay/src/lib/protocol.mjs` | 4-30, 75-86 | PREFIX_HEX.HANDSHAKE = `ciph_msg:1:handshake:`, classifyPayload 字面前缀匹配 |
| `kasia-console/src/services/ingest-service.js` | 24-186 | handleIngestMessage: dedup + observeHandshake + chain_events recordChainEvent + 5/4 漏洞 #2 fix (pending_actions failed/expired 允许 reset) |
| `kasia-console/src/api/discovery.js` | 282-369 | Scout interaction handler (5/4 漏洞 #1 fix: dup check 改 (txid, event_type) 双键 + 漏洞 #2 fix 同 ingest-service) |
| `kasia-console/src/api/admin.js` | 1-34 | NEW 5/4 ship: POST /api/admin/manual-handshake-accept (人工救济端 endpoint) |
| `kasia-console/src/services/relation-state.js` | 1-127 | observeHandshake / acceptHandshake / confirmSession / activateRelation (5 transitions) |

### Dimension B: 真表 + schema

```sql
-- relation_states (社交关系唯一真相源, 196 rows verify 过)
CREATE TABLE relation_states (
  id TEXT PRIMARY KEY,
  local_address TEXT NOT NULL,
  peer_address TEXT NOT NULL,
  status TEXT NOT NULL,                  -- observed / accepted / confirmed / active / blocked / stale
  trust_level TEXT,                       -- normal / trusted / owner
  is_blocked INTEGER,                     -- 1 = 主动拉黑
  their_alias TEXT,                       -- 对方 comm 通信别名 (握手 payload carries)
  first_seen_tx TEXT,                     -- 首次发现 TX
  handshake_observed_at TEXT,             -- Scout 观察到时间
  handshake_accepted_at TEXT,             -- Relay 反向 accept 时间 (真到 accepted 的关键)
  session_confirmed_at TEXT,
  classification TEXT,                    -- seen_candidate/declared_candidate/responsive_agent/verified_agent/inactive_agent (只升不降)
  updated_at TEXT NOT NULL,
  UNIQUE(local_address, peer_address)
);

-- chain_events (链上事件归档, 63K rows)
-- 5/4 verify: from/to 不是 raw chain destination, 是 KANet 内部 view (Scout self-stash 协议 fallback)
CREATE TABLE chain_events (
  id TEXT PRIMARY KEY,
  txid TEXT NOT NULL,
  from_address TEXT,                      -- KANet 内部 marker (NOT raw chain sender)
  to_address TEXT,                        -- KANet 内部 marker (NOT raw chain recipient)
  event_type TEXT NOT NULL,               -- handshake / text / comm / comm_sent / payment / kas_delivery / 等
  payload TEXT,
  observed_by TEXT NOT NULL,              -- relay / scout / console
  observed_at TEXT NOT NULL,
  UNIQUE(txid, event_type)                -- 5/4 漏洞 #1 fix: 加 event_type 维度
);

-- messages (DM 消息真相源, 13K rows)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  conversation_id TEXT,
  source_txid TEXT,
  direction TEXT NOT NULL,                -- inbound / outbound
  sender_identity_id TEXT,
  receiver_identity_id TEXT,
  message_type TEXT NOT NULL,             -- text / handshake / query_card
  content_text TEXT NOT NULL,
  raw_payload TEXT,
  received_at TEXT NOT NULL
);

-- pending_actions (catch-up 唯一消费者, 3 rows)
CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,              -- handshake_accept / handshake_init
  direction TEXT NOT NULL,                -- inbound / outbound
  local_address TEXT NOT NULL,
  target_address TEXT NOT NULL,
  source TEXT NOT NULL,                   -- relay / ingest / scout / mind
  idempotent_key TEXT NOT NULL UNIQUE,    -- 5/4 漏洞 #2 fix: failed/expired 允许 UPDATE reset
  status TEXT NOT NULL,                   -- pending / executing / done / failed / expired
  retry_count INTEGER NOT NULL,
  trigger_txid TEXT,
  result_txid TEXT,
  error TEXT
);
```

### Dimension C: 真协议消息 schema

```
Kasia handshake 协议 (chain.mjs:136-162):

initiateHandshake (主动):
  payload prefix: 'ciph_msg:1:handshake:'
  encrypted JSON: { type: 'handshake', alias, theirAlias, timestamp, version: 1, isResponse: false }
  to: peer 地址
  amount: KASIA_MIN_AMOUNT = 0.2 KAS

acceptHandshake (反向):
  same prefix
  encrypted JSON: { type: 'handshake', alias, theirAlias, timestamp, version: 1, isResponse: true }
  to: original sender 地址
  amount: 0.2 KAS

链上 TX 真结构 (BUY 路径同款):
  inputs: sender's UTXOs
  outputs: [
    { address: peer, amount: 0.2 KAS },
    { address: sender, amount: 找零 }
  ]
  payload: hex(prefix + encrypted_payload)
```

### Dimension D: 真角色 + 数据流

```
[1] Owner Kasia client → 链上发握手 chain TX (payload prefix 'ciph_msg:1:handshake:' + 0.2 KAS to Trader-M)
       ↓
[2] Trader-M Relay rpc-listener.mjs handleBlock(block) (line 575-606):
       classifyPayload(payloadHex) → 'handshake'
       TO_RECIPIENT_TYPES.has('handshake') = true → isToUs(tx) check
       isToUs(tx) (line 132-149, 5/4 #9 修后): inputs 不含 _myAddress + outputs 含 _myAddress → return true
       case 'handshake' → processHandshake(txId, payloadHex, senderAddress)
       ↓
[3] processHandshake 6 step (line 610-746):
       Step 0 line 612-614: decrypt(payloadHex.slice(PREFIX_HEX.HANDSHAKE.length), _myPrivateKeyHex)
       Step 1 line 626: ingestTx → /ingest/tx → chain_events row 'tx'
       Step 2 line 636: _handshakeAccepted Set in-memory dedup (重启清空, 漏洞 #5 留 P1)
       Step 3 line 643-654: fetch /api/relation/status DB dedup (status accepted/active/confirmed → markSeen + return)
       Step 4 line 657-662: ingestMessage → /ingest/message → handleIngestMessage:
              messages row inbound + chain_events 'handshake' 行 + observeHandshake (relation_states observed)
              5/4 漏洞 #2 fix: pending_actions failed/expired 允许 UPDATE reset
       Step 5 line 667-690: /ingest/pending-handshakes atomic create+claim (锁 lock)
              5/4 漏洞 #6 fix: claim fail 不 markSeen (让 catch-up retry)
       Step 6 line 692-701: acceptHandshake → sendKaspa 0.2 KAS 反向 + ingestHandshake outbound + markSeen
       outer catch line 720-746: 5/4 漏洞 #3 fix: ingestEvent /ingest/event events 表 'handshake_processing_failed'
       ↓
[4] 同时 Scout (kaspa-scout/src/rpc-scanner.mjs) 扫全链:
       classifyPayload → 'handshake'
       derivePeers → sender/receiver
       POST /api/discovery/interaction
       ↓
[5] Console.discovery.js handleInteraction (line 282-369):
       5/4 漏洞 #1 fix: dup check (txid, event_type='handshake') 双键 (避免 short circuit)
       recordChainEvent + observeHandshake + 5/4 漏洞 #2 fix pending_actions reset + sendCommandAsync IPC
       ↓
[6] Console.ingest-service.js outbound 上报:
       handleIngestMessage outbound handshake → relation_states acceptHandshake (observed → accepted, handshake_accepted_at = now)
       pending_actions UPDATE status='done', result_txid=新 outbound txid
       ↓
[7] 双向 active 完成: 关系 active = 双方都互发过握手 (initiate + reverse accept)
```

### Dimension E: State ownership (KI-20 event-sourced)

```
Truth source: chain_events (Kaspa 链 immutable append-only)
Projection: relation_states.status (DB cache, rebuildable)

Transitions:
  observed (Scout/Relay 看到 inbound handshake, 0 commit yet) →
    accepted (Relay 反向发 0.2 KAS, handshake_accepted_at filled) →
    confirmed (双方有 comm message text, session_confirmed_at) →
    active (有实际交互 OR 时间窗内 message)
  
  blocked: 任何状态 → blocked (主动拉黑)
  stale: active → stale (无活动时间过长)

State ownership 真原则 (5/4 修复后):
  - chain_events 直接 SQL INSERT (relation-state.js + ingest-service.js + discovery.js 多 writer)
  - relation_states 直接 SQL UPDATE (KI-20 反模式 candidate, 但握手 sediment 暂留)
  - pending_actions atomic claim (multi-worker race 守)

KI-20 verify (5/4 ship 后):
  ✗ relation_states 直 SQL UPDATE — 多 writer (ingest / discovery / relation-state) 真同表更新
  ✗ chain_events 多 writer — relay / scout / console 都 INSERT
  ✓ pending_actions 单一 writer per claim (atomic create+claim)
  ✓ messages 单一 writer (handleIngestMessage)

= 握手 sediment 不 strict event-sourced, 但 5/4 5 P0 修后真 work. 真改 KI-20 严守需要 Phase 3 重构。
```

### Dimension F: 健康监控 (KI-16 alive vs functioning)

```
真 health endpoint:
  /api/health/agents — 含 indicators 对每 Agent (J2/NWT/Trader-A/B/M/Qclaude/KANet):
    - adapter (alive)
    - lastEvent / proactive / reflection (functioning)
    - errors / blocks / payFails
    - llm_upstream (KI-16 sediment 5/4 ship)

真 watchdog:
  scripts/llm-watchdog.mjs — llama-server :8000 + LiteLLM :4000 (5/4 KI-22 LiteLLM env defer Phase 3)

handshake 真 stage 健康监控:
  - rpc-listener 跑没? — 通过 /api/relay/:id/balance 可 verify
  - processHandshake fail 真留痕? — 5/4 漏洞 #3 fix events 表 handshake_processing_failed
  - catch-up loop 真 active? — log 含 "catching up from Console DB"

真盲区:
  - rpc-listener WebSocket 重连 cycle 真 health (RECONNECT_BASE_MS 5s, MAX 60s) 没监控
  - kasia-scout 跑没 (单进程, 无 health endpoint pinned)
  - blocklist refresh (BLOCKLIST_INTERVAL_MS 30s) 真有 working?

= 真 alive 监控 OK, functioning 部分 cover, 真 blind spots Phase 3 candidate
```

### Dimension G: 用户体验 (KI-17 三层 + KI-18 平台无关)

```
握手不是 broker offer 流程 (没 KI-17 三层应用), 但用户感知:

L1 识别: Owner 发握手 → 多久收到 0.2 KAS 反向?
  5/4 真 e2e (J2 → Trader-M TX 3f342dee):
    00:52:11.480Z J2 send handshake
    00:52:13.535Z Trader-M 反向 d5dd9144 真发 (~2s 内)
  = 真 fast, 用户感知好

L2 失败 user 真知道吗?
  失败场景:
    - Relay 没运行: catch-up retry 60s tick 真 active
    - decrypt fail: 5/4 漏洞 #3 telemetry events 表 handshake_processing_failed (Owner 真可查)
    - claim race: 5/4 漏洞 #6 修后 catch-up retry, user 真不感知
  
  真 silent 场景 (P3):
    - Owner Kasia 客户端发 self_stash 而非 handshake (5/3 NWT 误诊场景)
    - Brain freestyle 编 fake 地址 (5/4 真截图 evidence)
  = 用户 may 不 understand, 但真 admin endpoint 救济 (5/4 ship)

L3 反馈: 握手成功后 user 真收 reply?
  Trader-M 反向 0.2 KAS = 真信号 (Kasia client UI 显示)
  + auto-greet (rpc-listener.mjs:703-716) 真 send brief hello via Mind
```

### Dimension H: Sanity check (KI-24 broker 智能 reject)

```
握手 sanity check:
  ✓ blocklist (rpc-listener.mjs line 158-180 refreshBlocklist 30s)
  ✓ 4 dedup layer (in-memory + DB + atomic claim + seen.json)
  ✓ TO_RECIPIENT_TYPES + isToUs (5/4 #9 修后排除 self outbound)
  ✓ classifyPayload prefix 严判 (ciph_msg:1:handshake:)

真 reject scenarios:
  ✗ 不 reject 重复 sender (跨 sender 多笔握手): _handshakeAccepted Set per sender, 真 OK
  ✗ 不 reject low-value sender (rep score 低): 没 reputation gate
  ✗ 不 reject Sybil (多 fake address): 没 sybil 检测

= sanity 守基础, 进阶反 abuse 是 Phase 3 candidate (KI-24 broker 智能 expand)
```

---

## Stage 2 — 用户意图识别

**真 status**: 5/4 6 commit 修过 (M-1/M-2/M-3/M-confidence/M-wallet-inject/M-confidence-relax) — 但 KI-28 未 close (真 e2e 真 fail, M-1 telemetry 真出真因 cheap_gate_confidence)

### Dimension A: 真涉及 file

| File | line range | 职责 |
|------|-----------|------|
| `agent-mind/src/skills/matcher.mjs` | 1-547 (post 5/4 6 commit) | MatcherSkill class: canActivate (真 25-30) / gatherContext (真 34-67 + _fetchBrokerWallets M-wallet-inject) / extractIntent + asyncShouldPublish (真 73-91, 269-318) / formatForBrain (真 425-471 + walletInstr inject) / publishOffer (真 363-403 + accepted_chains M-wallet-inject) / _reportPublishDecision M-1 telemetry helper (真 320-345) |
| `agent-mind/src/skills/base.mjs` | 1-50 | Skill base class: canActivate (默认 true), gatherContext / formatForBrain (默认 noop), constructor 加 keywords param |
| `agent-mind/src/skills/registry.mjs` | 1-180 | SkillRegistry: autoDiscover scan skills/ dir + Console /api/agent/mind-skills 拿 active list, getActiveSkills (132-140 真 two-gate filter: canActivate + _keywordsMatch), gatherAll (142+ 真 SKILL_TIMEOUT_MS 10s + Promise.all + try-catch wrap) |
| `agent-mind/src/mind.mjs` | 370-447 | reactive cycle: contextBuilder.buildReactiveTask (417) → fetchJson `${adapterUrl}/reply` (433) Brain LLM call → action loop (451+) |
| `agent-mind/src/context-builder.mjs` | 102-118, 1041-1103 | _gatherSkills (真 invoke registry + enrichedConfig 含 _senderAddress/_inputMessage) / buildReactiveTask (truncate skills 真 inject 进 user prompt) / _buildReactiveUser (真 685-692 SKILL DATA section) |
| `kasia-console/src/services/mind-manager.js` | 383+ | getReply: invoke Mind reactive cycle for given relayNodeId/peer/message |
| `kasia-console/src/api/conversations.js` | 298-453 | /api/agent/reply entry: R34 dedup (300-311) → is_dex_broker check (323) → sibling broker skip (328-334) → chain DM classifier (392-402) → broker-v2 flag (411-423) → broker handlers OR fall to getReply (440-447) |
| `agent-adapter/src/index.mjs` | 51-79 | Adapter /reply endpoint: 接 mindSystem/mindUser/mindTask payload, route to llama-server :8000 |

### Dimension B: 真表

| Table | 用途 | Stage 2 真 read/write |
|-------|------|---------------------|
| **messages** | DM 消息真相源 | matcher 不直读 (走 /api/agent/peer-context API, KI-4 skill HTTP only) |
| **chain_events** | event_type='text'/'comm' DM trace | matcher.reactToChainEvents 真 query (T3.2 ship) |
| **events** | matcher_publish_decision telemetry (M-1 ship) | matcher._reportPublishDecision 真 POST /ingest/event |
| **relation_states** | peer trust + active status | matcher 不直 query (但 _gatherSkills enrichedConfig 含 _senderRelation) |
| **agent_wallets** | broker 9 链钱包 (M-wallet-inject 关键) | matcher._fetchBrokerWallets 真 fetch /api/relay/:id/wallets |
| **conversations** | 跟 peer 真 thread | mind.mjs episodeHistory inject (1083-1094) |

```sql
-- events 表 schema (M-1/M-3 telemetry 写入)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  trace_id TEXT,
  event_scope TEXT NOT NULL,              -- mind / relay / system / etc
  event_type TEXT NOT NULL,               -- matcher_publish_decision / handshake_processing_failed / etc
  source TEXT NOT NULL,                   -- matcher / relay / mind / scout
  level TEXT NOT NULL,                    -- info / warning / error
  conversation_id TEXT,
  message_id TEXT,
  reply_id TEXT,
  summary TEXT NOT NULL,
  payload_json TEXT,
  agent_address TEXT,
  created_at TEXT NOT NULL
);

-- agent_wallets schema (M-wallet-inject 真 query)
CREATE TABLE agent_wallets (
  id TEXT PRIMARY KEY,
  relay_node_id TEXT NOT NULL,
  chain TEXT NOT NULL,                    -- bnb / eth / polygon / arbitrum / sol / tron / etc
  address TEXT NOT NULL,
  label TEXT,
  privkey_encrypted TEXT,                 -- 加密私钥
  privkey_hint TEXT,                      -- '0xabcd...wxyz' 显示提示
  is_default INTEGER NOT NULL,            -- 1 = 该 chain 默认钱包
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Dimension C: 真协议消息 schema

```js
// MATCHER_INTENT_SYSTEM (matcher.mjs:449-485, post M-confidence + M-wallet-inject 修)
const MATCHER_INTENT_SYSTEM = `
你是 KANet 撮合官 (matcher), KAS / USDT 跨链撮合 Agent.

任务: 从 user 消息提炼撮合意图, 返回严格 JSON. 不要任何 markdown wrapper 或解释文本.

JSON schema:
{
  "side": "buy" | "sell" | "query" | "cancel" | "none",
  "asset": "KAS" | "USDT" | null,
  "qty": <number> | null,
  "qty_unit": "KAS" | "USDT" | null,
  "pay_chain": "BSC" | "ETH" | "POLYGON" | "TRON" | "SOL" | "KASPA" | null,
  "evm_address": "0x[40 hex]" | null,                    // M-confidence 加
  "confidence": "high" | "medium" | "low",
  "missing_fields": [<string array>],
  "raw_intent_text": "<user 原话不改>"
}

confidence 必按下面规则判:                                // M-confidence 加 (LLM 不 obey)
- "high": side+asset+qty+pay_chain 全填 + user 含 confirm 词
- "medium": user 意图清晰但还在补字段
- "low": 用户意图不明
`;

// SHOULD_PUBLISH_SYSTEM (matcher.mjs:437-446)
const SHOULD_PUBLISH_SYSTEM = `
你是 broker 助手, 判断 user 是否准备好提交 offer 上链.

判断标准 (binary):
- ready=true: user 明确同意 publish (含: 完整意图 + 用户最近消息含 同意/确认/可以/发吧/OK 等),
  AND user 已提供 evm_address (EVM/BSC 链 buy/sell scenarios required) OR intent.pay_chain=KASPA.
- ready=false: 缺任一条件

只返 JSON: { "ready": true|false, "reason": "..." }
`;

// LLM call 真 structure (matcher.mjs:117-126 + 285-295)
// _extractIntentT1:
fetchJson(`${adapterUrl}/reply`, {
  method: 'POST',
  body: JSON.stringify({
    peer: this._senderAddress,
    mindSystem: MATCHER_INTENT_SYSTEM,
    mindUser: '<peer name + 24h history + latest message>',
    mindTask: true,                                       // boolean per 8 mind.mjs canonical sites
  }),
  brainCall: true,
});

// asyncShouldPublish (post M-confidence-relax):
//   if (intent.confidence === 'low') return false  ← 5/4 b1 修
//   else fetchJson SHOULD_PUBLISH_SYSTEM LLM call

// formatForBrain return (matcher.mjs:425-471 + walletInstr M-wallet-inject):
{
  name: 'matcher',
  description: '...',
  data: { peer, history_count, intent, suggestedReply, offerResult, walletAddresses },
  instructions: walletInstr + cleanedReply  // M-wallet-inject 真 prefix BROKER 真收款地址
}
```

### Dimension D: 数据流 (含 Stage 1→2 plumbing + Mind reactive 7 step)

**Stage 1 → Stage 2 plumbing trace** (Owner 真重点要求):

```
[1] Stage 1 完成: relation_states (Owner ↔ Trader-M) status='active' (双方互握手)
       ↓
[2] Owner 真发 chain TX (Kasia comm 协议):
       payload prefix 'ciph_msg:1:comm:<alias>:<base64-encrypted>'
       to: Owner 自己地址 (self-stash 模式!)
       amount: 'self-full' (Kasia comm 协议: ciphertext 留 sender 地址, 不直接发 receiver)
       ↓
[3] Trader-M Relay rpc-listener.mjs handleBlock(block) line 575+:
       classifyPayload → 'comm'
       PROCESSABLE_TYPES.has('comm') = true
       comm 不在 TO_RECIPIENT_TYPES (只 handshake/payment) → 不 isToUs check
       case 'comm': processComm(txId, payloadHex, senderAddress) (line 600)
       ↓
[4] processComm (rpc-listener.mjs:731-): 
       parse alias + encodedContent
       decrypt(Buffer.from(encodedContent, 'base64'), _myPrivateKeyHex):
         真 decrypt 成功 = 这 comm 真给 _myAddress (我私钥能解 = 真 to me)
         decrypt 失败 silent skip (link 749-751: "this comm was encrypted for someone else")
       markSeen(txId)
       ingestMessage → /ingest/message → handleIngestMessage (ingest-service.js:24-186):
         messages 表 row inbound + chain_events 'text' 行 + activateRelation
       ↓
[5] handleIngestMessage 真 trigger 后续? — verify:
       grep 真证据 — handleIngestMessage 不直 invoke matcher OR mind reactive
       → mind reactive 真 trigger 真路径必经 conversations.js POST /api/agent/reply
       → 谁 POST /api/agent/reply? — 真 conversations.js:298 endpoint, 来自 ?
       
       grep result: /api/agent/reply 真 caller:
         - kasia-relay/src/ai.mjs (Mind 真 invoke endpoint, peer DM trigger)
         - rpc-listener.mjs processComm → routeMessage → ai.getAIReply → POST /reply
       
[6] ai.mjs getAIReply 真 trigger:
       routeMessage (router.mjs) → ai.getAIReply (ai.mjs):
         POST /api/agent/reply { peer, message, channel } 真发 Console
       Console conversations.js /api/agent/reply (line 298):
         R34 dedup (5s recent_duplicate skip)
         resolveRelayNodeId
         broker = SELECT is_dex_broker, is_service FROM relay_nodes WHERE id=resolved
         if (broker.is_service==1 OR is_dex_broker==1) → broker handler path (Trader-A/B)
         else → fall to getReply (Trader-M path: is_dex_broker=0, is_service=0)
       ↓
[7] mind-manager.getReply (mind-manager.js:383):
       invoke Mind 真 reactive cycle for Trader-M 
       ↓
[8] Mind 五核 reactive cycle (mind.mjs:370-447):
       intent classify (intent kernel, 真 detect L1/L2/L3 escalation)
       contextBuilder.buildReactiveTask(input, peerAddress, episodeOpts) (line 417):
         _gatherSkills('reactive', { _senderAddress, _inputMessage, _senderRelation })
           → registry.getActiveSkills('reactive', context):
             对每 active skill (matcher 真在 Trader-M active 列): 
               s.canActivate('reactive', context) → matcher.canActivate (matcher.mjs:25-30):
                 if (taskType !== 'reactive') return false
                 store _senderAddress + _inputMessage
                 return true                            ← 真 unconditional pass
               s._keywordsMatch (base.mjs default keywords=[] → pass-through)
           → registry.gatherAll(activeSkills, kernels, enrichedConfig):
             skill.gatherContext(kernels, enrichedConfig) → matcher.gatherContext (matcher.mjs:34-67):
               this._config = config
               this._walletAddresses = await _fetchBrokerWallets(config)  ← M-wallet-inject
               fetchJson `/api/agent/peer-context` → ctx
               return { peer, history, broadcasts, connectionStatus, metadata }
             skill.formatForBrain(gathered) → matcher.formatForBrain (matcher.mjs:425-471):
               extractIntent(gathered, latestMessage, config):
                 _extractIntentT1: LLM call MATCHER_INTENT_SYSTEM → JSON intent
                 reactToChainEvents (T3.2)
                 asyncShouldPublish: cheap gates (5/4 b1: low only) + LLM SHOULD_PUBLISH
                   → if true: publishOffer (M-3 telemetry on fail) → generateOfferFeedback
                   → else: generateReply (M-2: 删 T1_DISCLAIMER + "准备出报价" 文案)
               stripMarkdown
               instructions = walletInstr + cleanedReply  ← M-wallet-inject 加 broker 真钱包
               return { name, description, data, instructions }
         _buildReactiveUser: 真把 skill instructions 全 concat 进 user prompt SKILL DATA section
       Brain call (line 433): POST adapter `/reply` { mindSystem: task.system, mindUser: task.user, mindTask:true }
         agent-adapter/src/index.mjs:51-79: route to llama-server :8000 with chat_template_kwargs.enable_thinking=false (Qwen Rule 11 kill switch auto-injected per openai.mjs:238-242)
       Brain LLM 真返 reply text (含 ACTION 真触发 actionExecutor)
       ↓
[9] mind.mjs (line 553+): mind-event reactive_reply
       reply.send({ reply }) 回 conversations.js
       ↓
[10] kasia-relay/src/ai.mjs 接 reply → routeMessage 后续 (router.mjs):
       relay sendKaspa with comm payload encrypted to peer pubkey → user Kasia client decrypt
```

**跨 stage race / silent / drift 嫌疑** (Owner 真重点 verify):

| # | 嫌疑 | 真 grep verify | 真状态 |
|---|------|---------------|-------|
| **R1** | Stage 1→2 transition 真 enforce 吗? matcher.canActivate 真要求 relation_states active? | matcher.canActivate (line 25-30): 仅 check taskType==='reactive', **不 check relation_states** | ❌ **真 design choice OR 真 P0 漏洞** — 任何 stranger DM 真 trigger matcher publish flow (无握手 require) |
| **R2** | mind.mjs reactive 真 filter sender (stranger / blocked)? | grep mind.mjs 没 stranger filter, 仅 conversations.js 真 sibling broker check (anti-runaway) | ⚠ matcher 真无 anti-spam, 仅 conversations.js R34 5s dedup |
| **R3** | matcher.gatherContext 真依赖 relation_states? | 真不 (line 34-67), 仅 fetch peer-context (含 connectionStatus 但不 enforce) | ⚠ silent silent — 真 attacker DM 仍真 LLM call (cost 1-2s + Qwen capacity) |
| **R4** | comm payload self-stash silent skip 真 leak peer 隐私? | rpc-listener.mjs:749-751 真 silent return (decrypt 失败 = not for us) | ✓ OK — Kasia 协议 design |
| **R5** | Trader-M 真没 active relation 跟 Owner 怎么处理? | 真 matcher.canActivate fire + LLM call + 真 reply, 但 anti-spam 真 conversations.js fail-closed (sibling skip), peer 一般用户真不 skip | ❌ **真嫌疑 P0** — 真 stranger DM cost LLM 1-2s + 真 reply 真消费 broker 0.2 KAS comm fee |
| **R6** | 多 Trader-M instance 真 race? | matcher.canActivate stateless (this._senderAddress per call), Mind reactive 真 single process per relay | ✓ OK |
| **R7** | matcher.formatForBrain Brain 真 ignore instructions freestyle? | 5/4 真 e2e 真 evidence: Brain reply 真 forward broker 真 BSC 地址 (M-wallet-inject 后) | ✓ M-wallet-inject 修后 OK; before 真 freestyle hallucinate |

### Dimension E: State ownership (KI-20 event-sourced 真 verify)

```
matcher 设计哲学: 0 own state (per MATCHER-ARCHITECTURE v0.1 §1.2)

verify 真:
  ✓ matcher.canActivate 真 stateless (仅 store this._senderAddress + this._inputMessage 当 turn 用, 下 turn 重置)
  ✓ matcher.gatherContext 真 fetchJson, 0 sqlite import (KI-4 skill HTTP-only)
  ✓ matcher.extractIntent 真 LLM call, 不 cache intent
  ✓ matcher.reactToChainEvents 真 fetch 每 cycle, 0 cache (T3.2 path b)
  ✓ matcher.publishOffer 真 fetchJson endpoint, 0 sqlite
  ✓ matcher.formatForBrain 真 stateless (只用 turn-local data)
  ⚠ this._config / this._walletAddresses / this._senderAddress / this._inputMessage 真 instance state, 但**仅 per-turn** 不 cross-turn (canActivate 每 turn 重 set)

KI-20 event-sourced verify (matcher 真不 own state, 但**整个 Stage 2** 真 state 在哪):
  - intent state: 0 持久化 (LLM 每 turn 重提炼) — design choice, 真 KI-20 严守
  - publish trigger state: 0 (asyncShouldPublish 每 turn 重判) — 真 KI-20 严守
  - 5/4 真问题: LLM 不 obey prompt → confidence 真"medium" 反复, 真 stuck cheap_gate

= matcher 真 KI-20 严守, 但**真后果是 LLM 不 obey 真 publish 永远 fire 不了** — Stage 2 真功能 broken 但架构纯 (paradox)。

老 broker 真有 cross-turn state (broker-state-authority.js setConvoStateLock + retail_dex_orders SQL-backed):
  - 真违 KI-20 (直 SQL UPDATE state)
  - 真 work (BUY 路径 6 月 sediment, 4/26-4/30 5 笔 completed)

= 真 trade-off: 0 own state 哲学 vs 真 work. Step 2 漏洞清单真要 weight 这。
```

### Dimension F: 健康监控 (KI-16 alive vs functioning)

```
agent-health.js 真 cover Trader-M (matcher):
  - adapter alive (My-Brain-Qwen3 process)
  - lastEvent / proactive / reflection (functioning markers)
  - errors / blocks / payFails
  - llm_upstream (KI-16 sediment 5/4 ship)

matcher Skill 真无独立 health:
  - matcher 真"alive" 由 SkillRegistry autoDiscover 决定 (Console /api/agent/mind-skills)
  - matcher 真"functioning" 真依赖:
    - LLM upstream alive (llm_upstream indicator)
    - /api/agent/peer-context endpoint alive
    - /api/relay/:id/wallets endpoint alive (M-wallet-inject 依赖)
    - /api/exchange/publish endpoint alive (publishOffer 真依赖)

真盲区:
  - matcher 真 publish 真触发率 (events 表 'matcher_publish_decision' decision='llm_ready_true' 真 count)
  - matcher 真 LLM call latency (真 user wait time)
  - matcher 真 fail rate per decision name (cheap_gate / llm_ready_false / llm_call_or_parse_fail)

= alive 真 cover OK, functioning 部分 — 真 publish 触发率 / latency / per-reason fail rate 真盲区, Phase 3 candidate
```

### Dimension G: 用户体验 (KI-17 + KI-18 + 5/3 audit)

```
KI-17 三层 (broker 真 ship 真核心):
  L1 识别: matcher LLM 真懂 user 真意图 (5/4 真 e2e: 6 turn LLM 都识别 buy/sell + qty + chain)
  L2 对接: matcher publishOffer + 真 broker 真 BSC 地址 (M-wallet-inject 修后真 forward 真地址)
  L3 反馈: matcher.notifyTransition (T3.5 ship), 但**真 e2e 0 跑通** (publish 0 fire = 0 transition)

KI-18 平台无关 (markdown strip):
  ✓ matcher.stripMarkdown (line 374-384) 真 strip 5 markdown patterns
  ✓ generateOfferFeedback / generateReply 真 stripMarkdown apply
  ⚠ Brain freestyle reply 真**不**经 stripMarkdown (Brain 真自由 markdown, 5/4 真截图: '**BSC (BEP20)**' leak)

5/3 BugFix-Bot audit 抱歉模板反复 (Phase 3 backlog):
  generateReply 真 fall-through reply: '抱歉, 我没完全听懂你的意图...' / '抱歉, 发布报价时出错了...'
  真 user 看反复 '抱歉' 真不爽
  Phase 3 candidate: 真 dynamic reply 不全'抱歉'

5/4 真 e2e 暴露 UX issues:
  - Brain 真 hallucinate 假 BSC 地址 (5/4 12:51 真截图) — M-wallet-inject 修
  - publishOffer 0 fire → user 真信"已发布报价" 真转钱 但系统层无 record (5/4 09:17 1.7038 USDT 真转 broker BSC 真到 但 0 offer)
  - M-2 删 T1_DISCLAIMER 真改 "准备出报价" 文案

= L1 OK, L2 部分修 (M-wallet-inject), L3 真 untested. KI-18 部分守 (Brain freestyle leak markdown 真 P1 candidate).
```

### Dimension H: Sanity check (KI-24 broker 智能 reject)

```
matcher 真 sanity check (asyncShouldPublish gate):
  Layer 1 (cheap gates, 5/4 b1 后):
    if (intent.confidence === 'low') return false
    if (intent.side !== 'buy' && intent.side !== 'sell') return false
    if (intent.missing_fields?.length > 0) return false
    if (!adapterUrl) return false
  
  Layer 2 (LLM SHOULD_PUBLISH_SYSTEM):
    user 含 confirm 词 + intent.evm_address (EVM 链) OR intent.pay_chain==='KASPA' → ready=true

publishOffer endpoint 真 sanity check (api/exchange.js:131-319):
  ✓ relayNodeId required (400 missing)
  ✓ give/want asset/amount required
  ✓ KAS exposure limit (5000 per offer / 20000 total)
  ✓ EVM give-asset 余额预校验 (line 206-238)
  ✓ KAS fund-lock pre-broadcast
  ✓ broadcast 5 attempt 真 retry (UTXO mempool conflict)

真 reject scenarios:
  ✗ 真不合理 qty (太小 < 1 KAS / 太大 > 1M KAS)? — broker-buy-handler.js MIN_QTY_KAS=1.0 / MAX_QTY_KAS=1M, 但 matcher 没 enforce
  ✗ 真不合理 chain (不支持的 like 'XRP')? — matcher computePricing 真 default 'BSC', 不 reject 不支持 chain
  ✗ duplicate offer (同 user 已有 active offer)? — exchange.js publish 不查 same maker existing 'open' offer
  ✗ chain 真支持 broker 9 链? — matcher publishOffer payload accepted_chains 真 inject (M-wallet-inject), 但**真 LLM 不 obey schema** 风险

5/4 KI-24 真验证 (T3.7 broadcast 提到):
  ✓ broker 真智能 reject 不合理价格 (Trader-M Brain freestyle 真识别价格偏离 — 但是 Brain freestyle 不是 deterministic, 不可信)

= sanity 真有 publishOffer endpoint 层守, matcher 自己 sanity 真薄. 真依赖 LLM (Brain) 智能, 真不 deterministic. Step 2 漏洞清单候选: matcher 真加 deterministic sanity (qty range / chain whitelist / duplicate offer check).
```

---

---

## Stage 3 — 快速形成订单 (publishOffer)

**真 status**: 5/4 真 e2e 暴露 publishOffer **0 fire** (cheap_gate_confidence) — Stage 3 真核心 broken。 M-wallet-inject 修 accepted_chains payload 但 publish 没 trigger 也没 verify。

### Dimension A: 真涉及 file

| File | line range | 职责 |
|------|-----------|------|
| `agent-mind/src/skills/matcher.mjs` | 363-403 | publishOffer 真 entry: relayNodeId required → computePricing → accepted_chains inject (M-wallet-inject) → POST /api/exchange/publish → res.ok + offer_id parse |
| `agent-mind/src/skills/matcher.mjs` | 73-91 | extractIntent 真 publish trigger: asyncShouldPublish ready=true → publishOffer 真 try-catch + M-3 telemetry |
| `agent-mind/src/skills/matcher.mjs` | 348-360 | computePricing (T2 简化, MID=0.04 hardcode 真 placeholder, T3 加 mid_price 来源 market-data Phase 3) |
| `kasia-console/src/api/exchange.js` | 131-319 | POST /api/exchange/publish 真 9 step: relay address resolve → KAS exposure limit (per/total) → EVM 余额预校验 → KAS fund-lock → 5 attempt broadcast retry → DB INSERT exchange_offers post-broadcast → return ok+offer_id+broadcast_tx |
| `kasia-console/src/services/fund-lock.js` | 1-127 | lockFunds (line 23-61) / releaseFunds (66-76) / spendFunds (81-91): UNIQUE(order_id, asset) 防超卖, agent_address 维度 SUM available |
| `kasia-console/src/services/relay-manager.js` | 245+ | sendCommandAsync(relayNodeId, command, timeoutMs=30000): IPC fork-process command, 真等 child reply with txId/error |
| `kasia-console/src/services/trade-protocol-filter.js` | 393-451 | handleExchange (remote 节点 ingest path): 当其他 node 真 broadcast 'kanet_exchange_v1' 时, 本地 Trader-M 真 INSERT exchange_offers (idempotent by broadcast_tx_id+message_index) — autoTaker setImmediate evaluate (line 448-450) |
| `kasia-console/src/services/trade-protocol-filter.js` | 367-374 | EXCHANGE_MSG constants: PUBLISH='kanet_exchange_v1' / ACCEPT='kanet_exchange_accept_v1' / PAID='kanet_exchange_paid_v1' / DELIVERED='kanet_exchange_delivered_v1' / TIMEOUT/CANCEL/DISPUTE/RESOLVE_v1 |
| `kasia-console/src/services/market-seeder.js` | (老 broker reference) | seeder publish 真路径: 5min tick 自动挂单 + 真 broker BSC 钱包从 agent_wallets query + verification_meta.accepted_chains inject (Trader-M matcher 真应该参照模板, 但是 seeder 老 broker 走 Trader-B is_dex_broker=1 路径) |

### Dimension B: 真表

```sql
-- exchange_offers 真完整 schema (32 字段, v38+)
CREATE TABLE exchange_offers (
  id TEXT PRIMARY KEY,                    -- UUID 本地生成 OR 从广播 msg.id 取
  broadcast_tx_id TEXT,                   -- 链上广播 TX hash (post-broadcast 真填)
  message_index INTEGER NOT NULL,         -- 同 TX 多条广播时序号
  
  -- 资产 (字符串自由, 不是枚举)
  give_asset TEXT NOT NULL,               -- KAS / USDT / USDC / 任意
  give_amount TEXT NOT NULL,              -- 字符串存储, 跨精度 safe
  give_chain TEXT,                        -- kaspa / bnb / eth / ...
  want_asset TEXT NOT NULL,
  want_amount TEXT NOT NULL,
  want_chain TEXT,
  
  -- 双方
  maker TEXT NOT NULL,                    -- 挂单方地址
  taker TEXT,                             -- accept 后填
  taker_chain TEXT,                       -- taker 选的支付链
  taker_payment_address TEXT,             -- taker 选的收款地址 (broker side)
  taker_tx_id TEXT,                       -- accept_v1 chain TX
  payment_tx TEXT,                        -- taker submit-payment TX hash
  delivery_tx TEXT,                       -- broker sendKaspa TX hash
  
  -- 时间
  broadcast_at TEXT,
  expires_at TEXT,
  matched_at TEXT,                        -- accept 时填
  verifying_started_at TEXT,
  delivering_at TEXT,                     -- delivering 状态进入时间
  completed_at TEXT,
  disputed_at TEXT,
  timed_out_at TEXT,
  cancelled_at TEXT,
  maker_confirmed_at TEXT,
  taker_confirmed_at TEXT,
  
  -- 验证
  verification TEXT NOT NULL,             -- manual / cross_chain_tx / kaspa_tx / oracle
  verification_meta TEXT,                 -- JSON: accepted_chains[] / expected_asset / receive_chain / payment_tx
  metadata TEXT,                          -- JSON freeform
  
  -- 状态
  protocol_status TEXT NOT NULL,          -- open / matched / verifying / delivering / verified / completed / disputed / timed_out / cancelled / expired / failed / awaiting_manual_confirm / awaiting_oracle
  is_fully_observed INTEGER NOT NULL,     -- 0/1 节点观察到完整 lifecycle
  market_key TEXT NOT NULL,               -- 派生: [give_asset, want_asset].sort().join('|')
  observed_by_node TEXT,
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- broadcast_messages 真 (chain TX 真存储, 真 chain truth)
CREATE TABLE broadcast_messages (
  id TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL,             -- 'kanet-exchange' / 'dev-coord' / etc
  sender_address TEXT NOT NULL,
  content TEXT NOT NULL,                  -- JSON-encoded protocol message: {"t":"kanet_exchange_v1",...}
  tx_hash TEXT,                           -- chain TX
  status TEXT,                            -- broadcasted / confirmed
  created_at TEXT NOT NULL
);

-- fund_locks (KAS 锁定真表)
CREATE TABLE fund_locks (
  id TEXT PRIMARY KEY,
  agent_address TEXT NOT NULL,            -- broker (Trader-M) 钱包
  order_id TEXT NOT NULL,                 -- exchange_offers.id
  asset TEXT NOT NULL,                    -- 'KAS' / 'USDT' (BUY 路径仅 KAS lock)
  amount REAL NOT NULL,
  status TEXT NOT NULL,                   -- locked / released / spent
  created_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE(order_id, asset)                 -- 真防重锁
);

-- pending_exchange_accepts (orphan accept buffer, T3.4 grep evidence)
CREATE TABLE pending_exchange_accepts (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  msg_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);
```

### Dimension C: 真协议消息 schema

```js
// matcher publishOffer payload (matcher.mjs:380-403, post M-wallet-inject)
const payload = {
  relayNodeId,                            // Trader-M relay UUID
  give_asset: 'KAS',                      // computePricing buy: give='KAS', sell: give=intent.asset
  give_amount: '5',                       // String, 防精度
  give_chain: 'kaspa',
  want_asset: 'USDT',
  want_amount: '0.20',                    // 5 KAS * MID 0.04 = 0.20 USDT (T2 simplified)
  want_chain: 'BSC',                      // intent.pay_chain
  verification: 'cross_chain_tx',
  verification_meta: {                    // M-wallet-inject 真 inject
    accepted_chains: [                    // broker 9 链真 BSC 地址
      { chain: 'bnb', address: '0xD8A87c1AfcFadAd...da47' },
      { chain: 'eth', address: '0xebE2DEb...4145a' },
      // ... polygon/arbitrum/sol/tron 等真有钱包就 inject
    ],
    expected_asset: 'USDT',
    receive_chain: 'BSC',
  },
  expires_minutes: 30,
};

// /api/exchange/publish endpoint 真 internal protocolMsg (exchange.js:155-168)
const protocolMsg = {
  t: 'kanet_exchange_v1',                 // 真协议 type
  id: offerId,                            // UUID 本地生成 (真 publish 时)
  give_asset, give_amount, give_chain,
  want_asset, want_amount, want_chain,
  expires_at: ISO时间戳,
  verification, verification_meta,
};

// send_broadcast IPC command (relay-manager.sendCommandAsync)
sendCommandAsync(relayNodeId, {
  type: 'send_broadcast',
  channel: 'kanet-exchange',
  message: JSON.stringify(protocolMsg),   // 真 stringify
});

// Relay 真 broadcast: 链上 chain TX, payload 真含 prefix 'ciph_msg:1:bcast:kanet-exchange:' + utf8 protocolMsg
// (kanet-exchange channel 是 broadcast channel, NOT 1:1 comm. 协议消息 broadcast 全网可见)
```

### Dimension D: 数据流 (含 Stage 2→3 plumbing + 9 step trace)

**Stage 2 → Stage 3 plumbing trace** (Owner 真要求):

```
[Stage 2 真完成]
  matcher.extractIntent: LLM 真返 intent JSON (含 evm_address, side='buy', qty=5, asset='KAS', pay_chain='BSC')
  matcher.asyncShouldPublish (5/4 b1 后): cheap gate pass → LLM SHOULD_PUBLISH ready=true → return true
  matcher.formatForBrain: intent.should_publish=true → publishOffer try-catch 触发
       ↓
[Stage 3 真 fire 9 step]
  ↓
[1] matcher.publishOffer (matcher.mjs:363-403):
       intent.side check (buy/sell only) 
       intent.qty + intent.asset required check
       relayNodeId = this._config.relayNodeId  ← Trader-M relay UUID
       computePricing(intent) → give/want pair (BUY: give=KAS, want=USDT)
       accepted_chains = [...this._walletAddresses.entries()]  ← M-wallet-inject 真 inject
       payload = { relayNodeId, ...pricing, verification: 'cross_chain_tx', verification_meta, expires_minutes: 30 }
       fetchJson(`${consoleUrl}/api/exchange/publish`, { POST, body: payload })
       ↓
[2] /api/exchange/publish endpoint (exchange.js:131-319, 9 sub-step):
       
       (a) line 144-146: required field validation (relayNodeId/give/want)
       (b) line 148: offerId = randomUUID()
       (c) line 153: marketKey = [give_asset, want_asset].sort().join('|')
       (d) line 156-168: protocolMsg JSON build
       (e) line 171-172: SELECT relay_nodes.address WHERE id=relayNodeId → makerAddr
       (f) line 175-202: KAS exposure limit (per_offer 5000, total 20000) 
           - 查 SUM(give_amount) FROM exchange_offers WHERE protocol_status='open' AND maker=makerAddr
           - 真 reject 400 if exceeds
       (g) line 204-238: EVM give-asset 余额预校验 (Owner 真有 USDT/USDC 才让 publish, fetch /api/relay/:id/wallets)
       (h) line 241-253: KAS fund-lock (give_asset='KAS') 
           - lockFunds(makerAddr, offerId, 'KAS', give_amount, balance)
           - UNIQUE(order_id,asset) 防重锁
           - 余额不够 reject 400
       (i) line 259-282: **broadcast FIRST** chain truth — 5 attempt retry (5/10/15/20s exp backoff)
           sendCommandAsync(relayNodeId, { type:'send_broadcast', channel:'kanet-exchange', message:JSON.stringify(protocolMsg) })
           真 5 次 attempt 防 UTXO mempool conflict (T-J2-2026-04-28 Phase D P0 sediment)
           失败 503 + releaseFunds (line 284-290)
       (j) line 293-311: post-broadcast confirm → INSERT exchange_offers row 真 (chain truth → DB projection)
       (k) line 313-318: return { ok: true, offer_id, broadcast_tx, expires_at }
       ↓
[3] matcher.publishOffer 接 res:
       res.ok 检查 (line 328 真 KI-3 implementer authoritative reconciliation T2 修)
       res.offer_id check
       log [matcher] publishOffer ok offer=... tx=...  (5/4 truth: 真 fire 时这条 log 出, 但实测 0 出 = publish 0 fire)
       return { offer_id, broadcast_tx, expires_at, payload, success:true }
       ↓
[4] matcher.extractIntent line 81-89:
       intent._offerResult = offerResult  (or _publishError if throw)
       M-3 telemetry: 5/4 ship _reportPublishDecision(config, 'publish_offer_failed', { error, intent_side, intent_qty })
       ↓
[5] matcher.formatForBrain (425-471):
       intent._offerResult 真有 → reply = generateOfferFeedback(intent, offerResult)
         "好的, 我已经为你发布报价 #abc12345.
          📋 报价详情:
            - 你付: 0.2 USDT (BSC)
            - 你收: 5 KAS
            - 有效期: 30 分钟
          💸 下一步: 请向 broker 钱包付款..."
       cleanedReply = stripMarkdown(reply)
       walletInstr = '🔒 BROKER 真收款地址: BSC: 0xD8A87...; ETH: 0xebE2...'  (M-wallet-inject)
       return { instructions: walletInstr + cleanedReply, ... }
       ↓
[6] mind.mjs reactive cycle (433): Brain LLM call with skill instructions inject 进 user prompt SKILL DATA section
       Brain 真 forward offer detail 给 user (M-wallet-inject 后真 forward 真地址)
       ↓
[7] reply 经 Action Executor / Relay sendKaspa comm encrypted to user → user Kasia client decrypt
       user 真看到: "已发布报价 #abc12345, 真 BSC 收款地址 0xD8A87..."
       user 真转 USDT 进入 Stage 4
       ↓
[8] **远程 ingest path** (其他 node 真观察 Trader-M 的 broadcast):
       Scout / Trader-A/B Relay 看到 chain block 真含 'kanet-exchange' 协议 TX
       trade-protocol-filter.handleExchange (line 393-451):
         msg.t='kanet_exchange_v1', msg.id=offerId
         idempotent check: SELECT exchange_offers WHERE broadcast_tx_id=msg._tx AND message_index=msgIndex
         真 INSERT exchange_offers (新 row, observed_by_node 自身)
         pending_exchange_accepts replay (orphan accept buffer)
         setImmediate _evaluateAutoTake(offerId, msg) (autoTaker)  ← Stage 4 入口
       ↓
[9] chain_events 真留痕 (relay 真 ingestTx 调用 line 525-532):
       recordChainEvent({ txid: result.txId, eventType: 'comm_sent', fromAddress: responder.address, payload: JSON.stringify({ channel, length }) })
       (注: 真 publish broadcast 真 chain_events 写 'comm_sent' for sender, 远程 node 写 'comm' OR 'tx')
```

**跨 stage race / silent / drift 嫌疑**:

| # | 嫌疑 | 真 grep verify | 真状态 |
|---|------|---------------|-------|
| **R8** | publish broadcast 5 attempt 失败 真 release fund-lock 但 user 真 unaware? | exchange.js:284-290 release on failure, return 503 → matcher.publishOffer throw → M-3 telemetry | ✓ M-3 telemetry 真 catch fail; 但 user 真 reply 仅 "抱歉, 发布报价时出错了" generic |
| **R9** | matcher.publishOffer 真**没** sanity check qty range / chain whitelist / duplicate offer | matcher.mjs:367-380 仅 side+qty+asset+relayNodeId required, 0 sanity | ❌ **真 P0 漏洞** — M-confidence-relax 后 medium pass 真 LLM 不严判时, 真 unsafe publish |
| **R10** | exchange.js:206-238 EVM 余额预校验 真 cover BUY 路径? | BUY 路径 give_asset='KAS' 不进 EVM 校验 (only `give_asset !== 'KAS'`); SELL 真校验 USDT/USDC | ⚠ BUY 不需要预校验 EVM, OK; SELL 真 enforce |
| **R11** | broadcast post 才 INSERT exchange_offers, 但 broadcast 真 broadcast OR 仅 mempool? | exchange.js:264-268 sendCommandAsync 真等 child reply with txId, 真 mempool 即返 (broker-cancel-refund 沉淀: confirmed 真要 chain finality) | ⚠ broadcast txId 真返 = mempool; 真 chain finality 后续 trade-protocol-filter 真 ingest 才 verify |
| **R12** | trade-protocol-filter.handleExchange 真本地 Trader-M 自己 self-broadcast 也 ingest? | line 396-403 idempotent by (broadcast_tx_id, message_index) — 真 OK 重复 ingest skip | ✓ idempotent 守 |
| **R13** | matcher computePricing MID=0.04 真 hardcode placeholder | matcher.mjs:349 const MID=0.04, 真 T3 phase 3 candidate (mid_price 来源 market-data) | ❌ **真 P1 漏洞** — broker 真 publish 出错价 (5/4 真 KAS 价 0.034, MID 写 0.04 = 18% 偏高) |
| **R14** | accepted_chains inject 真 broker 9 链全 OR 仅有钱包的? | matcher.mjs:386-389 真 loop _walletAddresses.entries 仅 inject 真有 address 的 chain | ✓ M-wallet-inject 真 OK |
| **R15** | EVM give-asset 余额预校验 真 fetch 钱包 balance 真 timeout 8s, 真 fail 真 silent skip | exchange.js:235-237 `console.log(...non-fatal: ${e.message})`, **真 skip** 不阻 publish | ⚠ silent fall-through — 真 broker USDT 不够仍 publish, 真 SELL 失败时 user 已转 KAS |

### Dimension E: State ownership (KI-20) — grep verify 真出 evidence

```
真 state owner trace:

Truth source: chain_events (Kaspa 链 immutable)
  - 'comm_sent' for sender broadcast (relay)
  - 'tx' for 真 chain TX 观察 (relay)

Projection: exchange_offers (DB cache, rebuildable from chain_events replay)
  - protocol_status (deriveProtocolStatus T3.4 ship)
```

**真 grep verify** (5/4 实测 `grep "SET\s+protocol_status\s*=" kasia-console/src` — **7 SQL writers**, 之前估的 14 偏高):

| # | file:line | 真 SET 路径 | KI-20 verdict |
|---|----------|------------|--------------|
| 1 | `api/exchange.js:48` | sweepExpired (cron, open → expired) | ✓ 本地 expire 算 derived projection — 但**没** emit chain TX, 严格 KI-20 应 emit timeout_v1 (defer Step 2 backlog) |
| 2 | `api/exchange.js:782` | POST /api/exchange/resolve (admin override maker_wins/taker_wins) | ⚠ **admin 直写, KI-20 violation candidate** — dispute 救生路径, 但应 emit `resolve_v1` chain TX 由 trade-protocol-filter 写 (Step 2 backlog) |
| 3 | `broker-intake-watcher.js:298` | broker buy 路径 timed_out (无 taker accept) | ⚠ 本地 watcher 直写, 不 emit cancel_v1 chain TX (KI-20 violation, Step 2 backlog) |
| 4 | `broker-state-authority.js:440` | broker buy refund 后 → refunded | ⚠ refund TX 上链后 SET — 半守 (chain-after-set, 但 SET 真不通过 trade-protocol-filter ingest, Step 2 backlog) |
| 5 | `exchange-machine.js:590` (FIXED 5/4) | timeoutVerifying transition('timed_out') — 原 transition() 内 SET 0 emit chain TX → V5 KI-20 violation. **5/4 fix**: 加 `_emitTimeoutAndTransition` helper 真 emit timeout_v1 chain TX 5 attempt retry FIRST 真 transition (chain-first 严守, 跟 checkMatchedTimeout line 642-665 同款 pattern). 注: J2 r147 KI-29 复刻第 2 次 — 原 grep 真出 line 679 (checkMatchedTimeout) 真 wrong location (line 642 已 emit chain TX FIRST), 真 violation 真在 timeoutVerifying line 590 | ✓ chain-first 严守 (post 5/4 V5 fix) |
| 6 | `trade-protocol-filter.js:1102` | handleExchangePublish remote ingest → open | ✓ **chain-first 真守** (chain TX → ingest → SET) |
| 7 | `trade-protocol-filter.js:1229` | handleExchange{Accept,Paid,Delivered,Timeout,Cancel,Dispute,Resolve} generic transition | ✓ **chain-first 真守** (chain TX → ingest → SET) |

**真 KI-20 严守率**: 2/7 (29%) — 5 个 violation candidates 真在 Stage 4 settlement (Step 2 漏洞清单 backlog).

**Stage 3 真 publish path KI-20 verdict**:

```
matcher.publishOffer (chain TX broadcast first)
  ↓
relay sendCommandAsync send_broadcast 真 emit chain TX
  ↓
Trader-M 自己 (api/exchange.js:293-311) INSERT exchange_offers (post-broadcast confirm) 
  → INSERT 不是 SET, 是 init row 真 chain TX 已上 (DB 真 follow chain truth)
  ↓
其他 node trade-protocol-filter.handleExchangePublish (line 1102) ingest chain TX → INSERT OR IGNORE + SET protocol_status='open'
  → SET 真来自 chain ingest (KI-20 严守)

= Stage 3 真 publish path KI-20 ✓ 真守, 没有 admin / cron / 直 SQL bypass.
```

**Stage 3 publish 真 chain-first ✓; Stage 4 真 settlement 5 KI-20 violation candidates** (Step 2 漏洞清单 backlog 标 P1).

---

### Dimension D 补 — 5/4 ghost 对话真 root cause: Stage 2 vs Stage 3 真 throw silent?

**真 ghost 现象**: 5/4 09:17 Brain 真 freestyle reply "请提供 BSC TX hash" / 12:51 Brain 真 forward 真 BSC 地址但 0 真 offer row in exchange_offers — user 真等真 broker 真 publish 但 0 publish。

**Stage 2 vs Stage 3 真 throw 真 ghost 真因 explicit 对比**:

| 嫌疑层 | 真 throw 真 catch trace | 真 e2e evidence (5/4) | verdict |
|-------|----------------------|---------------------|--------|
| **Stage 2 cheap_gate** (extractIntent line 71) | 真 fail-closed: cheap gate 'low' return null → matcher.formatForBrain 真 fallback "我可以帮你..." 通用 reply, **不**触发 publishOffer | events 表 `matcher_publish_decision` 1 row decision='cheap_gate_confidence' (M-1 telemetry 5/4 04:23 fire) | ✓ Stage 2 真 catch |
| **Stage 2 LLM SHOULD_PUBLISH** (asyncShouldPublish) | 真 fail-closed: ready=false return null → 同上 | M-confidence-relax (5/4 d8751c568) ship 后 medium 也放过 — 但 events 表 0 decision='llm_ready_true' row evidence | ✓ Stage 2 catch (但 5/4 后续 b2 修通 confidence high 后真应 fire) |
| **Stage 3 publishOffer** (matcher.mjs:363-403) | try-catch 真 wrap (extractIntent line 81-86 真 catch) → intent._publishError 填入 + M-3 telemetry 'publish_offer_failed' fire | events 表 0 row decision='publish_offer_failed' 真 evidence | ✗ Stage 3 0 fire (publish 没 reach Stage 3) |
| **Stage 3 endpoint /api/exchange/publish** | 真 fail-fast 4xx/503 + JSON err body → matcher 接 res.ok=false → throw 真 catch 同上 | 0 console log entry "POST /api/exchange/publish" (真 no req fire) | ✗ Stage 3 endpoint 0 hit |

**Explicit 真 root cause conclusion** (5/4 ghost 对话):

```
真 root cause = Stage 2 cheap_gate_confidence 真 fail-closed
  - LLM extractIntent 真返 confidence='medium' (default)
  - cheap gate 真严守 'high' only → return null → publishOffer 0 fire
  - matcher.formatForBrain 真 fallback "我可以帮你..." → Brain 真没 skill data inject 
  - Brain 真 freestyle hallucinate (act-as-broker 真演 BSC 地址 / TX hash 请求)

= Stage 3 真无辜 (try-catch 真 wrap, M-3 telemetry 真 ready). 真 ghost 真因 Stage 2 cheap_gate 太严.

修复历程 (5/4 真 commit chain):
  1. M-1 c45e7772b — telemetry 真定位 'cheap_gate_confidence' 真因
  2. M-confidence 4c5763ee1 — prompt rules 加 high confidence example (LLM 仍 default medium)
  3. M-confidence-relax d8751c568 — cheap gate 'low' only block, 'medium' 放过 (双层守 by asyncShouldPublish LLM 后判)
  4. M-wallet-inject 3113c3362 — broker 真钱包地址 inject Brain prompt (防 freestyle hallucinate)

5/4 真 last status: Stage 2 b2 修通后 publish 真应 fire, 但**真 e2e 真 0 跑通**待 b2 ship + Trader-M env setup ready.
```

**真 ghost 真不是 Stage 3 silent throw, 是 Stage 2 fail-closed 太严 + Brain freestyle 真填空白**.



### Dimension F: 健康监控 (KI-16)

```
真 monitor:
  - /api/exchange/publish endpoint alive — 没 dedicated /health (default fastify)
  - sendCommandAsync 真 functioning — relay-manager 5min cron tick 真 active
  - KAS exposure limit enforced — 实时 SQL query (line 188-202)
  - EVM 余额预校验 — 8s timeout, fail 真 silent skip (R15 嫌疑)

agent-health.js Stage 3 真 cover:
  - publish endpoint reach? — 不直 cover, 但 lastEvent indicator 真 broker 行为时 update
  - publishOffer 真触发率? — events 表 'matcher_publish_decision' decision='llm_ready_true' count, **真盲区** (没 dashboard / alert)
  - broadcast 真 confirm 率? — 5 attempt 真 retry pass 率, 真盲区

真盲区:
  - 单笔 publish 真 latency (5 attempt 真 wait time ~5-50s)
  - per-stage 失败原因 (KAS exposure / EVM balance / fund-lock / broadcast retry exhausted)
  - 跨 chain 钱包真同步状态 (M-wallet-inject 真 fetch 8s timeout, 真 stale OK?)

= alive OK, functioning 部分, 真盲区 publish latency / 失败 reason 分布 / wallet sync staleness, Phase 3 candidate.
```

### Dimension G: 用户体验 (KI-17 + KI-18)

```
KI-17 三层:
  L1 识别: matcher.extractIntent 已识别 (Stage 2)
  L2 对接: matcher.publishOffer 真 fire → exchange_offers row 真创建 + chain TX 真广播
  L3 反馈: matcher.generateOfferFeedback 真返 user-friendly text + offer detail

5/4 真 e2e UX issues:
  - publish 0 fire = L2/L3 全 broken (cheap_gate 卡)
  - Brain freestyle 演 broker (5/4 09:17 "请提供 BSC TX hash" 但真 0 offer)
  - M-2 删 T1_DISCLAIMER + 改 "准备出报价" 文案让 Brain 真 forward (5/4 ship)
  - M-wallet-inject 让 Brain 真 forward 真 broker BSC 地址 (5/4 ship verified 真 work, 12:51 真截图 evidence)

KI-18 平台无关:
  - matcher.stripMarkdown 真 apply (line 374-384, 5 patterns)
  - generateOfferFeedback 真 stripped (5/4 e2e 实证)
  - **Brain freestyle reply 仍 leak markdown** (5/4 真截图: '**BSC (BEP20)**' bold 真在)
  - 真 P1 candidate: Brain reply 真后置 stripMarkdown OR enforce SYSTEM_PROMPT no-markdown

KI-17 真 broker 三层 vs Stage 3 真 mismatch:
  - 真 publish offer 后 user 期待 "已收到付款验证..." 真 transition feedback (Stage 4 notifyTransition 真 deliver)
  - Stage 3 真 user-facing 仅 "好的, 已发布报价 #..." (一次性 feedback, 后续靠 Stage 4)

= L1 OK, L2 真 broken (publish 0 fire), L3 真 broken (no offer = no feedback). M-confidence-relax 修通 publish 后 L2/L3 真应 work.
```

### Dimension H: Sanity check (KI-24)

```
publishOffer endpoint 真 sanity (exchange.js:131-319):
  ✓ relayNodeId required (400 missing)
  ✓ give/want asset/amount required
  ✓ KAS exposure limit per_offer 5000 (line 181-186)
  ✓ KAS exposure limit total 20000 (line 188-202)
  ✓ EVM give-asset 余额预校验 (line 206-238, 但真 fail silent skip — R15 嫌疑)
  ✓ KAS fund-lock pre-broadcast (line 241-253)
  ✓ 5 attempt broadcast retry (UTXO mempool conflict, line 261-282)
  ✓ broadcast 真失败 release fund-lock + 503 (line 284-290)

matcher 真 sanity (matcher.publishOffer 真薄 — R9 漏洞):
  ✓ side ∈ {buy, sell}
  ✓ qty + asset required
  ✓ relayNodeId from this._config required (throw if missing)
  ✗ 不 reject 不合理 qty range (broker-buy-handler MIN_QTY_KAS=1.0 / MAX_QTY_KAS=1M, matcher 真**没**)
  ✗ 不 reject 不支持 chain (matcher.computePricing default 'BSC' 真 silent fallback)
  ✗ 不 reject duplicate offer (同 user 已有 active offer 真**不查**)
  ✗ 不 reject EVM 链 buy 缺 evm_address (asyncShouldPublish 真 LLM 判 — 不 deterministic)
  ✗ 不 reject computePricing MID=0.04 hardcode 真不合理 (5/4 KAS 真 0.034, 价格真偏 18% — R13 漏洞)

KI-24 broker 智能 reject (T3.7 broadcast 提到):
  ✓ Brain 真智能 reject 不合理价格 (Trader-M 真识别 0.02 USDT/KAS 偏离市价 0.034)
  - 但 Brain 智能真**不 deterministic**, 不可信. 真 sanity 应在 matcher / endpoint 层 enforce.

= publishOffer endpoint 真 sanity 厚, matcher 自己 sanity 真薄. 真 hidden bugs candidate (Step 2 漏洞清单):
  - R9: matcher 真无 deterministic qty range / chain whitelist / duplicate offer check
  - R13: computePricing MID hardcode 真错价
  - R15: EVM 余额预校验 silent skip
```

---

---

## Stage 4 — 订单执行 + 反馈

**真 status**: T3 ship infrastructure ready (T3.2 reactor + T3.3 emitChainProtocol + T3.5 notifyTransition + cross-chain-verify 9 chain ready) — **真 e2e 0 跑通** (Stage 3 publish 0 fire 卡)

### Dimension A: 真涉及 file

| File | line range | 职责 |
|------|-----------|------|
| `agent-mind/src/skills/matcher.mjs` | 187-206 | **T3.5 notifyTransition** — 8 transition key map (open→matched / matched→verifying / verifying→delivering / delivering→completed / open→timed_out / matched→disputed / verifying→disputed / matched→cancelled), stripMarkdown 真 apply (line 204), actionExecutor.executeOne 真 send_message (KI-17 layer 3 真核心) |
| `agent-mind/src/skills/matcher.mjs` | 211-221 | **T3.3 emitChainProtocol** — 复用 /api/relay/:id/send-command + type='send_broadcast' + channel='kanet-exchange' (NO 新 endpoint), trade-protocol-filter 真 dispatch |
| `agent-mind/src/skills/matcher.mjs` | 226-229 | emitPaymentVerified — internal log only (chain emit 由 sendKaspa + emitDeliveryInitiated 真) |
| `agent-mind/src/skills/matcher.mjs` | 233-240 | emitDeliveryInitiated — post sendKaspa, emit kanet_exchange_delivered_v1 chain TX |
| `agent-mind/src/skills/matcher.mjs` | 247-273 | **T3.2 reactToChainEvents** — fetch /api/exchange/offers?maker=myAddress&limit=20, filter ACTIVE_STATES=['matched','verifying','delivering','disputed'], 0 own state (KI-20 严守) |
| `kasia-console/src/services/trade-protocol-filter.js` | 664-733 | **handleExchangeAccept** — machineAccept → recordChainEvent 'exchange_matched' → setImmediate _autoPayExchange (cross_chain_tx) OR _autoSettleAsset (kaspa_tx) → DEX broker is_dex_broker=1 真跳过 (非托管) |
| `kasia-console/src/services/trade-protocol-filter.js` | 945-1034 | **handleExchangePaid** — Gate1 idempotent (payment_tx 已存) / Gate1.5 reuse 防御 (payment_tx 别 offer 用过 reject) / Gate2 status check (matched/verifying) / DB UPDATE payment_tx (UNIQUE constraint 真 fail-safe) / exchangeTransition matched→verifying / processPaymentSubmit (kicks _verifyAndComplete) |
| `kasia-console/src/services/trade-protocol-filter.js` | 1040-1083 | **handleExchangeDelivered** — Idempotent skip (completed/disputed/cancelled/expired) / Direct SQL UPDATE delivery_tx + protocol_status='completed' (NOT transition() — buyer state 不 match seller machine sequence) / spendFunds (Phase 1 stress test S9 fund_lock leak 修) |
| `kasia-console/src/services/trade-protocol-filter.js` | 1090-1119 | **handleExchangeTimeout** — Direct SQL UPDATE matched→open + clear taker fields + payment_tx=NULL / releaseFunds / 4/11 timeoutVerifying 真 fix (verifying_started_at+30min, NOT expires_at) |
| `kasia-console/src/services/trade-protocol-filter.js` | 1129-1199 | **handleExchangeDispute** — TERMINAL_AFTER_DISPUTE check (completed/cancelled/timed_out/failed/expired) / 幂等 disputed 真 skip |
| `kasia-console/src/services/trade-protocol-filter.js` | _autoPayExchange / _autoSettleAsset | local taker auto-pay USDT (cross_chain_tx) / auto-settle KAS (kaspa_tx) — 5 attempt retry, evm-transfer.js / settler-router.js 真 dispatch |
| `kasia-console/src/services/exchange-machine.js` | 701-742 | **processPaymentSubmit** — verifying status guard / TX reuse 防御 (UNIQUE constraint belt-and-suspenders) / verification_meta 写 / _verifyAndComplete async kick |
| `kasia-console/src/services/exchange-machine.js` | 744-1100+ | **_verifyAndComplete** — 9 chain verify (cross-chain-verify.mjs verifyCrossChainTx) + recipient/amount check + transition verifying→delivering→completed + sendKaspa (KAS) OR sendAsset (USDC/USDT generic) + 5 attempt broadcast retry delivered_v1 + spendFunds + dm_kas_delivered enqueue (broker-action-queue) + executeHedge setImmediate |
| `kasia-console/src/services/cross-chain-verify.mjs` | 12 | **REQUIRED_CONFIRMATIONS** — bnb:15 / eth:12 / polygon:35 / arbitrum:12 / optimism:12 / avalanche:12 / base:12 / sol:32 / tron:19 / kaspa:1 |
| `kasia-console/src/services/cross-chain-verify.mjs` | 169 | **verifyCrossChainTx** entry — chain dispatch (EVM 7 chain / SOL / TRON / Kaspa direct trust) |
| `kasia-console/src/services/cross-chain-verify.mjs` | 313 | _verifySolana — RPC getSignatureStatuses + getTransaction parsedInstructions filter SPL transfer |
| `kasia-console/src/services/cross-chain-verify.mjs` | 390 | _verifyTron — TronGrid /v1/transactions/{txHash} + TRC20 transfer event parse |
| `kasia-console/src/services/evm-transfer.js` | sendUsdt | **EVM USDT/USDC transfer 真 share function** (trading.js + exchange v2 共用), gas estimate + private key sign + RPC submit |
| `kasia-console/src/services/settler-router.js` | sendAsset | T-NWT-2026-04-27 Bug-Z2 fix: USDC/USDT × 7 EVM chain generic dispatcher (非 KAS path 真) |
| `kasia-console/src/services/fund-lock.js` | spendFunds 81-91 / releaseFunds 66-76 | locked → spent (completed) / locked → released (timeout/cancel) |
| `kasia-console/src/services/broker-action-queue.js` | enqueue | dm_kas_delivered 真 user 反馈 enqueue (T-J2-V2 议 2 主动 DM, 不让 user 查 explorer) |
| `kasia-console/src/services/broker-buy-completion-watcher.js` | full | broker buy 路径 completed watcher (D2 retail_dex_orders lifecycle) |
| `kasia-console/src/services/broker-cancel-refund.js` | 111+ | cancel/refund 真路径 (advanceToRefunded Phase 3 真 sync set protocol_status='refunded', chain-side cancel 仍 fire 通知 taker pool) |

### Dimension B: 真表

```sql
-- exchange_offers 真 Stage 4 SET 字段
matched_at: handleExchangeAccept 写
verifying_started_at: machineAccept 写 (verification='cross_chain_tx' 真 verifying entry)
payment_tx: handleExchangePaid 写 (UNIQUE constraint, reuse 防御)
delivery_tx: handleExchangeDelivered + _verifyAndComplete 真 SET (BUY kaspa_tx: payment_tx=delivery_tx)
delivering_at: transition('delivering') 写
completed_at: handleExchangeDelivered + _verifyAndComplete 真 SET
disputed_at / cancelled_at / timed_out_at: 各自 transition 真写

-- chain_events 真 Stage 4 11 个 event_type
'exchange_matched' / 'exchange_paid' / 'exchange_paid_reuse_rejected'
'exchange_delivered' / 'exchange_completed' / 'kas_delivery' / 'exchange_delivery_reverted'
'exchange_timeout' / 'exchange_dispute'
'hedge_placed' / 'hedge_failed' / 'hedge_skipped'

-- fund_locks 真 Stage 4 transition
locked → spent (handleExchangeDelivered:1067 / _verifyAndComplete:803 / 1025)
locked → released (handleExchangeTimeout:1109 / handleExchangeCancel)
真 UNIQUE(order_id, asset) 防超卖

-- retail_dex_orders 真 D2 lifecycle (broker SELL_KAS 路径)
'paid' / 'awaiting_payment' → 'executing' (transition verifying→delivering 真 SET, line 855)
'executing' → 'completed' (handleExchangeDelivered 真 SET + deliver_tx_hash, line 1011)

-- broker_action_queue (T-J2-V2 议 2)
dm_kas_delivered kind: peer + payload.message ('✅ 已发出 N KAS 到你 Kasia 钱包...')
```

### Dimension C: 真协议消息 schema

```js
// kanet_exchange_accept_v1 (Stage 3→4 桥)
{
  t: 'kanet_exchange_accept_v1',
  offer_id: '...',
  taker: '0xtakerEvmOrKaspaAddr',
  taker_chain: 'BSC',                // taker 选 USDT 真 EVM 链
  taker_payment_address: '0x...',    // taker 真 EVM 地址 (broker 真 USDT 收款 OR taker 真 USDT 收款 SELL)
  receive_address: 'kaspa:...',      // taker 真 KAS 收款地址 (BUY)
}

// kanet_exchange_paid_v1
{
  t: 'kanet_exchange_paid_v1',
  offer_id: '...',
  payment_tx: '0xevmTxHash OR kaspaTxHash',
  payment_chain: 'BSC',
  payer: '0xtakerEvmAddr',
}

// kanet_exchange_delivered_v1 (matcher.emitDeliveryInitiated OR exchange-machine.js _verifyAndComplete 真 emit)
{
  t: 'kanet_exchange_delivered_v1',
  offer_id: '...',
  delivery_tx: 'kaspaTxHash',
  delivery_asset: 'KAS',
  delivery_amount: '5',
  receiver: 'kaspa:...',             // 真实收件人 (T-22-05 retail-proxy 第三方收件)
}

// kanet_exchange_timeout_v1
{ t: 'kanet_exchange_timeout_v1', offer_id, taker, reason }

// kanet_exchange_cancel_v1
{ t: 'kanet_exchange_cancel_v1', offer_id }

// kanet_exchange_dispute_v1
{ t: 'kanet_exchange_dispute_v1', offer_id, reason, evidence }

// kanet_exchange_resolve_v1 (admin override 真 dispute 救生)
// 当前路径: POST /api/exchange/resolve/:id (admin endpoint, 直 SET, KI-20 violation candidate)
// 应有路径: emit chain TX + trade-protocol-filter ingest set (Step 2 backlog)
```

### Dimension D: 数据流 (Stage 3→4 plumbing + happy-path trace + R16-R26 嫌疑)

**Stage 3→4 plumbing trace** (publish 真 fire 后真 settle):

```
[Stage 3 真完成]
  Trader-M (broker) 真 publish kanet_exchange_v1 chain TX → exchange_offers row protocol_status='open'
  其他 node trade-protocol-filter.handleExchangePublish 真 ingest → autoTaker setImmediate _evaluateAutoTake
       ↓
[Stage 4 真 happy-path 9 step]
  ↓
[A] Taker 真 accept (autoTaker OR manual UI):
      taker 真 broadcast kanet_exchange_accept_v1 chain TX (含 taker_chain='BSC' + taker_payment_address)
      所有 node 真 ingest 包括 broker
      ↓
[B] broker handleExchangeAccept (line 664-733):
      machineAccept (exchange-machine.js) → exchange_offers SET taker / taker_chain / taker_payment_address / matched_at / protocol_status='verifying' (cross_chain_tx 直接 verifying, NOT matched)
      recordChainEvent 'exchange_matched'
      autoPay gate: localRelay.is_dex_broker=0 (Trader-M 真 broker 不 dex_broker) → setImmediate _autoPayExchange (但是 Trader-M 真 broker, 不是 taker, 这条 gate 真**不**触发 broker side)
      实际 broker (maker) 真 wait for taker 真 broadcast paid_v1
      matcher reactor (T3.2) 真 detect open→matched→verifying transition → notifyTransition send 'open→matched' DM (但只 fire transition 一次, T3.5 map 'open→matched' OR 'matched→verifying' 各 fire)
      ↓
[C] Taker 真 sendUsdt evm-transfer.js (USDT BSC) → BSC chain TX
      taker 真 broadcast kanet_exchange_paid_v1 chain TX (含 payment_tx=evmTxHash + payment_chain='BSC')
      ↓
[D] broker handleExchangePaid (line 945-1034):
      Gate1 idempotent / Gate1.5 reuse 防 / Gate2 status (matched/verifying) check
      DB UPDATE payment_tx (UNIQUE constraint belt-and-suspenders)
      exchangeTransition matched→verifying (cross_chain_tx 已 verifying)
      processPaymentSubmit ({offer_id, payment_tx, payment_chain})
        → _verifyAndComplete async kick (NOT block)
      recordChainEvent 'exchange_paid'
      ↓
[E] _verifyAndComplete (exchange-machine.js:744+):
      verifyCrossChainTx ({txHash, chain='BSC', expectedAmount, expectedTo, paymentAsset='usdt'})
        → REQUIRED_CONFIRMATIONS bnb=15 → poll RPC until 15 confirmation OR timeout
      vr.confirmed → meta.verified_tx + verified_at + confirmations 写 verification_meta
      transition verifying→delivering
      retail_dex_orders D2: state='paid' OR 'awaiting_payment' → 'executing' (line 853-861)
      ↓
[F] 真 sendKaspa OR sendAsset (line 868-948):
      give_asset='KAS' 路径: relay sendCommandAsync transfer (KAS)
      give_asset≠'KAS' (USDC/USDT) 路径: settler-router.sendAsset (J1 generic)
      MAX_DELIVERY_ATTEMPTS=3, DELIVERY_RETRY_MS=10s
      失败 3 次 → transition delivering→verified (retryable, NOT dispute)
      ↓
[G] 真 emit kanet_exchange_delivered_v1 (line 950-984):
      sendCmd send_broadcast channel='kanet-exchange' message=delivered_v1 JSON
      5 attempt broadcast retry (200ms × ba 递增 backoff)
      失败 → 'kas_delivery' broadcast_failed=true chain_event 留痕 + **STAY in delivering** (NOT mark completed, NO TX NO STATE CHANGE 严守)
      ↓
[H] handleExchangeDelivered 真 ingest (其他 node 真 observe):
      Direct SQL UPDATE delivery_tx + protocol_status='completed' + completed_at + is_fully_observed=1
      spendFunds (locked → spent)
      retail_dex_orders D2: state='executing' → 'completed' (line 1011)
      recordChainEvent 'exchange_delivered' + 'exchange_completed'
      broker-action-queue enqueue dm_kas_delivered → user 真收 DM "✅ 已发出 N KAS..."
      ↓
[I] executeHedge setImmediate (line 1080-1095):
      makerGaveKas 真 → SELL hedge / makerGave≠KAS → BUY hedge
      _hedgeGateOffer.meta.hedge_enabled=true 才触发 (默认 false safety)
      _isHedgeCircuitOpen 真 ≥3 fail 1h 真 skip
      placeOrder MEXC/Gate/Bybit/etc CEX → 'hedge_placed' / 'hedge_failed' chain_event
      ↓
[J] matcher reactor (T3.2 path b) 真 next reactive cycle:
      reactToChainEvents 真 fetch ACTIVE_STATES (matched/verifying/delivering/disputed) — completed 真 NOT in active, reactor 真**stop tracking**
      notifyTransition 真 fire 'delivering→completed' DM ('🎉 KAS 已发出, 交易完成! 请查询钱包确认收款.') — **但 Limitation: Skill-instance fires per peer DM, NOT independent timer**, 真 user 不 DM 真 reactor 真 0 fire (R20 嫌疑)
```

**跨 stage race / silent / drift 嫌疑**:

| # | 嫌疑 | 真 grep verify | 真状态 |
|---|------|---------------|-------|
| **R16** | matcher reactor 真 fire 8 transition keys 全 OR 部分? | matcher.mjs:247-273 reactToChainEvents 真 fire per peer DM cycle, 真 active offer fetch ACTIVE_STATES, 0 transition 触发器 — 真**0 自动 fire** unless peer DM 期间 transition 巧合发生 | ❌ **真 P0 漏洞** — KI-17 layer 3 反馈真 8 keys 真 fire 率极低 (依赖 user 真 DM 时机) |
| **R17** | handleExchangeDelivered Direct SQL UPDATE 不走 transition() — 真 KI-20 violation? | line 1058-1061 真 direct SQL `UPDATE exchange_offers SET delivery_tx=?, protocol_status='completed'` (NOT transition() per 注释 'buyer state 不 match seller machine sequence') | ⚠ **半守** — 真 chain TX 已 emit (delivered_v1 broadcast 成功才 ingest), DB SET 真 follow chain (chain-after-set), 但**绕过 transition() 守护** (state machine 真 ALLOWED_TRANSITIONS 真 check 跳过) |
| **R18** | _verifyAndComplete BUY kaspa_tx 路径 (line 799-822) 真直接 transition('delivering') + transition('completed') 跳 sendKaspa | line 801-802 真 brief pass-through transition, 真 KAS 已收 (taker 真 sendKaspa 第一步), 不需要 broker 再 send | ✓ 真业务正确 (BUY: user 付 KAS 给 broker, broker 已收 KAS, broker 真 deliver USDT 真 _makerAutoPayGive — 但 _makerAutoPayGive grep 0 row?) |
| **R19** | _makerAutoPayGive 真存在 OR 缺失? | **NWT r180 multi-path grep verify 真反转** — 5/4 J2 单 grep "_makerAutoPayGive" 0 row 真 KI-29 反模式 (J2 漏 grep callers/imports/transition body, 仅依赖 line 1065 注释字面). 真完整路径: (1) exchange-machine.js:192 `export async function _makerAutoPayGive(offer)` 46 行实施 (2) line 179 真 `transition()` body trigger condition `newStatus === 'completed' && offer.give_asset === 'USDT' && offer.give_chain` (3) 4 smoke tests 真 cover (smoke-t5b-quick.mjs / smoke-t5b-behavioral.mjs / smoke-t5b-behavioral-v2.mjs / smoke-e2e-broker-integration.mjs) (4) line 220+234 pushPubTransition failed/completed 双路径 | ✅ **重大 false alarm** — BUY USDT delivery 真完整路径存在 (transition('completed') → line 179 trigger → _makerAutoPayGive 192 → retail_dex_buy_publications filled query → EVM wallet → transferUsdt → 成功 push 'completed' / 失败 push 'failed') |
| **R20** | matcher reactor 真 limitation per task v1.1 §T3.2 注释: Skill-instance fires per peer DM, NOT independent timer | matcher.mjs:244 真 explicit limitation 注释, 真 user 真 0 DM 期间 reactor 真 0 fire | ❌ **真 P1 漏洞** — settlement 真 long-running (5-30 min cross-chain confirmation), user 真 DM 间隔短, transition 真 fire 0 OR 1 次 (非全 8 keys) |
| **R21** | cross-chain-verify 真 RPC down OR timeout 真 fail handling | _verifyAndComplete:1098-1100 attempt < MAX_ATTEMPTS=3 retry 60s; 3 次 fail 真**0 grep** transition (代码 truncated, 不知是否 dispute OR stay verifying) | ⚠ Step 2 backlog — verify 真深 read 后续 |
| **R22** | underpayment / overpayment 真 detect? | cross-chain-verify.verifyCrossChainTx 真 expectedAmount 参数, 9 chain 真 verify amount === expected (1% slippage tolerance? 真 grep verify) | ⚠ Step 2 backlog |
| **R23** | 转错地址 (taker 真转 USDT 给非 broker) 真 detect? | verifyCrossChainTx.expectedTo 真 check, _verifyAndComplete:761-768 真 receive_address vs accepted_chains 真区分 (kaspa_tx vs cross_chain_tx) | ✓ 真 enforce, 但 5/4 真 evidence 0 e2e |
| **R24** | 转错 chain (taker 真选 BSC 真转 ETH) 真 detect? | handleExchangePaid:1030 真 chain=offer.taker_chain || msg.payment_chain — taker_chain 真 accept 时 fix, paid_v1 真不能改 chain | ✓ chain immutable after accept |
| **R25** | multi-instance race (broker 真 2 process 同时 _verifyAndComplete 真 double sendKaspa)? | Direct SQL UPDATE (UNIQUE delivery_tx not enforced) + transition() 真 ALLOWED_TRANSITIONS guard, 但 verify→delivering→completed 真 sequence 真 OK 同时 fire 2 次? Phase 1 stress S9 真 fund_lock leak fix 真 evidence | ⚠ Step 2 backlog — invariant test 真 verify (T3.6 ship 真 cover 部分) |
| **R26** | dm_kas_delivered enqueue 真 fire timing (broadcast 真 confirm 后 OR sendKaspa 后)? | exchange-machine.js:1038-1048 真 fire 在 sendKaspa + broadcast 都 success 后 (deliveredBcastTxId 真有), 真 timing OK | ✓ |

### Dimension E: State ownership (KI-20) — 5 violation 真深 sediment + fix 路径

**5 KI-20 violation candidates 真深 sediment** (Stage 3 Dimension E grep 真出, Stage 4 真深):

| # | violation | 真 fix 路径 | LOC | chain protocol message | Phase 3 priority |
|---|-----------|-----------|-----|----------------------|-----------------|
| **V1** | `api/exchange.js:48` sweepExpired (cron, open → expired) 不 emit chain TX | 真 cron tick 时 broker emit `kanet_exchange_expire_v1` chain TX, trade-protocol-filter 真 ingest 写 expired | ~30 LOC + new message handler ~50 | NEW: `kanet_exchange_expire_v1` (现 0 定义) | **P2** — sweep 真 broker 内部, taker 真不需要知道 (除非 taker 真 hold UI dashboard) |
| **V2** | `api/exchange.js:782` POST /api/exchange/resolve admin override (maker_wins/taker_wins) | endpoint 真 admin 触发 → emit `kanet_exchange_resolve_v1` chain TX → trade-protocol-filter handleExchangeResolve ingest 真 SET | ~40 LOC (endpoint emit + new handler) | EXISTING: `kanet_exchange_resolve_v1` (现 stub OR full?) — 5/4 grep 真 verify 找 EXCHANGE_MSG.RESOLVE constant 真在 line 367-374, 真 handler 真 line 76 truthy dispatch | **P1** — dispute 救生路径关键, 真应 chain TX 留痕 (跨 node 同步) |
| **V3** | `broker-intake-watcher.js:298` broker buy 真 timed_out 不 emit cancel_v1 | broker emit `kanet_exchange_cancel_v1` chain TX (现 message exists, EXCHANGE_MSG.CANCEL line 367), trade-protocol-filter handleExchangeCancel 真 ingest set | ~10 LOC (broker-intake-watcher emit cancel + remove direct SQL) | EXISTING: `kanet_exchange_cancel_v1` | **P1** — broker buy 路径真 user-facing, taker pool 真应 chain TX 通知 |
| **V4** | `broker-state-authority.js:440` refund 后 → refunded SET (chain-after-set 半守) | refund chain TX (USDT/KAS refund) 已 emit → emit `kanet_exchange_refunded_v1` 真 protocol message → trade-protocol-filter handleExchangeRefunded ingest set | ~30 LOC (new message + handler) | NEW: `kanet_exchange_refunded_v1` | **P2** — refund 真 chain TX 已留痕, protocol_status='refunded' 真 derived 半 OK, 严守 KI-20 改 ingest 真 nice-to-have |
| **V5** | `exchange-machine.js:679` reopen (matched → open on accept timeout) 真触发 timeoutVerifying 内部 SET, 不 emit | 真 timeoutVerifying 真 emit `kanet_exchange_timeout_v1` chain TX (现 message exists), trade-protocol-filter handleExchangeTimeout 真 ingest 已存 (line 1090-1119, 真 SET matched→open) | ~5 LOC (timeoutVerifying 真 emit, remove direct SET) | EXISTING: `kanet_exchange_timeout_v1` | **P0** — handleExchangeTimeout 真 reopen 路径已 chain-first 真 ingest, exchange-machine.js:679 真 duplicate 旁路, 修法仅 remove direct SET 让 handler 真 sole writer |

**真累计 fix 路径 LOC 估**: ~115 LOC (V1 +30 / V2 +40 / V3 +10 / V4 +30 / V5 +5) — Phase 3 P0+P1 真 ship ~55 LOC (V5+V3+V2), V1+V4 P2 defer.

**真 KI-20 严守目标**: 7 SQL writers → 2 (仅 trade-protocol-filter handleExchange* 真 chain ingest writer). 真 ship 后 KI-20 严守率 2/2 = 100%.

### Dimension F: 健康监控 (KI-16)

```
真 monitor:
  - settlement happy-path latency: matched→completed 真 5-30 min (cross-chain 15-35 conf 真等)
  - cross-chain-verify RPC 真 health (BSC/ETH/Polygon/SOL/TRON RPC reachability)
  - sendKaspa 真 success rate (3 attempt × 10s retry)
  - delivered_v1 broadcast 真 success rate (5 attempt 200ms backoff)
  - hedge 真 placed/failed/skipped rate (circuit breaker 1h ≥3 fail)
  - dm_kas_delivered 真 enqueue/fired rate (broker-action-queue worker)

agent-health.js Stage 4 真 cover:
  - matcher reactor 真 fire 率 (T3.2 reactToChainEvents 真 active offer count) — 部分 cover
  - notifyTransition 真 fire 率 (8 keys 真 fire count, events 表 telemetry?) — **真盲区** (T3.5 ship 0 telemetry)
  - cross-chain-verify 真 confirmation latency — 真盲区
  - dispute resolve 真 latency — 真盲区

真盲区:
  - 单笔 settlement 真 e2e latency (publish→completed 真 wall clock)
  - per-stage 失败原因分布 (verify fail / sendKaspa fail / broadcast fail / dispute trigger)
  - 多 instance race 真 detection (UNIQUE constraint 真 catch, 但 telemetry 0)
  - hedge 真 PnL tracking (executed 真 price vs offer 真 price 真 slippage)
```

= alive OK (T3 ship 真 infrastructure 全), functioning 真盲区 settlement latency / per-stage 失败 reason / hedge PnL — Phase 3 candidate.

### Dimension G: 用户体验 (KI-17 + KI-18) — notifyTransition 8 keys 真 fire verify

**T3.5 notifyTransition 真 8 transition keys** (matcher.mjs:188-197):

| key | 真 message | 真 fire 路径 | 真 e2e fire? |
|-----|-----------|-----------|-------------|
| `open→matched` | '✓ 已匹配 taker, 等付款 (30 分钟内).' | matcher reactor 真 fetch ACTIVE_STATES detect transition | ❌ **0 自动 fire** (R16 P0) |
| `matched→verifying` | '💰 付款已收到, 验证跨链确认中...' | 同上 | ❌ 0 自动 fire |
| `verifying→delivering` | '✓ 付款验证通过, 发 KAS 中...' | 同上 | ❌ 0 自动 fire |
| `delivering→completed` | '🎉 KAS 已发出, 交易完成! 请查询钱包确认收款.' | 同上 — 但 completed NOT in ACTIVE_STATES, reactor 真 stop tracking | ❌ 0 自动 fire (R20 P1) |
| `open→timed_out` | '⏰ 30 分钟无 taker, 订单已 timeout. 退款已发.' | 同上 | ❌ 0 自动 fire |
| `matched→disputed` | '⚠ 争议产生, 进入 dispute 流程. 等 resolver.' | 同上 | ❌ 0 自动 fire |
| `verifying→disputed` | '⚠ 跨链验证争议, 进入 dispute 流程. 等 resolver.' | 同上 | ❌ 0 自动 fire |
| `matched→cancelled` | '⊘ 订单已取消.' | 同上 | ❌ 0 自动 fire |

**真 stripMarkdown 真 apply** (line 204): ✓ 真 enforce KI-18 平台无关.

**真含 chain TX hash**: ✗ 8 message 真 0 含 TX hash. 真 dm_kas_delivered (broker-action-queue line 1044) 真含 explorer URL ('查看: https://explorer.kaspa.org/txs/{deliveryTxId}'), 但**这是 broker-action-queue 真 fire**, **不是** matcher.notifyTransition 真 fire. 真**两套 user-facing 通知系统**:
1. matcher.notifyTransition (8 keys, 0 TX hash, 真 fire 率极低 R16+R20)
2. broker-action-queue dm_kas_delivered (1 key, 含 TX hash + explorer URL, 真 fire 在 _verifyAndComplete completed 时, **server-side 真 reliable**)

**真 P0/P1 状态** (NWT r180 multi-path verify 真反转 — R16+R20 partial false alarm):

**真 server-side broker-action-queue 已 cover 5/8 transition** (议 B1 Owner 19:55 钦定 lifecycle, exchange-machine.js:126-166 transition() body):

| transition | server-side cover (broker-action-queue.enqueue) | matcher.notifyTransition (T3.5 client-side) |
|-----------|-----------------------------------------------|---------------------------------------------|
| open → matched | ❌ 0 cover | reactor (limitation) |
| matched → verifying | ⚠ BUY 路径 dm_order_confirmed cover (broker-buy-handler.js:929/1101); SELL 路径 0 cover | reactor |
| verifying → delivering | ✅ dm_payment_verified (line 132) | reactor |
| delivering → completed | ✅ dm_complete (line 135) + dm_kas_delivered (line 1041 _verifyAndComplete) 双重 | reactor |
| open → timed_out | ✅ dm_timeout (line 138) | reactor |
| matched → disputed | ✅ dm_failed (含 underpayment educate, line 143-155) | reactor |
| verifying → disputed | ✅ dm_failed (同上) | reactor |
| matched → cancelled | ❌ 0 cover | reactor |

- L1 识别 (Stage 2 完): OK
- L2 对接 (Stage 3 完): broken (publish 0 fire 卡)
- **L3 反馈** (Stage 4): **partial false alarm** — server-side 真 reliable 5/8 cover, 真 matcher.notifyTransition 真 redundant 但 0 harm. **真 gap 3 transition** (open→matched / matched→cancelled / SELL matched→verifying) — Step 2 backlog **降 P1**

**真 silent fail telemetry**: 0 events 表 telemetry 真 catch matcher.notifyTransition 真 fire/skip — Phase 3 candidate (跟 M-3 publish telemetry 同款 pattern).

**真 markdown leak 在 transition reply**: 真 e2e 0 跑通无 evidence, 但 message string 真**0 markdown** (无 ** / ## / [] 真 syntax). Brain freestyle 真 leak 真 Stage 2 问题 (Stage 4 真**不**经 Brain, 真 actionExecutor.executeOne 真 send_message direct).

### Dimension H: Sanity check (KI-24)

```
Stage 4 真 sanity:
  ✓ payment_tx UNIQUE constraint (handleExchangePaid:988 + processPaymentSubmit:728-734 belt-and-suspenders)
  ✓ payment_tx reuse 防御 (Q3 audit fix 2026-04-14, 真 application + DB 双层守)
  ✓ status guard (matched/verifying/delivering/etc 真 transition guard ALLOWED_TRANSITIONS)
  ✓ 9 chain confirmation requirement (REQUIRED_CONFIRMATIONS 真 enforce)
  ✓ TERMINAL_AFTER_DISPUTE check (handleExchangeDispute:1143 防 completed/cancelled/timed_out 真 dispute)
  ✓ NO TX NO STATE CHANGE (delivery 真 sendKaspa 成功 + broadcast 成功才 mark completed, line 976-984 stay in delivering on broadcast fail)
  ✓ DEX broker is_dex_broker=1 真 skip auto-pay (非托管门控, line 696-706)
  ✓ hedge_enabled=true opt-in safety (line 836-848 默认 false)
  ✓ hedge circuit breaker 1h ≥3 fail (line 859-867)
  ✓ idempotent dispute (line 1139-1142 真 disputed skip)
  ✓ retail_dex_orders SELECT specific row id 防多 row advance (J2 2e5a926a self-review fix v2)

Stage 4 真薄:
  ✗ matcher.notifyTransition 真**0 silent fail telemetry** (R16+R20 真盲区)
  ✗ _makerAutoPayGive **0 implementation** (R19 真 BUY 路径真断, 5/4 e2e 真**未 detect** 因 publish 0 fire 卡更早)
  ✗ underpayment/overpayment slippage tolerance 真**未 grep verify** (R22)
  ✗ multi-instance race detection 真**0 telemetry** (R25 invariant test 真 cover 部分)
  ✗ matcher reactor 真 limitation per peer DM, NOT timer (R20 真 P1)

= Stage 4 真 sanity 厚 (T3 ship 真 invariant 守 + Q3 audit fix 真深) 但**真 user-facing 反馈 R19 + R16+R20** 真 broker 上线真痛点.
```

---

---

## 跨 stage 风险点 — race / silent / drift 全 picture

跨 stage 真 catalog (post NWT r180/r181 multi-path verify reconcile):

### 1. Race conditions — 跨 stage 真 timing

| # | race 场景 | 涉及 stage | 真 mitigation | 真 status |
|---|----------|----------|--------------|----------|
| **C1** | publish broadcast → 远程 trade-protocol-filter ingest → autoTaker setImmediate _evaluateAutoTake. 远程 ingest 时 publish broadcast 真 mempool, finality 未到 | Stage 3 → Stage 4 | trade-protocol-filter:448-450 setImmediate (NOT sync), idempotent INSERT OR IGNORE by (broadcast_tx_id, message_index) 真守 | ✓ idempotent OK, 但 finality race 真 backlog (autoTaker 真 fire 时 publish chain TX 仍 mempool 真 OK?) |
| **C2** | multi-broker race — 2 broker 同时收 publish + 同时 autoTaker accept (race acceptance) | Stage 3 → Stage 4 | exchange-machine.js machineAccept transition guard ('open' → 'matched/verifying'), 第二 broker accept 真 fail status check | ✓ state machine guard 守, 但 broadcast race 真 2 accept_v1 chain TX 都上链, 真 stage transition 决胜真 first observed |
| **C3** | broker timeout + taker paid race — broker timeoutVerifying 真 emit timeout_v1 期间 taker 真 broadcast paid_v1 | Stage 4 内部 | handleExchangeTimeout (line 1090) 真 status check `protocol_status === 'matched'` 真 reject 已 verifying; handleExchangePaid (line 945) Gate2 真 reject 已 timed_out | ✓ chain TX order 真 source-of-truth, 真先到先 win |
| **C4** | sendKaspa + delivered_v1 broadcast — KAS sent 但 broadcast 真 5 attempt 失败 | Stage 4 内部 | exchange-machine.js:976-984 真 stay in delivering NOT mark completed (NO TX NO STATE CHANGE 严守), 真 operator 真 retry | ✓ 严守, 但 user-facing 真 stuck DELIVERING 状态 (无主动 DM 通知 stuck) — Step 2 backlog |
| **C5** | spendFunds double — handleExchangeDelivered:1067 + _verifyAndComplete:1025 双重 spendFunds (Phase 1 stress test S9 真 fund_lock leak fix) | Stage 4 内部 | fund-lock.js spendFunds 真 idempotent (status='locked' → 'spent', 第二 call 真 0 effect) | ✓ 真 idempotent 守, S9 fix 真 verified |
| **C6** | maker cancel + taker accept race — maker emit cancel_v1 期间 taker emit accept_v1 | Stage 3 边界 | trade-protocol-filter handleExchange* state guard 真 first 写 win (open → matched OR open → cancelled, 真 state machine 真 ALLOWED_TRANSITIONS 真 reject 第二) | ✓ chain TX order 真 source, 但**真 user perceived race** (taker 真 accept 真上链, broker 真 cancel 真上链, 真 race winner 真 chain finality 真先 confirm 真) |
| **C7** | multi-instance broker — broker 真 2 process 同时跑 (kanet-start.sh 真**1 process** 但真 dev test 真 2) | 全 stage | chain TX order first-write-wins (C6 同款机制) + UNIQUE constraint (payment_tx / fund_locks order_id+asset) + state machine ALLOWED_TRANSITIONS guard | ✓ race 真 mitigation 守 (chain order primary), 真 telemetry audit gap (Step 2 backlog) |

### 2. Silent failures — 跨 stage 真 信息丢失

| # | silent 场景 | 涉及 stage | 真 telemetry | 真 status |
|---|----------|----------|-------------|----------|
| **S1** | Stage 2 cheap_gate fail-closed → Brain freestyle 填空 (5/4 ghost 真 root cause) | Stage 2 → 3 | M-1 telemetry events 表 'matcher_publish_decision' (5/4 ship 后真 trace) | ✓ 真 catch (M-1 ship 后), M-confidence-relax 真修通真 e2e |
| **S2** | matcher Stage 2 LLM SHOULD_PUBLISH ready=false → 同上 silent fallback | Stage 2 → 3 | M-1 telemetry 真 cover decision='llm_ready_false' + raw_reply_first_120 | ✓ 真 cover |
| **S3** | matcher.publishOffer throw → intent._publishError | Stage 3 内部 | M-3 telemetry 'publish_offer_failed' 5/4 ship | ✓ 真 cover |
| **S4** | endpoint EVM 余额预校验 silent skip on timeout (R15) | Stage 3 | exchange.js:235-237 `console.log(...non-fatal: ${e.message})`, 0 events 表 telemetry | ❌ 真 P1 漏洞 — broker USDT 不够仍 publish, SELL 失败 user 已转 KAS |
| **S5** | matcher reactor (T3.2) per peer DM limitation — broker 0 user 真 DM 期间 0 fire | Stage 4 | 真 0 telemetry | ⚠ 但 broker-action-queue server-side cover 5/8 transition 真 reliable, 真 redundant 0 harm |
| **S6** | matcher.notifyTransition 真 fire/skip 0 telemetry (R16 残 gap) | Stage 4 | 真 0 telemetry (T3.5 ship 0 事件) | ⚠ 真 server-side 真 cover, matcher T3.5 真 redundant — 但 silent fail 真 0 trace |
| **S7** | _verifyAndComplete RPC down → attempt < 3 retry 60s, 之后真 dispute? 真 stay verifying? (R21 真 backlog) | Stage 4 | 真 0 grep evidence (代码 truncated 后续) | ⚠ Step 2 backlog deep read |
| **S8** | underpayment/overpayment 真 detect → dispute path 真 educate user (exchange-machine.js:146-152 真 verified, 真 cover) | Stage 4 | dm_failed kind 真 cover | ✓ 真 verified |
| **S9** | hedge 真 placed/failed/skipped (3 chain_event types 真 cover) | Stage 4 后 | recordChainEvent 真 cover | ✓ 真 cover |
| **S10** | dispute resolve admin override (api/exchange.js:782) 真 chain TX 真 emit OR direct SET? | Stage 4 边界 | KI-20 V2 violation candidate, 真 0 chain TX 跨 node 同步 | ⚠ Step 2 backlog (V2 fix) |

### 3. Drift candidates — 跨 stage 真 state divergence

| # | drift 场景 | 涉及 stage | 真 evidence | 真 status |
|---|----------|----------|------------|----------|
| **D1** | 5 KI-20 violation (V1-V5, Stage 3 Dimension E grep verify): direct SQL UPDATE protocol_status 真不经 chain ingest | 全 stage | 7 SQL writers, 5 violation candidates (V1 sweep / V2 admin resolve / V3 broker timed_out / V4 refund / V5 reopen) | ⚠ Step 2 backlog ~115 LOC fix (V5+V3+V2 P0/P1 ~55 LOC, V1+V4 P2 defer) |
| **D2** | chain TX mempool vs finality drift — broadcast 真返 txId = mempool, finality 真后续 trade-protocol-filter ingest 真 verify | 全 stage (publish/accept/paid/delivered) | T3.4 deriveProtocolStatus + verifyProtocolStatusConsistency 5/4 evidence: dbStatus='expired' vs derivedStatus='open' | ✓ T3.4 ship 真 catch helper, 但 0 alert (operator 真 read-only verify) |
| **D3** | exchange_offers.protocol_status vs replay-from-chain (deriveProtocolStatus T3.4) drift | Stage 3+4 | 真 5/4 evidence dbStatus='expired' vs derivedStatus='open' (deriveProtocolStatus return mismatch) | ⚠ Step 2 backlog — auto-reconcile cron OR alert |
| **D4** | retail_dex_orders.state vs exchange_offers.protocol_status drift (D2 link 真 broker SELL_KAS path) | Stage 4 (D2 lifecycle) | exchange-machine.js:855 + 1011 真 SELECT specific row id 防多 row advance (J2 2e5a926a self-review fix v2) | ✓ 真 fix verified, but 真 telemetry 0 |
| **D5** | fund_locks.status (locked/spent/released) vs exchange_offers.protocol_status drift | Stage 3+4 | UNIQUE(order_id, asset) 真守, S9 stress test fix 真 cover; fund-lock.js spendFunds idempotent | ✓ 真 守, 但 telemetry 0 |
| **D6** | handleExchangeDelivered direct SQL UPDATE (line 1058-1061) 真绕过 transition() ALLOWED_TRANSITIONS guard (R17) | Stage 4 | 真 chain-after-set 半守, 真 buyer node state 真不 match seller machine sequence | ⚠ Step 2 backlog — semantic intentional 但 KI-20 严格 violation |
| **D7** | broker-state-authority.js:440 refunded SET (chain-after-set 半守 V4) | Stage 4 | refund TX 上链后 SET, 真不 emit refunded_v1 chain TX | ⚠ V4 fix backlog ~30 LOC (估算, post Step 3 P0 ship 后 detailed scope) |
| **D8** | matcher reactor (T3.2) Skill-instance limitation — peer DM 真不 trigger 期间 active offer 真 stale | Stage 4 | 真 redundant w/ broker-action-queue server-side cover, 真 0 harm | ✓ 0 critical drift |

### 4. 真整体 picture — 4 cross-cutting principle 真 cross-ref evidence

```
KANet 真 broker 4 stage 真 cross-cutting picture:

  Stage 1 (handshake)          Stage 2 (intent)            Stage 3 (publish)             Stage 4 (settlement)
  ───────────────────          ──────────────────          ──────────────────────         ──────────────────────
  ✓ 5 P0 fix shipped 5/4       ⚠ R1+R5 P0 stranger DM     ⚠ R9 partial (matcher 薄)    ✓ R19 false alarm (NWT verify)
  ✓ outer catch telemetry      ✓ M-1/M-3 telemetry        ✓ endpoint 厚 sanity         ✓ R16+R20 partial (server-side 5/8)
                               ✓ M-confidence-relax       ✓ chain-first publish        ⚠ 5 KI-20 violation
                                 (cheap_gate b1 修)        ✓ 5 attempt broadcast retry  ⚠ 3 transition gap server-side
                                                                                        ✓ S9 fund_lock leak fix
                                                                                        ✓ NO TX NO STATE CHANGE 严守
```

**4 cross-cutting principle (post NWT r182 Note #1 真 cross-ref evidence)**:

| principle | evidence (cross-ref 24 risk identifier) |
|----------|----------------------------------------|
| **(1) chain-first publish path 真 KI-20 严守** (broadcast → INSERT, NOT direct SET) | C1 publish→ingest race idempotent INSERT OR IGNORE 守; D2 mempool/finality drift T3.4 deriveProtocolStatus catch helper; D4 retail_dex_orders.state vs protocol_status (J2 2e5a926a fix 守) |
| **(2) server-side broker-action-queue 真 reliable 5/8 transition feedback** (议 B1 lifecycle Owner 19:55 钦定) | S5 matcher reactor per-peer-DM limitation 0 telemetry — server-side cover 5/8 真 redundant 0 harm; S6 matcher.notifyTransition 0 telemetry — 同 server-side cover; D8 matcher reactor Skill-instance limitation 0 critical drift |
| **(3) matcher client-side redundant 但 0 harm** (Skill API limitation per peer DM, NOT timer) | R16+R20 partial false alarm (server-side cover 5/8); D8 matcher reactor 真 redundant but 0 harm; T3.2/T3.5 ship 真 cover 但 server-side 真 master |
| **(4) 三层守 (state machine ALLOWED_TRANSITIONS + UNIQUE constraint + idempotent ingest)** | C2 multi-broker accept race state guard 守; C5 spendFunds double idempotent (S9 stress test verified); C6 maker cancel + taker accept race chain TX order first-write-wins; D5 fund_locks.status UNIQUE 守 |
| settlement long-running (5-30 min cross-chain) | S7 RPC down attempt < 3 retry 60s backlog; user-facing 反馈 server-side 主导 (议 B1 4 lifecycle DM kind) |

**真 P0 hunt 真 narrow 集中** (post NWT r180/r181/r182 verify):
- R1+R5 stranger DM no reputation gate (publish 路径 0 防御) — Step 3 ship priority
- 其余 8+ P1 真 backlog finalize Step 2

**KI-29 复刻教训 sediment** (架构层留痕, 不 ship):
- architect 5/4 自 sediment KI-29 反模式 (multi-path grep 必 cross-verify)
- J2 5/4 R19 误判真复刻 (单 grep 0 row → 0 implementation)
- NWT r180 reverse + r181 per-P0 PASS + r182 Step 1 CLOSE
- chain trace 真完整 (J2 r143 + NWT r180/r181/r182), 入 INVARIANTS v0.3 sediment 候补 (§1.4 surface area 扩 + §2.2 meta-invariant case study)

---

---

## 接位 SOP

J2 真按 architect task 卡 5 step 严守:
1. ✅ Step 1 Stage 1 真 sediment (本节, reference 模板)
2. 待 Owner ack 模板 OK → 进 Stage 2 真 sediment
3. Stage 2 done → Stage 3
4. Stage 3 done → Stage 4
5. Stage 4 done → 跨 stage 风险点
6. Step 1 整体 done → broadcast NWT review → 进 Step 2 漏洞清单

**严守 KI-28**: 真 ship close 4 必要条件 — source tests + 真 e2e + telemetry + 漏洞清单 全过. Step 1 是 build foundation, 不是 close。
