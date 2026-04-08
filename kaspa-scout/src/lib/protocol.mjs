/**
 * Kasia protocol prefix constants and payload classifier.
 * Copied from kasia-relay — scout only needs the detection side,
 * not the encoders (scout is purely passive, never sends messages).
 */

// ── Prefixes (UTF-8) ────────────────────────────────────────────────────────

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

// Minimum hex length for any Kasia payload (shortest prefix = "ciph_msg:" in hex)
export const MIN_PAYLOAD_HEX = PREFIX_HEX.LEGACY.length + 2;

// ── Detector (for inbound block scanning) ───────────────────────────────────

/**
 * Classify a payload hex string into a Kasia message type.
 * Returns null if not a Kasia message.
 * Uses hex prefix matching only — no hex-to-utf8 conversion needed.
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
