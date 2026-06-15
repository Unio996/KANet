// J2 #31 payoutRoot off-chain builder + endianness byte-match self-test.
// Feeds chunk_0 plan_commit (=payoutRoot). MUST byte-match SS leaf = blake2b(pk ‖ byte[](amount,8)).
//
// ENDIANNESS (J2 source-verified, NOT assumed): silverscript byte[](int,size) → OpNum2Bin →
//   rusty-kaspa data_stack.rs serialize_i64() = LITTLE-ENDIAN sign-magnitude (low byte first,
//   sign bit in LAST byte). sompi > 0 & < 2^63 → effectively 8-byte UNSIGNED LITTLE-ENDIAN.
//   ⇒ design/comment "8B BE" is WRONG. Off-chain leaf MUST use LE. (L83 .sil comment to fix.)
import { blake2b } from '@noble/hashes/blake2b';

// Exact JS port of rusty-kaspa serialize_i64(num, size) — the on-chain byte[](int,size) behavior.
export function serializeI64(num, size) {
  const sign = num < 0n ? -1 : (num > 0n ? 1 : 0);
  let positive = num < 0n ? -num : num;
  const bytes = [];
  let lastSaturated = false;
  // emit low byte first (little-endian); replicate the iter::from_fn loop
  while (true) {
    if (positive === 0n) {
      if (lastSaturated) { bytes.push(0); lastSaturated = false; }
      else break;
    } else {
      const value = Number(positive & 0xffn);
      lastSaturated = (value & 0x80) !== 0;
      positive >>= 8n;
      bytes.push(value);
    }
  }
  if (size != null) {
    if (bytes.length > size) throw new Error(`NumberTooLong ${num} > ${size}B`);
    while (bytes.length < size) bytes.push(0); // pad high (LE)
  }
  if (sign === -1) bytes[bytes.length - 1] |= 0x80; // sign bit in MSB (last) byte
  return Buffer.from(bytes);
}

// leaf_k = blake2b(pk32 ‖ serializeI64(amount,8))[dkLen 32]
export function payoutLeaf(pkHex, amountSompi) {
  const pk = Buffer.from(pkHex, 'hex');
  if (pk.length !== 32) throw new Error(`pk must be 32B, got ${pk.length}`);
  // NWT robustness: reject 0/negative amount in leaf (min-pot should guarantee >0; explicit guard).
  // sompi>0 → serializeI64 stays pure 8-byte LE (positive path), byte-matches SS byte[](amount,8).
  if (BigInt(amountSompi) <= 0n) throw new Error(`payout amount must be > 0, got ${amountSompi}`);
  const amt = serializeI64(BigInt(amountSompi), 8);
  return Buffer.from(blake2b(Buffer.concat([pk, amt]), { dkLen: 32 }));
}

// depth-8 position-aware merkle root (matches SS climb: widx bits decide L/R per level).
// leaves placed at merkle_index 0..N-1; empty slots = ZERO32 (must match SS convention).
const ZERO32 = Buffer.alloc(32);
const DEPTH = 8;
const CAP = 1 << DEPTH; // 256
export function payoutRoot(winners /* [{pk, amount}] in merkle_index order */) {
  if (winners.length > CAP) throw new Error(`>${CAP} winners needs depth>${DEPTH} (SS climb is depth-8)`);
  let level = new Array(CAP).fill(ZERO32);
  winners.forEach((w, i) => { level[i] = payoutLeaf(w.pk, w.amount); });
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(blake2b(Buffer.concat([level[i], level[i + 1]]), { dkLen: 32 })));
    }
    level = next;
  }
  return level[0]; // 32B root = plan_commit (committee-sign in chunk_0)
}

// Build all merkle levels (level[0]=leaves..level[DEPTH]=[root]) so we can extract sibling paths.
function payoutLevels(winners) {
  if (winners.length > CAP) throw new Error(`>${CAP} winners needs depth>${DEPTH}`);
  const levels = [];
  let level = new Array(CAP).fill(ZERO32);
  winners.forEach((w, i) => { level[i] = payoutLeaf(w.pk, w.amount); });
  levels.push(level);
  for (let d = 0; d < DEPTH; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(Buffer.from(blake2b(Buffer.concat([level[i], level[i + 1]]), { dkLen: 32 })));
    }
    levels.push(next);
    level = next;
  }
  return levels; // levels[DEPTH][0] = root
}

// merkleProof: 8 siblings for the leaf at merkle_index `idx` (flat, depth-8).
// Sibling at level lvl = the other node of the pair containing the current node.
export function merkleProof(winners, idx) {
  const levels = payoutLevels(winners);
  const sibs = [];
  let pos = idx;
  for (let lvl = 0; lvl < DEPTH; lvl++) {
    const sibPos = pos ^ 1;                       // pair partner
    sibs.push(levels[lvl][sibPos]);
    pos = pos >> 1;
  }
  return sibs; // [8 × 32B]
}

// climbProof: re-climb leaf+siblings to root — EXACT replica of SS climb (position-aware by idx bits):
//   b_lvl = (idx >> lvl) & 1; b==0 → parent=blake2b(cur‖sib); b==1 → parent=blake2b(sib‖cur).
export function climbProof(leaf, idx, siblings) {
  let cur = leaf;
  for (let lvl = 0; lvl < DEPTH; lvl++) {
    const b = (idx >> lvl) & 1;
    const sib = siblings[lvl];
    cur = Buffer.from(blake2b(b === 0 ? Buffer.concat([cur, sib]) : Buffer.concat([sib, cur]), { dkLen: 32 }));
  }
  return cur;
}

// —— byte-match self-test: serializeI64 vs Buffer.writeBigUInt64LE for positive sompi ——
function selfTest() {
  const cases = [0n, 1n, 255n, 256n, 100000000n /*1 KAS*/, 123456789012n, (1n << 62n)];
  let pass = 0;
  for (const v of cases) {
    const mine = serializeI64(v, 8);
    const le = Buffer.alloc(8); le.writeBigUInt64LE(v);
    const ok = mine.equals(le);
    if (ok) pass++;
    else console.log(`  MISMATCH v=${v}: serializeI64=${mine.toString('hex')} LE=${le.toString('hex')}`);
  }
  // negative sanity (sompi never negative, but verify sign-magnitude not two's-complement)
  const neg = serializeI64(-1n, 8);
  console.log(`serializeI64(-1,8)=${neg.toString('hex')} (sign-magnitude: 01..00 80, NOT two's-comp ff..ff)`);
  console.log(`byte-match self-test: ${pass}/${cases.length} (serializeI64 == 8-byte LE for positive sompi)`);
  // sample leaf + root
  const samplePk = 'a'.repeat(64);
  console.log(`sample serializeI64(1 KAS,8) = ${serializeI64(100000000n, 8).toString('hex')} (LE: 00e1f505 00000000)`);
  console.log(`sample payoutLeaf(pk=aa..,1KAS) = ${payoutLeaf(samplePk, 100000000n).toString('hex')}`);
  const root = payoutRoot([{ pk: samplePk, amount: 100000000n }, { pk: 'b'.repeat(64), amount: 50000000n }]);
  console.log(`sample payoutRoot(2 winners) = ${root.toString('hex')}`);
  console.log(`depth-8 → max ${CAP} winners total (if >256 winners → SS climb depth must grow; flag for #31)`);

  // —— merkle-proof re-climb self-test: every winner's proof must climb to payoutRoot ——
  // (= EXACT SS climb replica; proof-by-construction → NWT 可直接喂 cli-debugger witnessSiblings)
  const W = [];
  for (let i = 0; i < 20; i++) W.push({ pk: (i + 16).toString(16).padStart(2, '0').repeat(32), amount: BigInt((i + 1) * 1e7) });
  const r2 = payoutRoot(W);
  let climbPass = 0;
  for (let i = 0; i < W.length; i++) {
    const leaf = payoutLeaf(W[i].pk, W[i].amount);
    const proof = merkleProof(W, i);
    if (climbProof(leaf, i, proof).equals(r2)) climbPass++;
    else console.log(`  CLIMB MISMATCH idx=${i}`);
  }
  console.log(`merkle-proof re-climb self-test: ${climbPass}/${W.length} (每 winner proof climb == payoutRoot, = SS climb replica)`);
  // sample witnessSiblings flat (depth-8) for winner idx 0 — the SS winnerSiblings[k*8+lvl] layout
  const p0 = merkleProof(W, 0);
  console.log(`sample winnerSiblings[idx0] flat(8×32B) = [${p0.map(s => s.toString('hex').slice(0, 8)).join(',')}..]`);
}

// —— merkle DATA export for NWT's Rust harness (deterministic half; NWT builds tx + signs) ——
// Emits everything the harness needs EXCEPT tx-building/sigs: payoutRoot(=plan_commit_arg for chunk_0),
// per-winner {pk, amount, siblings[8]} (re-climb verified), + a suggested chunk_0 output layout.
import { writeFileSync } from 'fs';
export function exportChunk0MerkleData(winners, opts = {}) {
  const root = payoutRoot(winners);
  // re-climb verify every winner before export (no bad proof leaves)
  for (let i = 0; i < winners.length; i++) {
    const leaf = payoutLeaf(winners[i].pk, winners[i].amount);
    if (!climbProof(leaf, i, merkleProof(winners, i)).equals(root)) throw new Error(`proof idx ${i} fails re-climb`);
  }
  const data = {
    note: 'J2 deterministic merkle DATA for #31 chunk_0 honest test.json — NWT Rust harness builds tx-context + 4-of-5 sign_tx (calc_schnorr_signature_hash+sign_schnorr+SIG_HASH_ALL byte) on top. ENDIANNESS: amount leaf uses 8-byte LE (serialize_i64). re-climb verified.',
    plan_commit_arg: root.toString('hex'),     // = payoutRoot (committee-signs this in chunk_0 sighash)
    total_winners_arg: winners.length,
    chunk_kind: 0, seg_lo: 0, seg_hi: winners.length,
    winners: winners.map((w, i) => ({
      merkle_index: i,
      pk: w.pk,
      amount_sompi: w.amount.toString(),
      amount_le8_hex: serializeI64(BigInt(w.amount), 8).toString('hex'),
      siblings: merkleProof(winners, i).map(s => s.toString('hex')),  // [8 × 32B hex]
    })),
    maxChunkFee: String(opts.maxChunkFee ?? 100000000),  // V07_MAX_FEE single-source
  };
  const path = opts.out || 'D:\\silverscript\\_j2_chunk0_merkle_data.json';
  writeFileSync(path, JSON.stringify(data, null, 1));
  console.log(`\nexported chunk_0 merkle DATA → ${path} (winners=${winners.length}, payoutRoot=${data.plan_commit_arg.slice(0, 16)}.., re-climb verified)`);
  return data;
}
// sample export: 3-winner chunk_0
exportChunk0MerkleData([
  { pk: '11'.repeat(32), amount: 150000000n },
  { pk: '22'.repeat(32), amount: 120000000n },
  { pk: '33'.repeat(32), amount: 90000000n },
]);
selfTest();
