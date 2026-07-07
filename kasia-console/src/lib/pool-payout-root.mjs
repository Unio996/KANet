// pool-payout-root.mjs — #31 payoutRoot off-chain builder (productionized from J2 standalone).
// Feeds chunk_0 plan_commit (= payoutRoot). MUST byte-match SS leaf = blake2b(pk ‖ byte[](amount,8)).
//
// ENDIANNESS (J2 source-verified, NOT assumed): silverscript byte[](int,size) → OpNum2Bin →
//   rusty-kaspa data_stack.rs serialize_i64() = LITTLE-ENDIAN sign-magnitude (low byte first, sign bit
//   in LAST byte). sompi > 0 & < 2^63 → 8-byte UNSIGNED LITTLE-ENDIAN. byte-match self-test 7/7 +
//   re-climb 20/20 (= SS depth-8 climb replica). padding = ZERO32 (malleability-free, NOT dup-last).
import { blake2b } from '@noble/hashes/blake2b';

const ZERO32 = Buffer.alloc(32);
const DEPTH = 10; // depth-10 (79b08784): ≤1024 winner/PayoutShard (winner 轴深化, 链上 claim 10-step climb 必同深)。旧 depth-8(≤256)已 superseded。
const CAP = 1 << DEPTH; // 1024 winners/shard

// Exact JS port of rusty-kaspa serialize_i64(num, size) — the on-chain byte[](int,size) behavior (LE sign-magnitude).
export function serializeI64(num, size) {
  const sign = num < 0n ? -1 : (num > 0n ? 1 : 0);
  let positive = num < 0n ? -num : num;
  const bytes = [];
  let lastSaturated = false;
  while (true) {
    if (positive === 0n) {
      if (lastSaturated) { bytes.push(0); lastSaturated = false; } else break;
    } else {
      const value = Number(positive & 0xffn);
      lastSaturated = (value & 0x80) !== 0;
      positive >>= 8n;
      bytes.push(value);
    }
  }
  if (size != null) {
    if (bytes.length > size) throw new Error(`NumberTooLong ${num} > ${size}B`);
    while (bytes.length < size) bytes.push(0);
  }
  if (sign === -1) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}

// leaf_k = blake2b(pk32 ‖ serializeI64(amount,8))[dkLen 32].
export function payoutLeaf(pkHex, amountSompi) {
  const pk = Buffer.from(pkHex, 'hex');
  if (pk.length !== 32) throw new Error(`pk must be 32B, got ${pk.length}`);
  if (BigInt(amountSompi) <= 0n) throw new Error(`payout amount must be > 0, got ${amountSompi}`);  // min-pot guard
  return Buffer.from(blake2b(Buffer.concat([pk, serializeI64(BigInt(amountSompi), 8)]), { dkLen: 32 }));
}

// ── INPUT side (P3 inputs_commit·J1 三层锁定 golden-ref §6.5)──────────────────────
// bets-leaf = blake2b(pk32 ‖ serializeI64(stake,8) ‖ serializeI64(dir,1))[32] — 41B preimage (≠ payoutLeaf 40B).
//   dir 1B: 0x00=YES / 0x01=NO. 用于 ZK guest inputs_commit + settler gather 自验门 (predict-then-verify)。
export function betsLeaf(pkHex, stakeSompi, dir) {
  const pk = Buffer.from(pkHex, 'hex');
  if (pk.length !== 32) throw new Error(`bets pk must be 32B, got ${pk.length}`);
  if (BigInt(stakeSompi) <= 0n) throw new Error(`bet stake must be > 0, got ${stakeSompi}`);
  if (dir !== 0 && dir !== 1) throw new Error(`bet dir must be 0(YES)/1(NO), got ${dir}`);
  return Buffer.from(blake2b(Buffer.concat([pk, serializeI64(BigInt(stakeSompi), 8), serializeI64(BigInt(dir), 1)]), { dkLen: 32 }));
}

// ── canonical absorb-order (W2, Bettor 2026-07-07 钉·单一定义单一实现) ──────────────────────────────
// 🔴 全系统只此一处定义 bets 的 canonical 序：driver gather(zk-close-builder.mjs gatherOrderedBets)/committee
// 独立重算(bshard-close-enforce.mjs enforceCloseAttestV2)/未来 guest-feed 三处必须调**同一个函数**,不准
// 各自实现一套排序逻辑(两套序 = 跨节点/跨调用点 betsRoot 分叉,order-sensitive hash-chain 对此零容忍)。
// 排序键: side_lock_daa ASC(链上共识事实·接受块 DAA·跨节点收敛,非 node-local DB insertion id)。
// tiebreak: side_lock_daa 相同(同一 DAA 内双注)时按 side_lock_tx 字典序 ASC(锁仓 tx id·同样链锚,确定性打破)。
// fail-loud: 任一 bettor 缺 side_lock_daa/side_lock_tx(未链锚)→ throw,不静默回退 id 序(NWT W2 review 钉)。
// rows 字段兼容 {pk|bettor_pk, side_lock_daa, side_lock_tx}(committee 重算传 loadBettors 行 / driver gather 传
// pool_bettor_sides 行, 两边字段名不完全一致, 只认这三个 key 的其中一种命名)。
export function canonicalBetOrder(rows) {
  if (!Array.isArray(rows)) throw new Error('canonicalBetOrder: rows must be array');
  for (const r of rows) {
    const idLabel = String(r.pk ?? r.bettor_pk ?? '?').slice(0, 10);
    if (r.side_lock_daa == null) throw new Error(`canonicalBetOrder: bettor ${idLabel} 无 side_lock_daa (未链锚, fail-loud, 不回退本地序)`);
    if (r.side_lock_tx == null) throw new Error(`canonicalBetOrder: bettor ${idLabel} 无 side_lock_tx (无法 tiebreak, fail-loud)`);
  }
  return [...rows].sort((a, b) => {
    const da = Number(a.side_lock_daa), dbb = Number(b.side_lock_daa);
    if (da !== dbb) return da - dbb;
    return String(a.side_lock_tx).localeCompare(String(b.side_lock_tx));
  });
}

// betsRoot = fold blake2b(acc ‖ bets_leaf)[32] from genesis ZERO32 — covenant 每笔 require new==此式 (非-vacuous)。
// 🔴 ORDER-SENSITIVE (hash-CHAIN·非 merkle): 同一组 bets 不同序 → 不同 betsRoot。total-order = PayoutShard
//    continuation 链序 (absorb 的链上顺序)。covenant/guest/off-chain 三层必同序·否则 betsRoot 漂 = inputs_commit 锚错。
// orderedBets: [{ pk:hex32, stake:sompi(string|bigint), direction:0|1 }] in absorb (continuation-chain) order.
// 单片首 ship: 该 PayoutShard betsRoot 直接 = global inputs_commit。
export function computeBetsRoot(orderedBets) {
  return orderedBets.reduce(
    (acc, b) => Buffer.from(blake2b(Buffer.concat([acc, betsLeaf(b.pk, b.stake, b.direction)]), { dkLen: 32 })),
    ZERO32,
  );
}

function levelsOf(winners) {
  if (winners.length > CAP) throw new Error(`>${CAP} winners needs depth>${DEPTH} (SS climb is depth-${DEPTH}; >${CAP} → rolling payout-shard)`);
  const levels = [];
  let level = new Array(CAP).fill(ZERO32);
  winners.forEach((w, i) => { level[i] = payoutLeaf(w.pk, w.amount); });
  levels.push(level);
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(Buffer.from(blake2b(Buffer.concat([level[i], level[i + 1]]), { dkLen: 32 })));
    levels.push(next); level = next;
  }
  return levels;
}

// depth-8 position-aware merkle root = plan_commit (committee-sign in chunk_0).
export function payoutRoot(winners) { return levelsOf(winners)[DEPTH][0]; }

// 8 siblings for leaf at merkle_index idx (flat, = SS winnerSiblings[k*8+lvl] layout).
export function merkleProof(winners, idx) {
  const levels = levelsOf(winners);
  const sibs = []; let pos = idx;
  for (let lvl = 0; lvl < DEPTH; lvl++) { sibs.push(levels[lvl][pos ^ 1]); pos >>= 1; }
  return sibs;
}

// re-climb leaf+siblings to root — EXACT SS climb replica (b_lvl = (idx>>lvl)&1).
export function climbProof(leaf, idx, siblings) {
  let cur = leaf;
  for (let lvl = 0; lvl < DEPTH; lvl++) {
    const b = (idx >> lvl) & 1, sib = siblings[lvl];
    cur = Buffer.from(blake2b(b === 0 ? Buffer.concat([cur, sib]) : Buffer.concat([sib, cur]), { dkLen: 32 }));
  }
  return cur;
}

export const PAYOUT_DEPTH = DEPTH;
export const MAX_WINNERS_PER_SHARD = CAP;
