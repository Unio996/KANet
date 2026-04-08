// Kasia protocol message encoding/decoding for on-chain payloads
// Two strategies: binary hex (handshake, self-stash) and UTF-8+base64 (comm, payment)

// ── Prefixes ────────────────────────────────────────────────────────────────

export const PREFIX = {
  HANDSHAKE:  'ciph_msg:1:handshake:',
  COMM:       'ciph_msg:1:comm:',
  PAYMENT:    'ciph_msg:1:payment:',
  BCAST:      'ciph_msg:1:bcast:',
  SELF_STASH: 'ciph_msg:1:self_stash:',
  LEGACY:     'ciph_msg:',
  // KANet L2+ protocol
  KANET_CARD: 'kanet:v1:card:',
};

// Pre-computed hex versions for fast matching in block scanning
export const PREFIX_HEX = {
  HANDSHAKE:  Buffer.from(PREFIX.HANDSHAKE).toString('hex'),
  COMM:       Buffer.from(PREFIX.COMM).toString('hex'),
  PAYMENT:    Buffer.from(PREFIX.PAYMENT).toString('hex'),
  BCAST:      Buffer.from(PREFIX.BCAST).toString('hex'),
  SELF_STASH: Buffer.from(PREFIX.SELF_STASH).toString('hex'),
  LEGACY:     Buffer.from(PREFIX.LEGACY).toString('hex'),
  KANET_CARD: Buffer.from(PREFIX.KANET_CARD).toString('hex'),
};

// ── Encoders (for outbound messages) ────────────────────────────────────────

export function encodeHandshakePayload(encryptedHex) {
  return PREFIX_HEX.HANDSHAKE + encryptedHex;
}

export function encodeCommPayload(alias, encryptedBytes) {
  return `${PREFIX.COMM}${alias}:${encryptedBytes.toString('base64')}`;
}

export function encodePaymentPayload(encryptedBytes) {
  return `${PREFIX.PAYMENT}${encryptedBytes.toString('base64')}`;
}

export function encodeSelfStashPayload(scope, encryptedHex) {
  const prefixHex = Buffer.from(`${PREFIX.SELF_STASH}${scope}:`).toString('hex');
  return prefixHex + encryptedHex;
}

export function encodeBcastPayload(channelName, message) {
  return Buffer.from(`${PREFIX.BCAST}${channelName}:${message}`, 'utf-8').toString('hex');
}

export function parseBcastPayload(payloadHex) {
  const bodyHex = payloadHex.slice(PREFIX_HEX.BCAST.length);
  const bodyUtf8 = Buffer.from(bodyHex, 'hex').toString('utf-8');
  const colonIdx = bodyUtf8.indexOf(':');
  if (colonIdx === -1) return null;
  return { channelName: bodyUtf8.slice(0, colonIdx), message: bodyUtf8.slice(colonIdx + 1) };
}

export function encodeCardPayload(cardJson) {
  return Buffer.from(PREFIX.KANET_CARD + cardJson, 'utf-8').toString('hex');
}

export function payloadToTransactionHex(payload) {
  if (!payload.includes(':') && /^[0-9a-f]+$/i.test(payload)) return payload;
  return Buffer.from(payload, 'utf-8').toString('hex');
}

// ── Detector (for inbound block scanning) ───────────────────────────────────

/**
 * Classify a payload hex string into a Kasia message type.
 * Returns null if not a Kasia message.
 * Uses hex prefix matching only — no hex→utf8 conversion needed.
 */
export function classifyPayload(payloadHex) {
  if (payloadHex.startsWith(PREFIX_HEX.HANDSHAKE))  return 'handshake';
  if (payloadHex.startsWith(PREFIX_HEX.COMM))        return 'comm';
  if (payloadHex.startsWith(PREFIX_HEX.PAYMENT))     return 'payment';
  if (payloadHex.startsWith(PREFIX_HEX.BCAST))        return 'bcast';
  if (payloadHex.startsWith(PREFIX_HEX.SELF_STASH))  return 'self_stash';
  if (payloadHex.startsWith(PREFIX_HEX.LEGACY))      return 'legacy';
  // KANet L2+ protocol types
  if (payloadHex.startsWith(PREFIX_HEX.KANET_CARD))  return 'kanet_card';
  return null;
}
