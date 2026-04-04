# KANet Ingest 链路审计

> 2026-04-04。从代码实际读取，不含推断。

---

## 链路 A: 实时 comm 消息

```
链上 TX（comm self-send）
  ↓
rpc-listener.mjs:330  handleBlock(event)
  → classifyPayload(payloadHex) → 'comm'
  → extractSender(tx)
      输入: tx.inputs[].verboseData.scriptPublicKeyAddress（排除自己）
      输出: tx.outputs[].verboseData.scriptPublicKeyAddress（排除自己）
      comm 是 self-send → extractSender 通常返回 null（所有地址都是自己的）
  ↓
rpc-listener.mjs:354  processComm(txId, payloadHex, senderAddress)
  → 解码 payload: Buffer.from(hex,'hex').toString('utf-8')
  → 提取 alias 和 encodedContent: "ciph_msg:1:comm:{alias}:{base64}"
  → decrypt(encodedContent, _myPrivateKeyHex)
      失败 → return（不是发给我的，正常跳过）
      成功 → 继续
  ↓
rpc-listener.mjs:468  if (!senderAddress) senderAddress = await findAddressByAlias(alias)
  → findAddressByAlias (rpc-listener.mjs:657):
      GET /api/conversations?limit=100
      遍历 conversations 的 remote_address
      对每个地址 deriveAliases(_myPrivateKeyHex, addr)
      匹配 theirAlias === alias → 返回地址
      全不匹配 → 返回 null
  ↓
rpc-listener.mjs:478  self-send 检查:
  senderAddress === _myAddress → 跳过
  senderAddress === null && plaintext.startsWith('bcast:') → 跳过
  ↓
rpc-listener.mjs:506  ingestMessage({
    traceId: txId,
    localAddress: _myAddress,            ← Martin 的地址
    remoteAddress: senderAddress || 'unknown',  ← findAddressByAlias 的结果（可能是 null → 'unknown'）
    txid: txId,
    message: plaintext,                  ← 解密后的明文
    messageType: _msgType,               ← 'text' 或 'query_card'
  })
  ↓
ingest.mjs:48  POST /ingest/message  body = {
    traceId, network: 'mainnet', direction: 'inbound',
    localAddress, remoteAddress, txid,
    messageType, contentText: message     ← 注意字段名映射: message → contentText
  }
  ↓
ingest-service.js:42  ensureConversation(network, localAddress, remoteAddress, traceId)
  → ensureIdentity(network, localAddress, 'local') → localId (Martin 的 identity UUID)
  → remoteAddress 有值? → ensureIdentity(network, remoteAddress) → remoteId
  → remoteAddress 为 null/'unknown'? → remoteId 为 null 或创建 'unknown' identity
  ↓
conversations.js:8  upsertConversation({ localIdentityId, remoteIdentityId })
  → SQL: WHERE local_identity_id=? AND (remote_identity_id=? OR (remote_identity_id IS NULL AND ? IS NULL))
  → 匹配: 需要 localId + remoteId 都匹配
  → 不匹配: 创建新 conversation
  ↓
ingest-service.js:50  insertMessage({
    conversationId: convId,
    senderIdentityId: remoteId,     ← direction='inbound' 时 sender=remote
    receiverIdentityId: localId,
    messageType, contentText,       ← 来自 POST body
  })
  ↓
ingest-service.js:66  recordChainEvent({
    txid, eventType: 'text',
    fromAddress: remoteAddress,     ← direction='inbound' → from=remote
    toAddress: localAddress,
  })
  ↓
ingest-service.js:91  confirmSession(localAddress, remoteAddress)  ← relation_states 推进
                      activateRelation(localAddress, remoteAddress)
  （如果 remoteAddress 是 null/'unknown' → 这两个调用会静默失败，不推进状态）
  ↓
rpc-listener.mjs:517  replyToMessage(txId, senderAddress, plaintext)
  → getAIReply(senderAddress, plaintext, txId)
  → sendMessage({ address: senderAddress, message: replyText })
  → sendKaspa(...)
  → ingestMessage(outbound) + ingestReply(...)
```

**关键：remoteAddress 的来源是 `findAddressByAlias`，不是 `relation_states`。如果 alias 查不到，remoteAddress = 'unknown'，整条链路后面全部断裂。**

---

## 链路 B: 实时 handshake

```
链上 TX（handshake，发给 Martin 地址）
  ↓
rpc-listener.mjs:330  handleBlock(event)
  → classifyPayload → 'handshake'
  → isToUs(tx) → true（output 有 Martin 地址）
  → extractSender(tx) → 发送方地址（从 inputs 提取）
  ↓
rpc-listener.mjs:353  processHandshake(txId, payloadHex, senderAddress)
  → decrypt(payloadHex, _myPrivateKeyHex) → { alias }
  → senderAddress 已知（handshake 不是 self-send，extractSender 正常工作）
  ↓
rpc-listener.mjs:379  ingestTx({ traceId: txId, txid: txId, direction: 'inbound' })
  ↓
rpc-listener.mjs:395  DEDUP: 查 relation_states
  GET /api/relation/status?local={Martin}&peer={sender}
  → status = 'accepted'/'active'/'confirmed' → 跳过
  → status = 'observed' 或不存在 → 继续
  ↓
rpc-listener.mjs:408  acceptHandshake({ address: senderAddress })
  → 构造回复 handshake payload
  → sendKaspa({ to: sender, amount: 0.2, payload })
  ↓
rpc-listener.mjs:412  ingestTx({ txid: sentTxId, direction: 'outbound' })
  ↓
rpc-listener.mjs:415  ingestHandshake({ localAddress: _myAddress, remoteAddress: senderAddress, txid: sentTxId })
  → POST /ingest/message body = {
      traceId: 'handshake-out:{sentTxId}',
      direction: 'outbound',
      localAddress: Martin,
      remoteAddress: senderAddress,    ← 确定的地址
      messageType: 'handshake',
      contentText: '',
    }
  → POST /ingest/event (handshake_accepted)
  ↓
ingest-service.js:42  ensureConversation(network, localAddress, remoteAddress)
  → localId = Martin identity UUID
  → remoteId = sender identity UUID（ensureIdentity 创建或找到）
  → upsertConversation → 找到或创建 conversation（有 remote）
  ↓
ingest-service.js:78  observeHandshake(localAddress, remoteAddress, txid)
  → relation_states: 创建或更新为 'observed'
  （注意：outbound handshake 调的是 ingestHandshake，
    inbound handshake 是 Scout 通过 /ingest/message 写入，
    ingest-service.js:82 只在 direction='inbound' 时调 observeHandshake）
```

**关键：handshake 的 senderAddress 来自 extractSender（从 TX inputs 提取），不依赖 alias。链路完整。**

---

## 链路 C: Relay catch-up（现有）

```
Relay 启动
  ↓
rpc-listener.mjs:144  catchUpHistory()
  ↓
=== Step 1: 待接受的握手 ===
  GET /ingest/pending-handshakes?address={Martin}
  ↓
catchup-service.js:13  getPendingHandshakes()
  → SQL: SELECT FROM relation_states WHERE status = 'observed'
  → 返回: [{ remoteAddress, txid, traceId, receivedAt }]
  → 数据源: relation_states（唯一真相源 ✓）
  ↓
rpc-listener.mjs:186  对每条:
  acceptHandshake → sendKaspa → ingestTx + ingestHandshake
  → 走链路 B 的后半段
  ↓
=== Step 2: 未回复的消息 ===
  GET /ingest/unreplied-messages?network=mainnet&limit=20
  ↓
catchup-service.js:34  getUnrepliedMessages()
  → SQL: SELECT FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         JOIN identities ri ON ri.id = c.remote_identity_id
         JOIN identities li ON li.id = c.local_identity_id
         WHERE m.direction = 'inbound'
           AND m.message_type = 'text'
           AND NOT EXISTS (SELECT 1 FROM replies WHERE trace_id = m.trace_id)
  → 返回: [{ remoteAddress, localAddress, txid, traceId, message, receivedAt }]
  → 数据源: messages + conversations + identities（不直接读 relation_states）
  → 依赖: conversation 必须有 remote_identity_id（JOIN 不允许 NULL）
  ↓
rpc-listener.mjs:225  对每条:
  replyToMessage(traceId, remoteAddress, message)
  → 走链路 A 的 replyToMessage 部分
```

**关键：Step 1 读 relation_states（正确）。Step 2 读 messages + conversations（间接依赖 identity 关联正确）。如果 conversation 的 remote_identity_id 为 NULL（链路 A 断裂时），这条消息在 catch-up Step 2 中也找不到。**

---

## 链路 D: 数据表关系

```
relation_states                     conversations                      messages
─────────────                       ─────────────                      ────────
local_address  ←──(address)──→  identities.id = local_identity_id     conversation_id → conversations.id
peer_address   ←──(address)──→  identities.id = remote_identity_id    sender_identity_id → identities.id
status                          status                                 receiver_identity_id → identities.id
trust_level                     last_message_at                        source_txid
handshake_observed_at           last_reply_at                          content_text
handshake_accepted_at           unread_count                           message_type

关联路径:
  relation_states.local_address
    → identities WHERE address = local_address → identity.id
    → conversations WHERE local_identity_id = identity.id

  relation_states.peer_address
    → identities WHERE address = peer_address → identity.id
    → conversations WHERE remote_identity_id = identity.id

identities 的作用:
  地址(string) ↔ UUID(identity_id) 的映射层
  conversations 和 messages 用 UUID 关联
  relation_states 用地址关联
  identities 是桥梁

messages 通过 conversation_id 关联到 conversation
  conversation 通过 local_identity_id + remote_identity_id 关联到 identities
  identities 通过 address 关联到 relation_states

完整关联链:
  messages → conversations → identities → relation_states
     ↑                          ↑
     conversation_id        local_identity_id + remote_identity_id
```

---

## 断裂点总结

| # | 位置 | 描述 | 根因 |
|---|------|------|------|
| 1 | 链路 A: processComm | comm 是 self-send，extractSender 返回 null | 协议设计：comm TX 所有地址都是发送方自己的 |
| 2 | 链路 A: findAddressByAlias | 遍历 conversations 的 remote_address 暴力匹配 alias | 性能差且不可靠：新联系人可能不在 conversations 里 |
| 3 | 链路 A: ingestMessage | remoteAddress='unknown' 时创建孤立 conversation | ensureConversation 不查 relation_states |
| 4 | catch-up Step 2 | JOIN conversations.remote_identity_id → 跳过 NULL remote 的消息 | 链路 A 断裂的下游影响 |

**断裂 1 是根因，2/3/4 是连锁反应。**

---

## 现有链路中 relation_states 的读写点

| 操作 | 文件:行 | 读/写 |
|------|---------|-------|
| handshake 去重 | rpc-listener.mjs:397 | 读 relation_states |
| catch-up 待接受握手 | catchup-service.js:14 | 读 relation_states (status='observed') |
| inbound handshake | ingest-service.js:83 | 写 observeHandshake() |
| text message | ingest-service.js:93 | 写 confirmSession() + activateRelation() |
| contacts/list UI | conversations.js:373 | 读 relation_states |
| Mind context | context-builder.mjs | 读 relation_states |
| anti-spam | anti-spam.js | 读 relation_states |
| Gate 1 | mind-manager.js | 读 relation_states |

**不读 relation_states 的关键位置:**
- `findAddressByAlias` — 遍历 conversations，不查 relation_states
- `ensureConversation` — 只用 identity_id，不查 relation_states
- `processComm` 的 sender 解析 — 不查 relation_states
