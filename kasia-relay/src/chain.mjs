// chain.mjs — relay's own on-chain capability layer
// Replaces direct imports from kasia-mcp/kaspa-mcp dist files
import { getWallet } from './lib/wallet.mjs';
import { encrypt, decrypt } from './lib/crypto.mjs';
import { deriveAliases } from './lib/alias.mjs';
import { encodeHandshakePayload, encodeCommPayload, encodeCardPayload, payloadToTransactionHex } from './lib/protocol.mjs';
import { getIndexer } from './lib/indexer.mjs';
import { sendKaspa, sendKaspaByAmount, custodialSendKaspa, KASIA_MIN_AMOUNT } from './lib/transaction.mjs';

// ── getConversations ────────────────────────────────────────────────────────

function tryParseHandshake(decrypted) {
  try { return JSON.parse(decrypted); } catch { return null; }
}

async function decryptHandshake(hs, privateKeyHex) {
  try {
    const payloadHex = hs.message_payload;
    const prefixHex = Buffer.from('ciph_msg:1:handshake:', 'utf-8').toString('hex');
    const encryptedHex = payloadHex.startsWith(prefixHex) ? payloadHex.slice(prefixHex.length) : payloadHex;
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decrypted = await decrypt(encrypted, privateKeyHex);
    return tryParseHandshake(decrypted);
  } catch { return null; }
}

export async function getConversations() {
  const wallet = getWallet();
  const myAddress = wallet.getAddress();
  const myPrivateKeyHex = wallet.getPrivateKey().toString();
  const indexer = getIndexer();

  const [sentHandshakes, receivedHandshakes] = await Promise.all([
    indexer.getHandshakesBySender(myAddress),
    indexer.getHandshakesByReceiver(myAddress),
  ]);

  const conversations = new Map();

  for (const hs of sentHandshakes) {
    const contactAddress = hs.receiver;
    const { myAlias, theirAlias } = await deriveAliases(myPrivateKeyHex, contactAddress);
    const existing = conversations.get(contactAddress);
    if (!existing || hs.block_time > existing.lastActivity) {
      conversations.set(contactAddress, {
        contactAddress, myAlias, theirAlias,
        status: 'pending_outgoing',
        lastActivity: hs.block_time,
      });
    }
  }

  for (const hs of receivedHandshakes) {
    const payload = await decryptHandshake(hs, myPrivateKeyHex);
    const contactAddress = hs.sender;
    const existing = conversations.get(contactAddress);
    if (existing) {
      if (payload) existing.theirAlias = payload.alias;
      existing.status = 'active';
      if (hs.block_time > existing.lastActivity) existing.lastActivity = hs.block_time;
    } else {
      const isResponse = payload?.is_response ?? false;
      conversations.set(contactAddress, {
        contactAddress,
        myAlias: '',
        theirAlias: payload?.alias ?? '',
        status: isResponse ? 'active' : 'pending_incoming',
        lastActivity: hs.block_time,
      });
    }
  }

  return Array.from(conversations.values()).sort((a, b) => b.lastActivity - a.lastActivity);
}

// ── getMessages ─────────────────────────────────────────────────────────────

async function decryptCommMessage(msg, privateKeyHex) {
  try {
    const payloadUtf8 = Buffer.from(msg.message_payload, 'hex').toString('utf-8');
    const encryptedBytes = Buffer.from(payloadUtf8, 'base64');
    return await decrypt(encryptedBytes, privateKeyHex);
  } catch { return null; }
}

export async function getMessages(params) {
  const wallet = getWallet();
  const myAddress = wallet.getAddress();
  const myPrivateKeyHex = wallet.getPrivateKey().toString();
  const indexer = getIndexer();

  const derived = await deriveAliases(myPrivateKeyHex, params.address);
  const myAlias = derived.myAlias;

  // Prefer alias from on-chain handshake over locally derived (cross-wallet compat)
  const convs = await getConversations();
  const conv = convs.find(c => c.contactAddress === params.address);
  const theirAlias = conv?.theirAlias || derived.theirAlias;

  const [myMessages, theirMessages] = await Promise.all([
    indexer.getMessagesBySender(myAddress, myAlias),
    indexer.getMessagesBySender(params.address, theirAlias),
  ]);

  const decrypted = [];
  for (const msg of myMessages) {
    const text = await decryptCommMessage(msg, myPrivateKeyHex);
    if (text === null) continue;
    decrypted.push({ txId: msg.tx_id, from: myAddress, fromMe: true, message: text, timestamp: msg.block_time, confirmed: msg.accepting_block !== null });
  }
  for (const msg of theirMessages) {
    const text = await decryptCommMessage(msg, myPrivateKeyHex);
    if (text === null) continue;
    decrypted.push({ txId: msg.tx_id, from: params.address, fromMe: false, message: text, timestamp: msg.block_time, confirmed: msg.accepting_block !== null });
  }

  return decrypted.sort((a, b) => a.timestamp - b.timestamp);
}

// ── sendMessage ─────────────────────────────────────────────────────────────

export async function sendMessage(params) {
  const wallet = getWallet();
  const myAddress = wallet.getAddress();
  const myPrivateKeyHex = wallet.getPrivateKey().toString();
  const { myAlias } = await deriveAliases(myPrivateKeyHex, params.address);
  const encrypted = await encrypt(params.message, params.address);
  const commPayload = encodeCommPayload(myAlias, encrypted);
  const payload = payloadToTransactionHex(commPayload);
  // Comm is a self-send — use full-UTXO mode (no change, near-zero KIP-9 mass)
  return { to: myAddress, amount: 'self-full', payload };
}

// ── acceptHandshake ──────────────────────────────────────────────────────────

export async function acceptHandshake(params) {
  const wallet = getWallet();
  const myPrivateKeyHex = wallet.getPrivateKey().toString();
  const { myAlias, theirAlias } = await deriveAliases(myPrivateKeyHex, params.address);
  const handshake = {
    type: 'handshake', alias: myAlias, theirAlias,
    timestamp: Date.now(), version: 1, isResponse: true,
  };
  const encrypted = await encrypt(JSON.stringify(handshake), params.address);
  const payload = encodeHandshakePayload(encrypted.toString('hex'));
  return { to: params.address, amount: KASIA_MIN_AMOUNT, payload };
}

// ── initiateHandshake ────────────────────────────────────────────────────────

export async function initiateHandshake(params) {
  const wallet = getWallet();
  const myPrivateKeyHex = wallet.getPrivateKey().toString();
  const { myAlias, theirAlias } = await deriveAliases(myPrivateKeyHex, params.address);
  const handshake = {
    type: 'handshake', alias: myAlias, theirAlias,
    timestamp: Date.now(), version: 1, isResponse: false,
  };
  const encrypted = await encrypt(JSON.stringify(handshake), params.address);
  const payload = encodeHandshakePayload(encrypted.toString('hex'));
  return { to: params.address, amount: KASIA_MIN_AMOUNT, payload };
}

// ── publishCard ──────────────────────────────────────────────────────────────

/**
 * Build an Agent Card TX payload for self-send publication.
 * @param {object} params
 * @param {string} params.name - Agent display name
 * @param {string} params.entityType - 'agent' | 'human' | 'service' | 'org'
 * @param {string[]} [params.skills] - Declared capability labels
 * @param {string} [params.summary] - Short description (<= 280 chars)
 * @param {string} [params.mode='public'] - 'public' | 'mixed' | 'private'
 * @param {string|null} [params.rootTx=null] - Root card txid (null for first card)
 * @param {string|null} [params.parentTx=null] - Parent card txid (null for first card)
 * @param {object} [params.extData=null] - Private extension data (self-encrypted)
 * @returns {Promise<{ to: string, amount: string, payload: string }>}
 */
export async function publishCard(params) {
  const wallet = getWallet();
  const myAddress = wallet.getAddress();
  const mode = params.mode || 'public';

  const card = {
    version: 1,
    mode,
    root_tx: params.rootTx || null,
    parent_tx: params.parentTx || null,
    entity_type: params.entityType || 'agent',
    timestamp: Math.floor(Date.now() / 1000),
  };

  // Public fields (omitted in private mode)
  if (mode !== 'private') {
    card.name = params.name;
    if (params.skills) card.skills = params.skills;
    if (params.summary) card.summary = params.summary;
    if (params.serviceTerms && typeof params.serviceTerms === 'object') card.service_terms = params.serviceTerms;
  }

  // Self-encrypt extension data for mixed/private modes
  if ((mode === 'mixed' || mode === 'private') && params.extData) {
    const encrypted = await encrypt(JSON.stringify(params.extData), myAddress);
    card._ext = encrypted.toString('base64');
  }

  const cardJson = JSON.stringify(card);
  if (cardJson.length > 980) throw new Error(`card exceeds 980B preflight (${cardJson.length} chars)`);
  if (Buffer.byteLength(cardJson, 'utf-8') > 1024) {
    throw new Error(`Card exceeds 1024 byte limit (${Buffer.byteLength(cardJson, 'utf-8')} bytes)`);
  }

  const payload = encodeCardPayload(cardJson);
  // Card is a self-send — use full-UTXO mode (no change, near-zero KIP-9 mass)
  return { to: myAddress, amount: 'self-full', payload };
}

// ── sendKaspaTransaction ─────────────────────────────────────────────────────

export { sendKaspaByAmount as sendKaspa };
// KANet-UI 2026-06-23 Path C: TG 托管钱包 /send 用 (relay 唯一链上出口)。
export { custodialSendKaspa };
