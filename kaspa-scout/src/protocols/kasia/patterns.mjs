/**
 * Kasia protocol signature constants.
 */

// On-chain payload prefixes (UTF-8, before hex encoding)
export const HANDSHAKE_PREFIX  = 'ciph_msg:1:handshake:';
export const COMM_PREFIX       = 'ciph_msg:1:comm:';
export const PAYMENT_PREFIX    = 'ciph_msg:1:payment:';
export const SELF_STASH_PREFIX = 'ciph_msg:1:self_stash:';
export const LEGACY_PREFIX     = 'ciph_msg:';

// Protocol identifier for reporting
export const PROTOCOL_NAME = 'kasia';
export const PROTOCOL_VERSION = '1.0';
