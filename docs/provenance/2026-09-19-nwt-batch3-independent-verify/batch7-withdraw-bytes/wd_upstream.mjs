// NWT 批7 withdraw: 链上字节验证 —— 自写解析器解出参数 → patched cli-debugger(上游编码器与 VM)。
//  (1) KanetTokenClaim.spend: action 字节 == 链上; VM 对真实 tx PASS; 三条负向臂(翻 1 bit 签名 / dest_idx 指代币输出 / to_market_input=true)必 FAIL
//  (2) held KTT transfer(owner_input_idx=[0]): action 字节 == 链上; VM PASS
//  (3) 自移植 sighash 验 KTC 签名(winner_pk) + 反向臂(去掉 out[0] covenant)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parsePushes } from './decode_pushes.mjs';
import { sighashAll, verify } from './sighash_port.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const LIB = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/';
const T = JSON.parse(readFileSync(D + 'withdraw_txs.json', 'utf8'));
const CD = JSON.parse(readFileSync(D + 'claimdraw_txs.json', 'utf8'));
const tx = T['39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508'];
const H = (b) => '0x' + Buffer.from(b).toString('hex');
const k = JSON.parse(readFileSync(D + 'wd_ktc_ctor.json', 'utf8'));
const ktcCtor = [H(Buffer.from(k.mkt, 'hex')), H(Buffer.from(k.winner, 'hex')), Number(k.amount), H(Buffer.from(k.tokTmpl, 'hex'))];
const par = (i) => T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index];
const inputsFx = (active) => tx.inputs.map((i, n) => { const p = par(i); const o = { prev_txid: i.previousOutpoint.transactionId, prev_index: i.previousOutpoint.index, sequence: 0, utxo_value: Number(p.value), ...(p.covenant ? { covenant_id: p.covenant.covenantId } : {}) }; if (n !== active) { o.utxo_script_hex = p.scriptPublicKey.slice(4); o.signature_script_hex = i.signatureScript; } return o; });
const outputsFx = tx.outputs.map((o) => ({ value: Number(o.value), script_hex: o.scriptPublicKey.slice(4), ...(o.covenant ? { covenant_id: o.covenant.covenantId, authorizing_input: o.covenant.authorizingInput } : {}) }));
function run(sil, fx, name) {
  writeFileSync(D + `wdu_${name}.json`, JSON.stringify(fx));
  const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', [sil, '--test-file', D + `wdu_${name}.json`, '--test-name', name, '--run'], { maxBuffer: 1 << 28 });
  const err = r.stderr.toString(); const m = err.match(/J2_DEBUG active_sigscript_hex=([0-9a-f]+)/);
  const why = err.split('\n').filter((l) => /error:|verification failed|require|failed here/.test(l)).slice(0, 3).join(' | ').slice(0, 260);
  return { status: r.status, out: r.stdout.toString().split('\n')[0].slice(0, 80), action: m ? m[1] : null, why };
}
const actionOf = (inp, redeemLen) => { const b = Buffer.from(inp.signatureScript, 'hex'); const hdr = redeemLen > 255 ? 3 : 2; return b.subarray(0, b.length - redeemLen - hdr).toString('hex'); };
const num = (p) => (p.kind === 'OP_0' ? 0 : p.small !== undefined ? p.small : Number(p.data.length ? BigInt('0x' + Buffer.from(p.data).reverse().toString('hex')) : 0n));
const flip = (h) => { const b = Buffer.from(h.slice(2), 'hex'); b[0] ^= 1; return H(b); };

// ---- (1) KanetTokenClaim.spend
const ps0 = parsePushes(tx.inputs[0].signatureScript); const redeemLen0 = ps0[ps0.length - 1].data.length;
const sig = H(ps0[0].data);
const base = { s: sig, tokIn: num(ps0[1]), tokOut: num(ps0[2]), toMkt: num(ps0[3]) !== 0, dest: num(ps0[4]), pre: H(ps0[5].data), suf: H(ps0[6].data) };
console.log('decoded: tok_in_idx', base.tokIn, 'tok_out_idx', base.tokOut, 'to_market_input', base.toMkt, 'dest_idx', base.dest, 'tok_prefix', ps0[5].data.length, 'B tok_suffix', ps0[6].data.length, 'B');
const spendTest = (name, a, expect) => ({ tests: [{ name, function: 'spend', constructor_args: ktcCtor, args: [a.s, a.tokIn, a.tokOut, a.toMkt, a.dest, a.pre, a.suf], expect, tx: { version: 1, lock_time: 0, active_input_index: 0, inputs: inputsFx(0), outputs: outputsFx } }] });
{
  const r = run(LIB + 'KanetTokenClaim.sil', spendTest('ktc', base, 'pass'), 'ktc');
  console.log('KTC.spend: upstream-encoded action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx.inputs[0], redeemLen0));
  console.log('KTC.spend: upstream VM on REAL tx =>', r.status === 0 ? 'PASS' : 'FAIL', r.out, r.why);
  const arms = [
    ['NEG1 signature 1 bit flipped', { ...base, s: flip(sig) }],
    ['NEG2 dest_idx=0 (points at token output, owner would be its own covenant id)', { ...base, dest: 0 }],
    ['NEG3 to_market_input=true (owner := OpInputCovenantId(1) = held KTT covenant)', { ...base, toMkt: true }],
    ['NEG4 tok_in_idx=2 (fee input is not a token)', { ...base, tokIn: 2 }],
  ];
  for (const [label, a] of arms) { const rr = run(LIB + 'KanetTokenClaim.sil', spendTest('neg', a, 'pass'), 'neg'); console.log('  ' + label + ' => VM', rr.status === 0 ? 'PASS (UNEXPECTED)' : 'FAIL (expected)', '|', rr.why.slice(0, 160)); }
}
// ---- (2) held KTT transfer (input 1)
{
  const ps = parsePushes(tx.inputs[1].signatureScript); const redeemLen = ps[ps.length - 1].data.length;
  const kk = JSON.parse(readFileSync(D + 'wd_ctor_held.json', 'utf8'));
  const tctor = [Number(kk[0].value), H(Buffer.from(kk[1].value)), 4, 0, H(Buffer.from(kk[4].value)), H(Buffer.from(kk[5].value)), 3, 3];
  const fx = { tests: [{ name: 'held', function: 'transfer', constructor_args: tctor, args: [[], '0x', [0]], expect: 'pass', tx: { version: 1, lock_time: 0, active_input_index: 1, inputs: inputsFx(1), outputs: outputsFx } }] };
  const r = run(LIB + 'sil-v1/KanetTestToken.sil', fx, 'held');
  console.log('\nheld KTT.transfer(next_states=[], witness=0x, owner_input_idx=[0]): upstream action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx.inputs[1], redeemLen));
  console.log('held KTT.transfer: upstream VM on REAL tx =>', r.status === 0 ? 'PASS' : 'FAIL', r.out, r.why);
  const fx2 = { tests: [{ name: 'held2', function: 'transfer', constructor_args: tctor, args: [[], '0x', [2]], expect: 'pass', tx: { version: 1, lock_time: 0, active_input_index: 1, inputs: inputsFx(1), outputs: outputsFx } }] };
  const r2 = run(LIB + 'sil-v1/KanetTestToken.sil', fx2, 'held2');
  console.log('  NEG owner_input_idx=[2] (fee input, no covenant id) => VM', r2.status === 0 ? 'PASS (UNEXPECTED)' : 'FAIL (expected)', '|', r2.why.slice(0, 160));
}
// ---- (3) sighash port on the KTC signature
{
  const d = { version: tx.version, lockTime: BigInt(tx.lockTime), inputs: tx.inputs.map((i) => { const p = par(i); return { txid: i.previousOutpoint.transactionId, index: i.previousOutpoint.index, sequence: BigInt(i.sequence), spkHex: p.scriptPublicKey.slice(4), amount: BigInt(p.value) }; }), outputs: tx.outputs.map((o) => ({ value: BigInt(o.value), spkHex: o.scriptPublicKey.slice(4), covenant: o.covenant ? { auth: o.covenant.authorizingInput, id: o.covenant.covenantId } : null })) };
  const s64 = ps0[0].data.subarray(0, 64).toString('hex');
  console.log('\nKTC sig (hashtype byte 0x' + ps0[0].data[64].toString(16) + ') vs my sighash port (input 0) with winner_pk:', verify(s64, sighashAll(d, 0), k.winner));
  const d2 = { ...d, outputs: d.outputs.map((o, n) => (n === 0 ? { ...o, covenant: null } : o)) };
  console.log('reverse arm (out[0] covenant stripped):', verify(s64, sighashAll(d2, 0), k.winner));
  const d3 = { ...d, outputs: d.outputs.map((o, n) => (n === 1 ? { ...o, spkHex: o.spkHex.replace(/e/g, 'd') } : o)) };
  console.log('reverse arm (destination out[1] spk altered):', verify(s64, sighashAll(d3, 0), k.winner));
  const cdRoot = Object.values(CD).find((t) => t.inputs.length === 4 && t.outputs.length === 3);
  const rcIn = CD['0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f'].inputs[0].previousOutpoint;
  const rcCov = CD[rcIn.transactionId]?.outputs[rcIn.index]?.covenant?.covenantId;
  console.log('KTC.market_cov_id == RootClaim covenant_id spent by claim_draw (batch 6) =>', rcCov ? rcCov === k.mkt : 'n/a (parent not in batch-6 fetch)', rcCov ? rcCov.slice(0, 8) + '…' : '');
}
