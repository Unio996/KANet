// NWT: 用 pinned silverc-v100 独立重编 RootClose(两笔链上花费的 redeem: close_commit 的 closed=0 版, convert_to_claim 的 closed=1 版), 逐字节对链上 redeem; 落 ABI。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { blake2b } from '@noble/hashes/blake2b';
import { parsePushes, scriptNum } from './decode_pushes.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const SC = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
if (createHash('sha256').update(readFileSync(SC)).digest('hex') !== '4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643') throw new Error('silverc sha mismatch');
const T = JSON.parse(readFileSync(D + 'fullchain_txs.json', 'utf8'));
const CC = '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', CL = '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983';
const SIL = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/RootClose.sil'; // J2 44081d5e 检出(仅取 .sil 源)
const B = (h) => ({ kind: 'bytes', value: [...Buffer.from(h, 'hex')] }); const I = (n) => ({ kind: 'int', value: Number(n) });
const TOKEN_TMPL = '225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e';
function leadingState(redeem) { // 6b then 7 state fields: 6 × (08+8B) + (20+32B)
  let i = 1; const ints = []; for (let k = 0; k < 6; k++) { if (redeem[i] !== 0x08) throw new Error('state int marker'); ints.push(redeem.readBigInt64LE(i + 1)); i += 9; }
  if (redeem[i] !== 0x20) throw new Error('state root marker'); const root = redeem.subarray(i + 1, i + 33); return { ints, root: root.toString('hex') };
}
function findConsts(redeem) { const out = new Map(); let i = 0; while (i < redeem.length) { const op = redeem[i]; if (op >= 1 && op <= 0x4b) { if (op === 32) out.set(redeem.subarray(i + 1, i + 33).toString('hex'), i); i += 1 + op; } else i += 1; } return out; }
function compile(ctor, tag) { writeFileSync(D + `rc_ctor_${tag}.json`, JSON.stringify(ctor)); execFileSync(SC, [SIL, '--ctor', D + `rc_ctor_${tag}.json`, '-o', D + `rc_out_${tag}.json`], { stdio: 'pipe' }); return JSON.parse(readFileSync(D + `rc_out_${tag}.json`, 'utf8')).contracts.RootClose; }
let abiOut = null;
for (const [label, id] of [['close_commit(closed=0)', CC], ['convert_to_claim(closed=1)', CL]]) {
  const tx = T[id]; const ps = parsePushes(tx.inputs[0].signatureScript); const redeem = ps[ps.length - 1].data;
  const pks = label.startsWith('close') ? ps.slice(0, 5).map((p) => p.data) : null;
  const ccTx = T[CC]; const pk5 = parsePushes(ccTx.inputs[0].signatureScript).slice(0, 5).map((p) => p.data);
  const committeeHash = Buffer.from(blake2b(Buffer.concat(pk5), { dkLen: 32 })).toString('hex');
  const st = leadingState(redeem); const deadline = BigInt(ccTx.lockTime);
  const consts = findConsts(redeem); const unknown = [...consts.keys()].filter((h) => h !== committeeHash && h !== TOKEN_TMPL && !/^0+$/.test(h) && h !== st.root);
  console.log(`\n== ${label}: redeem ${redeem.length}B state ints=${st.ints.map(String)} root=${st.root.slice(0, 8)}… committee_hash in redeem=${consts.has(committeeHash)} token_hash in redeem=${consts.has(TOKEN_TMPL)} unknown32B=${unknown.length}`);
  let matched = false;
  for (const perm of [[unknown[0], unknown[1]], [unknown[1], unknown[0]]]) {
    if (!perm[0] || !perm[1]) continue;
    const ctor = [B(committeeHash), I(deadline), B(perm[0]), B(perm[1]), B(TOKEN_TMPL), ...st.ints.map(I), B(st.root)];
    const c = compile(ctor, label.slice(0, 5)); const bc = Buffer.from(c.compiled.bytecode);
    const eq = bc.equals(redeem); console.log(`   try order [claim,refund]=[${perm[0].slice(0, 8)},${perm[1].slice(0, 8)}] len ${bc.length} BYTE-EQUAL = ${eq}`);
    if (eq) { matched = true; abiOut ??= {}; abiOut[label] = { entries: Object.fromEntries(Object.entries(c.entries).map(([k, v]) => [k, { tag: v.dispatch_tag, params: v.params.map((p) => `${p.name}:${p.type.kind}`) }])) }; break; }
  }
  if (!matched) console.log('   NO MATCH');
}
console.log('\nABI (pinned silverc):', JSON.stringify(abiOut, null, 1).slice(0, 1800));
