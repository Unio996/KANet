import { upsertIdentity, getIdentityByAddress } from '../data/settings/identities.js';
import { upsertConversation, updateConversationTimestamps, incrementUnread } from '../data/state/conversations.js';
import { insertMessage, findMessageByTraceId, linkMessageToConversation } from '../data/state/messages.js';
import { insertReply, findReplyByTraceId } from '../data/state/replies.js';
import { upsertTxRecord } from '../data/state/tx-records.js';
import { insertEvent } from '../data/state/events.js';
// account_relations 双写已切断 (v31, 2026-03-27) — relation_states 是唯一真相源
import { observeHandshake, acceptHandshake, confirmSession, activateRelation } from './relation-state.js';
import { recordChainEvent } from './chain-event.js';
import { nowIso } from '../lib/time.js';
import { sqlite } from '../db/client.js';

async function ensureIdentity(network, address, type = 'remote') {
  return upsertIdentity({ network, address, identityType: type });
}

async function ensureConversation(network, localAddress, remoteAddress, traceId) {
  const localId = await ensureIdentity(network, localAddress, 'local');
  const remoteId = remoteAddress ? await ensureIdentity(network, remoteAddress) : null;
  return upsertConversation({ network, localIdentityId: localId, remoteIdentityId: remoteId, traceId });
}

export async function handleIngestMessage(payload) {
  const { traceId, network = 'mainnet', direction, localAddress, remoteAddress, channelType = 'dm', channelId = null, sourceMessageId = null, txid = null, messageType = 'text', contentText = '', contentJson = null, rawPayload = null, timestamp } = payload;

  // Dedup 1: skip if this traceId was already ingested
  if (traceId) {
    const existing = await findMessageByTraceId(traceId);
    if (existing) return { msgId: existing.id, convId: existing.conversation_id, duplicate: true };
  }

  // Dedup 2: for handshakes, skip if this txid base already has a message
  // (Relay sends "handshake-in:{txid}" + "handshake-out:{txid}", Scout sends raw txid — same event, 3 traceIds)
  if (txid && messageType === 'handshake') {
    const baseTxid = txid.replace(/-accept$/, '');
    const existingByTx = sqlite.prepare(
      "SELECT id, conversation_id FROM messages WHERE source_txid IN (?, ?, ?) AND message_type = 'handshake' AND direction = ? LIMIT 1"
    ).get(baseTxid, `${baseTxid}-accept`, txid, direction);
    if (existingByTx) return { msgId: existingByTx.id, convId: existingByTx.conversation_id, duplicate: true };
  }

  const convId = await ensureConversation(network, localAddress, remoteAddress, traceId);

  // resolve identity IDs for sender/receiver
  const localId = await ensureIdentity(network, localAddress, 'local');
  const remoteId = remoteAddress ? await ensureIdentity(network, remoteAddress) : null;
  const senderId = direction === 'inbound' ? remoteId : localId;
  const receiverId = direction === 'inbound' ? localId : remoteId;

  const msgId = await insertMessage({
    traceId, conversationId: convId,
    sourceMessageId, sourceTxid: txid,
    direction, senderIdentityId: senderId, receiverIdentityId: receiverId,
    messageType, contentText,
    contentJson, rawPayload,
    receivedAt: timestamp || nowIso(),
  });

  await updateConversationTimestamps(convId, { lastMessageAt: timestamp || nowIso() });
  if (direction === 'inbound') await incrementUnread(convId);

  // 链上事实归档（有 txid 的消息才记录）
  if (txid) {
    const fromAddr = direction === 'inbound' ? remoteAddress : localAddress;
    const toAddr = direction === 'inbound' ? localAddress : remoteAddress;
    recordChainEvent({
      txid, eventType: messageType, fromAddress: fromAddr, toAddress: toAddr,
      observedBy: 'relay', observedAt: timestamp || nowIso(),
    });
  }

  // Update last_seen_at on remote identity (so network overview shows recent activity)
  if (remoteId) {
    sqlite.prepare('UPDATE identities SET last_seen_at = ?, interaction_count = interaction_count + 1, updated_at = ? WHERE id = ?')
      .run(timestamp || nowIso(), nowIso(), remoteId);
  }

  // Handshake → 写入 relation_states（唯一真相源）
  if (messageType === 'handshake' && localAddress && remoteAddress) {
    try {
      if (direction === 'inbound') {
        observeHandshake(localAddress, remoteAddress, txid, timestamp || nowIso());
      } else if (direction === 'outbound') {
        acceptHandshake(localAddress, remoteAddress);
      }
    } catch (err) {
      console.log(`[ingest] relation_states update failed: ${err.message}`);
    }
  }

  // Comm 消息 → 推进 relation_states（accepted → confirmed → active）
  if (messageType === 'text' && localAddress && remoteAddress) {
    try {
      confirmSession(localAddress, remoteAddress);  // accepted → confirmed
      activateRelation(localAddress, remoteAddress); // confirmed → active
    } catch (err) {
      // 静默：可能没有对应的 relation_states 记录（非 Kasia 通信）
    }
  }

  // Activity log: NOT written to events table — handshakes/messages/broadcasts
  // already have their own tables. Activity log page queries source tables directly.

  // Try to link any orphan replies with same traceId
  const orphanReply = await findReplyByTraceId(traceId);
  if (orphanReply && !orphanReply.conversation_id) {
    const { db } = await import('../db/client.js');
    db.query('UPDATE replies SET conversation_id=?,message_id=?,updated_at=? WHERE id=?').run(convId, msgId, nowIso(), orphanReply.id);
  }

  return { msgId, convId };
}

export async function handleIngestReply(payload) {
  const { traceId, conversationId = null, triggerMessageId = null, replyType = 'ai', provider = 'openclaw', modelName = null, promptVersion = null, replyText = '', replyJson = null, intentCapturedJson = null, intentStatus = null, status = 'draft', timestamp, sentTxid = null } = payload;

  // Try to find conversation via traceId if not provided
  let convId = conversationId;
  if (!convId) {
    const msg = await findMessageByTraceId(traceId);
    if (msg) convId = msg.conversation_id;
  }

  const replyId = await insertReply({
    traceId, conversationId: convId,
    messageId: triggerMessageId || null,
    replyType, provider, modelName, promptVersion,
    replyText, replyJson,
    intentCapturedJson, intentStatus,
    status,
    sentTxid,
  });

  if (convId) {
    await updateConversationTimestamps(convId, { lastReplyAt: timestamp || nowIso() });
  }

  return { replyId, convId };
}

export async function handleIngestTx(payload) {
  const { traceId, conversationId = null, messageId = null, replyId = null, direction = 'outbound', network = 'mainnet', txid, amount = null, fee = null, status = 'broadcasted', rawTxJson = null, timestamp } = payload;

  let convId = conversationId;
  if (!convId) {
    const msg = await findMessageByTraceId(traceId);
    if (msg) convId = msg.conversation_id;
  }

  const txId = await upsertTxRecord({
    traceId, conversationId: convId,
    messageId, replyId,
    direction, network, txid,
    amount: amount ? String(amount) : null,
    fee: fee ? String(fee) : null,
    status, rawTxJson,
  });

  // 链上事实归档
  if (txid) {
    recordChainEvent({
      txid, eventType: 'tx', observedBy: 'relay',
      payload: amount ? { amount, fee, direction } : null,
      observedAt: timestamp || nowIso(),
    });
  }

  if (convId) {
    await updateConversationTimestamps(convId, { lastTxAt: timestamp || nowIso() });
  }

  return { txId, convId };
}

export async function handleIngestEvent(payload) {
  const { traceId = null, eventScope = 'system', eventType, source, level = 'info', conversationId = null, messageId = null, replyId = null, summary, payloadJson = null, agentAddress = null } = payload;

  const eventId = await insertEvent({
    traceId, eventScope, eventType, source, level,
    conversationId, messageId, replyId,
    summary, payloadJson, agentAddress,
  });

  return { eventId };
}
