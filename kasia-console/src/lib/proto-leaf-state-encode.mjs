// proto-leaf-state-encode.mjs — ShardLeaf_direct 的 state 字节手编码(纯函数, 不碰 DB)。
// 9-1 F3 笔(NWT D-2 的真修法): 从 proto-leaf-state.mjs 拆出。原因: proto-leaf-state.mjs 顶部 import 了 db/client.js, 而 proto-tx-assembly.mjs 只为这一个纯函数 import 它——
//   于是 tx-assembly → chain-checks → c1 / pointers 整条链在 import 时都会打开默认库(M0a 无 DB_PATH 时拒绝)。拆出后这条链不再碰 DB 客户端。
// proto-leaf-state.mjs 仍 re-export 它(既有 import 方不受影响)。

/** AB11 hand-encoding: 4 个 int 字段各自 [08][8字节小端], 与 ShardLeaf_direct.sil:151-154 自己的手写
 *  编码逐字节一致(已用真实 compileSilV100 重编两组不同 init 值验证过, 2026-09-15)。 */
export function encodeLeafStateBytes({ local_yes, local_no, count, pool_value }) {
  const buf = Buffer.alloc(36);
  let off = 0;
  for (const v of [local_yes, local_no, count, pool_value]) {
    buf[off] = 0x08; off += 1;
    buf.writeBigInt64LE(BigInt(v), off); off += 8;
  }
  return buf;
}
