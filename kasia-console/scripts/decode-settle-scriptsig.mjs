// decode-settle-scriptsig.mjs — settle scriptSig 逐 push 解码 + 位置性全量比对(J1tn 2026-07-18)
//
// 用途: 把 p2sh.mjs:979 日志里 dump 的实际提交 scriptSig hex, 按 unlockPoolSpineP2SH 的组装布局
// (v0.6/v0.7 settle_aggregate, p2sh.mjs:944-976)逐 push 解码, 并对 canonical DB 期望值逐项比对:
//   ①5×66B sigs(位置 c0..c4)→ 逐位置 schnorr.verify(sig[i], sighash, pk[i]) ← 位置性配对终判
//   ②committeePkHash(32B) ③winner op ④sidesMerkleRoot(32B) ⑤5×pk(32B, c0..c4)
//   ⑥5×index(op/scriptnum) ⑦[v0.7] globalYes/globalNo(CScriptNum)+global_commit_id(32B)
//   ⑧5×8 siblings(32B) ⑨selector ⑩redeem push(与 meta.spine_redeem_script_hex 比对)
// 任何一项错位/值差/验签 false = 死点当场可见, 不再猜。
//
// 跑法(canonical): cd kasia-console && node scripts/decode-settle-scriptsig.mjs --market=<id> \
//   --scriptsig=<hex 或 @文件路径> --sighash=<64hex(如 ad7eb3a1..., 即离线验证的 input0 sighash)>
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const __dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dir, '..', 'package.json'));
const { schnorr } = require('@noble/curves/secp256k1');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
let pass = 0, fail = 0;
const report = (name, cond, detail = '') => { if (cond) { pass++; console.log(`✅ ${name}${detail ? ' ' + detail : ''}`); } else { fail++; console.error(`❌ ${name} ${detail}`); } };

let sigHex = String(args.scriptsig || '');
if (sigHex.startsWith('@')) sigHex = readFileSync(sigHex.slice(1), 'utf8').trim();
if (!/^[0-9a-fA-F]+$/.test(sigHex)) { console.error('scriptsig 非纯 hex'); process.exit(1); }
const buf = Buffer.from(sigHex, 'hex');

// ── 通用 push 流解析(minimal push + OP_0/OP_1..16 + PUSHDATA1/2) ────────────────
const items = [];
let off = 0;
while (off < buf.length) {
  const op = buf[off];
  if (op === 0x00) { items.push({ type: 'op0', off, hex: '' }); off += 1; }
  else if (op >= 0x51 && op <= 0x60) { items.push({ type: 'opN', off, n: op - 0x50, hex: '' }); off += 1; }
  else if (op >= 1 && op <= 75) { items.push({ type: 'push', off, hex: buf.subarray(off + 1, off + 1 + op).toString('hex') }); off += 1 + op; }
  else if (op === 0x4c) { const n = buf[off + 1]; items.push({ type: 'push', off, hex: buf.subarray(off + 2, off + 2 + n).toString('hex') }); off += 2 + n; }
  else if (op === 0x4d) { const n = buf.readUInt16LE(off + 1); items.push({ type: 'push', off, hex: buf.subarray(off + 3, off + 3 + n).toString('hex') }); off += 3 + n; }
  else { items.push({ type: `raw_0x${op.toString(16)}`, off, hex: '' }); off += 1; }
}
console.log(`scriptSig ${buf.length}B → ${items.length} 个 stack items`);

// CScriptNum decode(minimal LE, 高位符号)
const scriptNum = (hex) => {
  if (hex === '') return 0n;
  const b = Buffer.from(hex, 'hex');
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(i === b.length - 1 ? b[i] & 0x7f : b[i]);
  return (b[b.length - 1] & 0x80) ? -v : v;
};
const itemVal = (it) => it.type === 'op0' ? 0n : it.type === 'opN' ? BigInt(it.n) : scriptNum(it.hex);

// ── DB 期望值 ──────────────────────────────────────────────────────────────────
const Database = require('better-sqlite3');
const db = new Database(join(__dir, '..', 'data', 'console.db'), { readonly: true });
const m = db.prepare('SELECT id, metadata, sides_merkle_root FROM pool_markets WHERE id = ?').get(args.market);
if (!m) { console.error(`market ${args.market} 不在本库`); process.exit(1); }
const meta = JSON.parse(m.metadata || '{}');
const exp = {
  pks: (meta.phase2_committee_pks || []).map(p => String(p).toLowerCase()),
  pkHash: String(meta.phase2_committee_pk_hash || '').toLowerCase(),
  indices: meta.phase2_committee_indices || [],
  proofs: meta.phase2_committee_merkle_proofs || [],
  winner: Number(meta.phase2_winner ?? -1),
  root: String(m.sides_merkle_root || '').toLowerCase().replace(/^0x/, ''),
  gYes: BigInt(meta.phase2_global_yes_sompi ?? -1),
  gNo: BigInt(meta.phase2_global_no_sompi ?? -1),
  gCommit: String(meta.phase2_global_commit_id || '').toLowerCase(),
  redeem: String(meta.spine_redeem_script_hex || '').toLowerCase(),
};
db.close();

// ── 按组装布局(p2sh.mjs:944-976 声明序)映射 ─────────────────────────────────────
let i = 0;
const next = () => items[i++];
// ① sigs c0..c4 — 66B push-encoded 整体是一个 push? 注意: createInputSignature 输出 '41'+sig64+'01'
//   是【已 push 编码】的 66B(0x41=push65: 64B sig+1B type)。组装直接拼 hex → 解析器读出 65B push。
const sigs = [];
for (let k = 0; k < 5; k++) { const it = next(); sigs.push(it.hex); report(`item[${k}] = sig c${k}(65B push)`, it.type === 'push' && it.hex.length === 130, `got ${it.type}/${it.hex.length / 2}B`); }
// ② committeePkHash
{ const it = next(); report('committeePkHash 值==meta', it.hex === exp.pkHash, `got ${it.hex.slice(0, 12)} exp ${exp.pkHash.slice(0, 12)}`); }
// ③ winner
{ const it = next(); report(`winner==${exp.winner}`, Number(itemVal(it)) === exp.winner, `got ${itemVal(it)}`); }
// ④ sidesMerkleRoot
{ const it = next(); report('sidesMerkleRoot==market', it.hex === exp.root, `got ${it.hex.slice(0, 12)} exp ${exp.root.slice(0, 12)}`); }
// ⑤ pks c0..c4
const posPks = [];
for (let k = 0; k < 5; k++) { const it = next(); posPks.push(it.hex.toLowerCase()); report(`pk[c${k}]==meta 序`, it.hex.toLowerCase() === exp.pks[k], `got ${it.hex.slice(0, 8)} exp ${exp.pks[k]?.slice(0, 8)}`); }
// ⑥ indices c0..c4
for (let k = 0; k < 5; k++) { const it = next(); report(`idx[c${k}]==${exp.indices[k]}`, Number(itemVal(it)) === Number(exp.indices[k]), `got ${itemVal(it)}`); }
// ⑦ v0.7 globals(若 meta 有)
if (meta.phase2_global_yes_sompi !== undefined && meta.phase2_global_yes_sompi !== null) {
  { const it = next(); report(`globalYes==${exp.gYes}`, itemVal(it) === exp.gYes, `got ${itemVal(it)}`); }
  { const it = next(); report(`globalNo==${exp.gNo}`, itemVal(it) === exp.gNo, `got ${itemVal(it)}`); }
  { const it = next(); report('global_commit_id==meta', it.hex.toLowerCase() === exp.gCommit, `got ${it.hex.slice(0, 12)} exp ${exp.gCommit.slice(0, 12)}`); }
} else { console.log('(meta 无 globals — v0.6 形态, 跳 ⑦)'); }
// ⑧ siblings 5×8
for (let c = 0; c < 5; c++) for (let d = 0; d < 8; d++) {
  const it = next();
  const expSib = String(exp.proofs?.[c]?.[d] || '').toLowerCase();
  if (it.hex.toLowerCase() !== expSib) report(`sib[c${c}][${d}]`, false, `got ${it.hex.slice(0, 8)} exp ${expSib.slice(0, 8)}`);
}
report('siblings 5×8 全==meta(仅列差异)', true);
// ⑨ selector + ⑩ redeem
{ const it = next(); report('selector=OP_0(entry0)', it.type === 'op0', `got ${it.type}`); }
{ const it = next(); report('redeem push==meta.spine_redeem_script_hex', it.hex.toLowerCase() === exp.redeem, `len got ${it.hex.length / 2} exp ${exp.redeem.length / 2}`); }
report('无多余尾部 items', i === items.length, `consumed ${i}/${items.length}`);

// ── 位置性验签(终判) ───────────────────────────────────────────────────────────
const sighashHex = String(args.sighash || '');
if (/^[0-9a-f]{64}$/i.test(sighashHex)) {
  const msg = Buffer.from(sighashHex, 'hex');
  for (let k = 0; k < 5; k++) {
    const raw = Buffer.from(sigs[k], 'hex');           // 65B: 64B sig + 1B sighashType
    const sig64 = raw.subarray(0, 64);
    const stOk = raw[64] === 0x01;
    let v = false; try { v = schnorr.verify(sig64, msg, Buffer.from(posPks[k], 'hex')); } catch {}
    report(`位置性验签 sig[c${k}] ↔ pk[c${k}](${posPks[k].slice(0, 8)}…)`, v && stOk, v ? (stOk ? '' : 'sighashType≠0x01') : 'schnorr FALSE ← 死点候选');
  }
} else console.log('(未给 --sighash, 跳位置性验签)');

console.log(fail === 0 ? `\n✅ ALL PASS (${pass}) — scriptSig 与期望完全一致, 死点不在 witness 层` : `\n❌ ${fail} FAIL / ${pass} pass — 差异项=死点候选`);
process.exit(fail === 0 ? 0 : 1);
