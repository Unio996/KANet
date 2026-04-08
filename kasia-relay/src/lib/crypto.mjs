// Kasia message encryption/decryption
// ECDH secp256k1 + HKDF-SHA256 + ChaCha20-Poly1305
import * as crypto from 'node:crypto';

const NONCE_LENGTH = 12;
const COMPRESSED_PUBKEY_LENGTH = 33;
const X_ONLY_PUBKEY_LENGTH = 32;
const MAC_LENGTH = 16;
const HKDF_KEY_LENGTH = 32;
const BECH32_CHECKSUM_LENGTH = 8;

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function convertBits(data, fromBits, toBits) {
  let acc = 0, bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || (value >> fromBits) !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) return null;
  return result;
}

export function extractXOnlyPubkeyFromAddress(address) {
  const colonIndex = address.indexOf(':');
  if (colonIndex === -1) throw new Error('Invalid Kaspa address: missing prefix separator');
  const payload = address.substring(colonIndex + 1);
  if (payload.length < BECH32_CHECKSUM_LENGTH + 2) throw new Error('Invalid Kaspa address: payload too short');
  const data5bit = [];
  for (const c of payload) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid Kaspa address: invalid character '${c}'`);
    data5bit.push(idx);
  }
  const dataWithoutChecksum = data5bit.slice(0, -BECH32_CHECKSUM_LENGTH);
  const bytes = convertBits(dataWithoutChecksum, 5, 8);
  if (!bytes || bytes.length < 2) throw new Error('Invalid Kaspa address: failed to decode payload');
  const pubkeyBytes = bytes.slice(1);
  if (pubkeyBytes.length !== X_ONLY_PUBKEY_LENGTH)
    throw new Error(`Invalid Kaspa address: expected ${X_ONLY_PUBKEY_LENGTH} byte pubkey, got ${pubkeyBytes.length}`);
  return Buffer.from(pubkeyBytes);
}

export async function encrypt(plaintext, recipientAddress) {
  const xOnlyPubkey = extractXOnlyPubkeyFromAddress(recipientAddress);
  const recipientCompressed = Buffer.concat([Buffer.from([0x02]), xOnlyPubkey]);
  const ephemeral = crypto.createECDH('secp256k1');
  ephemeral.generateKeys();
  const ephemeralPubkey = ephemeral.getPublicKey(null, 'compressed');
  const sharedSecret = ephemeral.computeSecret(recipientCompressed);
  const key = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.alloc(0), HKDF_KEY_LENGTH);
  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv('chacha20-poly1305', Buffer.from(key), nonce, { authTagLength: MAC_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const mac = cipher.getAuthTag();
  return Buffer.concat([nonce, ephemeralPubkey, ciphertext, mac]);
}

export async function decrypt(encrypted, privateKeyHex) {
  const minLength = NONCE_LENGTH + X_ONLY_PUBKEY_LENGTH + 1 + MAC_LENGTH;
  if (encrypted.length < minLength)
    throw new Error(`Encrypted payload too short: ${encrypted.length} bytes (minimum ${minLength})`);
  const nonce = encrypted.subarray(0, NONCE_LENGTH);
  const possiblePrefix = encrypted[NONCE_LENGTH];
  const isCompressed = possiblePrefix === 0x02 || possiblePrefix === 0x03;
  let ephemeralPubkey, ciphertextAndMac;
  if (isCompressed && encrypted.length >= NONCE_LENGTH + COMPRESSED_PUBKEY_LENGTH + 1 + MAC_LENGTH) {
    ephemeralPubkey = Buffer.from(encrypted.subarray(NONCE_LENGTH, NONCE_LENGTH + COMPRESSED_PUBKEY_LENGTH));
    ciphertextAndMac = encrypted.subarray(NONCE_LENGTH + COMPRESSED_PUBKEY_LENGTH);
  } else {
    ephemeralPubkey = Buffer.concat([
      Buffer.from([0x02]),
      encrypted.subarray(NONCE_LENGTH, NONCE_LENGTH + X_ONLY_PUBKEY_LENGTH),
    ]);
    ciphertextAndMac = encrypted.subarray(NONCE_LENGTH + X_ONLY_PUBKEY_LENGTH);
  }
  const ciphertext = ciphertextAndMac.subarray(0, ciphertextAndMac.length - MAC_LENGTH);
  const mac = ciphertextAndMac.subarray(ciphertextAndMac.length - MAC_LENGTH);
  try {
    return decryptWithPubkey(nonce, ephemeralPubkey, ciphertext, mac, privateKeyHex);
  } catch (e) {
    if (!isCompressed) {
      const oddPubkey = Buffer.concat([
        Buffer.from([0x03]),
        encrypted.subarray(NONCE_LENGTH, NONCE_LENGTH + X_ONLY_PUBKEY_LENGTH),
      ]);
      return decryptWithPubkey(nonce, oddPubkey, ciphertext, mac, privateKeyHex);
    }
    throw e;
  }
}

function decryptWithPubkey(nonce, ephemeralPubkey, ciphertext, mac, privateKeyHex) {
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
  const sharedSecret = ecdh.computeSecret(ephemeralPubkey);
  const key = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.alloc(0), HKDF_KEY_LENGTH);
  const decipher = crypto.createDecipheriv('chacha20-poly1305', Buffer.from(key), nonce, { authTagLength: MAC_LENGTH });
  decipher.setAuthTag(mac);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf-8');
}
