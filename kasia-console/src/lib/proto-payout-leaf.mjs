// proto-payout-leaf.mjs — (A) 路线 depth-0 payout leaf: blake2b256(bettorPk(32B) ‖ le8(payout))(RootClaim.sil:112)。
// 纯函数、无 DB 依赖: 被 proto-settlement-inputs.mjs(驱动层派生, 依赖 DB)与 proto-tx-assembly-settlement.mjs(builder, 不依赖 DB)共用。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');

const HEX64 = /^[0-9a-f]{64}$/;

/** leaf = blake2b256(pk(32B) ‖ le8(payout)) —— RootClaim.sil:112。 */
export function payoutLeafHex(bettorPkHex, payout) {
  const pk = String(bettorPkHex ?? '').replace(/^0x/i, '').toLowerCase();
  if (!HEX64.test(pk)) throw new Error(`payoutLeafHex: bettorPk 必须是 32 字节 hex, 实际长度=${pk.length}`);
  if (!Number.isSafeInteger(payout) || payout <= 0) throw new Error(`payoutLeafHex: payout 必须是正的安全整数, 实际=${payout}`);
  const le8 = Buffer.alloc(8); le8.writeBigUInt64LE(BigInt(payout));
  return Buffer.from(blake2b(Uint8Array.from(Buffer.concat([Buffer.from(pk, 'hex'), le8])), { dkLen: 32 })).toString('hex');
}
