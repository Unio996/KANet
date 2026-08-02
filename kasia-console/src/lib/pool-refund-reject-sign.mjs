// pool-refund-reject-sign.mjs — r402: shared hash for pool_refund_request_rejected_v1 signing.
//
// Sign/verify must reconstruct the byte-identical hash input or every legitimate signature
// fails to verify (same class of bug coord-status-sign.mjs warns about at L11-13: signer and
// verifier canonicalization must live in exactly one function, not two copies that can drift).
//
// Signing object = blake2b(JSON.stringify(payload)) hex, not the raw JSON string — aligned with
// the D-010 coord-status signing gate (kasia-console/src/lib/coord-status-sign.mjs), which has
// been through adversarial forgery testing in production. This is a newer, more-reviewed pattern
// than the raw-string signing used by handlePoolOracleVote (Bettor 2026-08-02T20:29 direction).
import { blake2b } from '@noble/hashes/blake2b';

/**
 * hashPayloadHex — blake2b(JSON.stringify(payloadObj), dkLen=32) as hex.
 * Caller must pass the exact same object shape (same keys, same order via JSON.stringify's
 * own key-enumeration order — verified stable across JSON.parse → spread → delete → stringify,
 * NWT 2026-08-02 v2 review point 5) on both the signing and verifying side.
 * @param {object} payloadObj
 * @returns {string} 64-char hex
 */
export function hashPayloadHex(payloadObj) {
  return Buffer.from(blake2b(Buffer.from(JSON.stringify(payloadObj), 'utf8'), { dkLen: 32 })).toString('hex');
}
