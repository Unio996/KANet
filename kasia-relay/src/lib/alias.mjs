// Deterministic alias derivation for Kasia conversations
// ECDH + HKDF with asymmetric context pubkeys
import * as crypto from 'node:crypto';
import { extractXOnlyPubkeyFromAddress } from './crypto.mjs';

const ALIAS_BYTE_LENGTH = 6;

export async function deriveAliases(myPrivateKeyHex, theirAddress) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(myPrivateKeyHex, 'hex'));
  const myXOnlyPubkey = ecdh.getPublicKey(null, 'compressed').subarray(1);
  const theirXOnlyPubkey = extractXOnlyPubkeyFromAddress(theirAddress);
  const theirCompressed = Buffer.concat([Buffer.from([0x02]), theirXOnlyPubkey]);
  const sharedSecret = ecdh.computeSecret(theirCompressed);
  const myAlias = deriveAlias(sharedSecret, myXOnlyPubkey);
  const theirAlias = deriveAlias(sharedSecret, theirXOnlyPubkey);
  return { myAlias, theirAlias };
}

function deriveAlias(sharedSecret, contextPubkey) {
  const prk = crypto.createHmac('sha256', Buffer.alloc(0)).update(sharedSecret).digest();
  const info = Buffer.alloc(68);
  info.set(Buffer.from('chat', 'utf-8'), 0);
  info.set(sharedSecret, 4);
  info.set(contextPubkey, 36);
  const aliasBytes = hkdfExpand(prk, info, ALIAS_BYTE_LENGTH);
  return aliasBytes.toString('hex');
}

function hkdfExpand(prk, info, length) {
  const hashLen = 32;
  const n = Math.ceil(length / hashLen);
  const output = Buffer.alloc(n * hashLen);
  let prev = Buffer.alloc(0);
  for (let i = 1; i <= n; i++) {
    const hmac = crypto.createHmac('sha256', prk);
    hmac.update(prev);
    hmac.update(info);
    hmac.update(Buffer.from([i]));
    prev = Buffer.from(hmac.digest());
    prev.copy(output, (i - 1) * hashLen);
  }
  return output.subarray(0, length);
}
