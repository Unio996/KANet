// 复刻 rusty-kaspa consensus/core/src/hashing/covenant_id.rs 的 covenant_id() 函数(keyed blake2b, 域 b"CovenantID")。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');

function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function u64le(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function u16le(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function varBytes(buf) { return Buffer.concat([u64le(buf.length), buf]); }

// outpoint = { transactionId: 32-byte Buffer, index: u32 }
// authOutputs = [{ index: u32, value: u64, spkVersion: u16, spkScript: Buffer }]
export function covenantId(outpoint, authOutputs) {
  const parts = [outpoint.transactionId, u32le(outpoint.index), u64le(authOutputs.length)];
  for (const o of authOutputs) {
    parts.push(u32le(o.index), u64le(o.value), u16le(o.spkVersion), varBytes(o.spkScript));
  }
  const msg = Buffer.concat(parts);
  const key = Buffer.from('CovenantID', 'utf8');
  return Buffer.from(blake2b(msg, { dkLen: 32, key })).toString('hex');
}
