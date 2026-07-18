// verify-settle-sigs.mjs — settle 签名的离线密码学验证器(Codex MSG-008 条件5, J1tn 2026-07-18)
//
// 目的: settle 广播前, 不靠"新行出现"而是密码学地验证每笔委员签名对 canonical sighash 有效。
// 6/28 gap3 finding 文档就要过"手动 schnorr verify", 一直没有工具——本文件即该工具, 常驻可复用。
//
// ── 方法论: 自校验 oracle 门(computeCloseZkTmplAnchor round-trip 自证同款纪律) ──
// sighash preimage 布局手拼自节点源码 rusty-kaspa consensus/core/src/hashing/sighash.rs
// (本机 D:\rusty-kaspa, 节点实跑 v1.1.1-toc.1 同树)。手拼有编码错风险 → 先过 oracle 门:
// 用两把一次性已知私钥, 走【与 relay 完全相同的】kaspa-wasm createInputSignature 路径对同一笔
// tx 产签, 我的 preimage 算出的 sighash 必须能 schnorr-verify 这两笔真实签名——verify 不过 =
// 我的 preimage != wasm 实际所签 = ABORT(fail-loud, 绝不带着错 preimage 去判委员签名)。
// oracle 过了才对委员 5 签逐笔 verify。失败方向永远是"拒绝/中止", 不存在假阳性放行路径。
//
// 跑法:
//   自测(本机, 合成 fixture):  cd kasia-console && node scripts/verify-settle-sigs.mjs --selftest
//   实战(canonical, jepu1):    node scripts/verify-settle-sigs.mjs --market=<完整market_id> [--input=0]
//     从 DB 读 meta.phase2_tx_obj + pool_committee pks + chain_events 新签名, oracle 门 → 逐签 verify。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dir, '..', 'package.json'));
const { blake2b } = require('@noble/hashes/blake2b');
const { schnorr } = require('@noble/curves/secp256k1');
const kaspa = require('kaspa-wasm');
const { toSettleSafeJsonTxHex } = await import('../src/lib/settle-safe-json.mjs');

const SIGHASH_ALL = 0x01;
const DOMAIN_KEY = Buffer.from('TransactionSigningHash'); // rusty-kaspa crypto/hashes/src/lib.rs:25
const ZERO32 = Buffer.alloc(32);

// ── 低层编码(rusty-kaspa consensus/core/src/hashing/mod.rs, 全 LE) ─────────────
const u8 = (n) => Buffer.from([n & 0xff]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const varBytes = (buf) => Buffer.concat([u64(buf.length), buf]); // write_len=u64 LE + bytes
const keyedHash = (parts) => Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32, key: DOMAIN_KEY }));

// spk 归一: 接受 {version,script} 对象或 flat-hex 字符串(前4 hex=u16 LE version, 余=script)
function normSpk(spk) {
  if (spk && typeof spk === 'object') return { version: Number(spk.version || 0), script: Buffer.from(spk.script, 'hex') };
  const s = String(spk);
  return { version: Buffer.from(s.slice(0, 4), 'hex').readUInt16LE(0), script: Buffer.from(s.slice(4), 'hex') };
}
const hashSpk = (spk) => { const n = normSpk(spk); return Buffer.concat([u16(n.version), varBytes(n.script)]); };

// ── sighash 组装(sighash.rs calc_schnorr_signature_hash, SIGHASH_ALL 路径) ─────
export function calcSchnorrSighash(tx, inputIndex) {
  const version = Number(tx.version || 0);
  const prevOutsHash = keyedHash(tx.inputs.flatMap(i => [
    Buffer.from(i.previousOutpoint.transactionId, 'hex'), u32(Number(i.previousOutpoint.index || 0)),
  ]));
  const sequencesHash = keyedHash(tx.inputs.map(i => u64(i.sequence || 0)));
  const sigOpCountsHash = keyedHash(tx.inputs.map(i => u8(Number(i.sigOpCount ?? 1))));
  const outputsHash = keyedHash(tx.outputs.flatMap(o => {
    const parts = [u64(o.value), hashSpk(o.scriptPublicKey)];
    if (version >= 1) {
      const cov = o.covenant;
      parts.push(u8(cov ? 1 : 0));
      if (cov) parts.push(u16(Number(cov.authorizingInput ?? cov.authorizing_input ?? 0)), Buffer.from(cov.covenantId ?? cov.covenant_id, 'hex'));
    }
    return parts;
  }));
  const payload = Buffer.from(tx.payload || '', 'hex');
  const subnetId = Buffer.from(tx.subnetworkId || '00'.repeat(20), 'hex');
  const isNative = subnetId.equals(Buffer.alloc(20));
  const payloadHash = (isNative && payload.length === 0) ? ZERO32 : keyedHash([varBytes(payload)]);

  const inp = tx.inputs[inputIndex];
  const utxo = inp.utxo;
  if (!utxo) throw new Error(`input ${inputIndex} 无 utxo entry — sighash 需要 prev spk/amount`);

  const parts = [u16(version), prevOutsHash, sequencesHash];
  if (version < 1) parts.push(sigOpCountsHash);
  parts.push(
    Buffer.from(inp.previousOutpoint.transactionId, 'hex'), u32(Number(inp.previousOutpoint.index || 0)),
    hashSpk(utxo.scriptPublicKey),
    u64(utxo.amount), u64(inp.sequence || 0),
  );
  if (version < 1) parts.push(u8(Number(inp.sigOpCount ?? 1)));
  parts.push(outputsHash, u64(tx.lockTime || 0), subnetId, u64(tx.gas || 0), payloadHash, u8(SIGHASH_ALL));
  return keyedHash(parts);
}

// 66B push-encoded sig hex ([0x41][64B schnorr][0x01 SIGHASH_ALL]) → 64B raw; 其它形态 fail-loud
function stripPushEncoding(sigHex) {
  const b = Buffer.from(sigHex, 'hex');
  if (b.length === 66 && b[0] === 0x41 && b[65] === SIGHASH_ALL) return b.subarray(1, 65);
  if (b.length === 65 && b[64] === SIGHASH_ALL) return b.subarray(0, 64);
  if (b.length === 64) return b;
  throw new Error(`签名字节形态不识别: len=${b.length} head=${b[0]?.toString(16)} tail=${b[b.length - 1]?.toString(16)}`);
}

// ── oracle 门: 已知私钥经真实 relay 签名路径背书我的 preimage ─────────────────────
async function oracleGate(plainTxObj, inputIndex) {
  const safe = await toSettleSafeJsonTxHex(plainTxObj);
  const wasmTx = kaspa.Transaction.deserializeFromSafeJSON(safe);
  const myHash = calcSchnorrSighash(plainTxObj, inputIndex);
  const keys = ['11'.repeat(32), '22'.repeat(31) + '23'];
  for (const kHex of keys) {
    const priv = new kaspa.PrivateKey(kHex);
    const sigHex = kaspa.createInputSignature(wasmTx, inputIndex, priv, kaspa.SighashType.All);
    const sig64 = stripPushEncoding(String(sigHex));
    const xonly = schnorr.getPublicKey(kHex); // 32B x-only
    const okSig = schnorr.verify(sig64, myHash, xonly);
    if (!okSig) return { ok: false, reason: `oracle FAIL: 我的 preimage 验不过 wasm 真实签名(key=${kHex.slice(0, 4)}…) — preimage 布局/编码与节点不符, ABORT` };
  }
  return { ok: true, sighash: myHash.toString('hex') };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
let pass = 0, fail = 0;
const report = (name, cond, detail = '') => { if (cond) { pass++; console.log(`✅ ${name}${detail ? ' ' + detail : ''}`); } else { fail++; console.error(`❌ ${name} ${detail}`); } };

if (args.selftest) {
  // 合成 fixture: 1-in-1-out, 结构与 pool settle tx 同款字段面
  const fixture = {
    version: 0, lockTime: 0, gas: 0, subnetworkId: '00'.repeat(20), payload: '',
    inputs: [{
      previousOutpoint: { transactionId: 'aa'.repeat(32), index: 1 },
      signatureScript: '', sequence: 0, sigOpCount: 1,
      utxo: {
        address: 'kaspatest:qzdh7nar8wnq4nsag835qv563zkc5q8pufjeq3fcc2nq337mrr04wcfjx6f6u',
        outpoint: { transactionId: 'aa'.repeat(32), index: 1 },
        amount: 5000000000, scriptPublicKey: '0000' + '20' + 'cd'.repeat(32) + 'ac',
        blockDaaScore: 61000000, isCoinbase: false,
      },
    }],
    outputs: [{ value: 4990000000, scriptPublicKey: '0000' + '20' + 'ef'.repeat(32) + 'ac' }],
  };
  const gate = await oracleGate(fixture, 0);
  report('oracle 门(自测 fixture, 双一次性私钥)', gate.ok, gate.ok ? `sighash=${gate.sighash.slice(0, 16)}…` : gate.reason);
} else if (args.market) {
  const Database = require('better-sqlite3');
  const db = new Database(join(__dir, '..', 'data', 'console.db'), { readonly: true });
  const inputIndex = Number(args.input ?? 0);
  const m = db.prepare('SELECT id, metadata FROM pool_markets WHERE id = ?').get(args.market);
  if (!m) { console.error(`market ${args.market} 不在本库`); process.exit(1); }
  const meta = JSON.parse(m.metadata || '{}');
  if (!meta.phase2_tx_obj) { console.error('无 phase2_tx_obj'); process.exit(1); }
  const commRow = db.prepare('SELECT committee_pks FROM pool_committee WHERE market_id = ?').get(m.id);
  const committee = JSON.parse(commRow?.committee_pks || '[]').map(p => String(p).toLowerCase());
  const sigRows = db.prepare(`SELECT payload FROM chain_events WHERE event_type='pool_oracle_tx_sig' AND payload LIKE ?`).all(`%"market_id":"${m.id}"%`);
  const sigs = sigRows.map(r => JSON.parse(r.payload)).filter(p => Number(p.input_index) === inputIndex);
  console.log(`market=${m.id.slice(-12)} committee=${committee.length} sigs(input${inputIndex})=${sigs.length}`);

  const gate = await oracleGate(meta.phase2_tx_obj, inputIndex);
  report('oracle 门(真实 phase2_tx_obj, 双一次性私钥)', gate.ok, gate.ok ? `sighash=${gate.sighash}` : gate.reason);
  if (!gate.ok) { console.error('\n🔴 ABORT: oracle 未过, 不对委员签名下任何判定'); process.exit(2); }

  const myHash = Buffer.from(gate.sighash, 'hex');
  for (const s of sigs) {
    const pk = String(s.voter_pubkey).toLowerCase();
    let verdict = false, note = '';
    try { verdict = schnorr.verify(stripPushEncoding(s.signature), myHash, Buffer.from(pk, 'hex')); }
    catch (e) { note = e.message; }
    report(`委员 ${pk.slice(0, 8)}… 签名 schnorr-verify`, verdict, note);
    if (verdict && !committee.includes(pk)) report(`委员 ${pk.slice(0, 8)}… ∈ committee 集合`, false, '签名有效但 pk 不在委员表!');
  }
  db.close();
} else {
  console.log('用法: --selftest | --market=<market_id> [--input=0]'); process.exit(1);
}

console.log(fail === 0 ? `\n✅ ALL PASS (${pass})` : `\n❌ ${fail} FAIL / ${pass} pass`);
process.exit(fail === 0 ? 0 : 1);
