import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
export const hex = (a) => '0x' + Buffer.from(a).toString('hex');
export const b2b = (buf) => blake2b(Uint8Array.from(buf), { dkLen: 32 });
export const le8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return [...b]; };
const ZERO32 = new Array(32).fill(0);

// depth-D merkle tree over `leaves` (index -> leafBytes). Missing leaves default to ZERO32 leaf hash.
// Folding rule matches PayoutShard.claim/refund_claim: bit==0 -> blake2b(cur+sibling), bit==1 -> blake2b(sibling+cur)
export function buildMerkle(depth, leavesByIndex) {
  const size = 1 << depth;
  let level = [];
  for (let i = 0; i < size; i++) level.push(leavesByIndex[i] ? Uint8Array.from(leavesByIndex[i]) : Uint8Array.from(ZERO32));
  const levels = [level];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(b2b([...level[i], ...level[i + 1]]));
    levels.push(next);
    level = next;
  }
  return levels; // levels[0]=leaves .. levels[depth]=[root]
}
export function proveMerkle(levels, index, depth) {
  const sibs = [];
  let idx = index;
  for (let d = 0; d < depth; d++) {
    const level = levels[d];
    const bit = idx % 2;
    const sibIdx = bit === 0 ? idx + 1 : idx - 1;
    sibs.push([...level[sibIdx]]);
    idx = Math.floor(idx / 2);
  }
  return sibs; // sibs[0]=s0 .. sibs[depth-1]
}
export function root(levels, depth) { return [...levels[depth][0]]; }
