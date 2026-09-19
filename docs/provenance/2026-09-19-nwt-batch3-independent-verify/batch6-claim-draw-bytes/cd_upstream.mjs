// NWT: claim_draw 链上字节验证 —— 自写解析器解出参数 → patched cli-debugger(上游编码器与 VM)。
//  (1) ticket authorize_spend: action 字节相等 + VM 对真实 tx + 真实 bettor 签名 PASS  (2) RootClaim claim_draw: action 字节相等 + VM 对真实 tx PASS/FAIL  (3) 自移植 sighash 验 ticket 签名
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parsePushes } from './decode_pushes.mjs';
import { sighashAll, verify } from './sighash_port.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const LIB = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/';
const T = JSON.parse(readFileSync(D + 'claimdraw_txs.json', 'utf8'));
const tx = T['0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f'];
const H = (b) => '0x' + Buffer.from(b).toString('hex');
const num = (p) => (p.kind === 'OP_0' ? 0 : p.small !== undefined ? p.small : Number(p.data.length ? BigInt('0x' + Buffer.from(p.data).reverse().toString('hex')) : 0n));
const rc = JSON.parse(readFileSync(D + 'cd_rootclaim_ctor.json', 'utf8')); const tk = JSON.parse(readFileSync(D + 'cd_ticket_ctor.json', 'utf8'));
const rcCtor = [H(Buffer.from(rc[0], 'hex')), H(Buffer.from(rc[1], 'hex')), ...rc[2].map(Number), H(Buffer.from(rc[3], 'hex')), Number(rc[4]), H(Buffer.from(rc[5], 'hex')), H(Buffer.from(rc[6], 'hex'))];
const tkCtor = [H(Buffer.from(tk[0], 'hex')), Number(tk[1]), Number(tk[2]), H(Buffer.from(tk[3], 'hex'))];
const par = (i) => T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index];
const inputsFx = (active) => tx.inputs.map((i, k) => { const p = par(i); const o = { prev_txid: i.previousOutpoint.transactionId, prev_index: i.previousOutpoint.index, sequence: 0, utxo_value: Number(p.value), ...(p.covenant ? { covenant_id: p.covenant.covenantId } : {}) }; if (k !== active) { o.utxo_script_hex = p.scriptPublicKey.slice(4); o.signature_script_hex = i.signatureScript; } return o; });
const outputsFx = tx.outputs.map((o) => ({ value: Number(o.value), script_hex: o.scriptPublicKey.slice(4), ...(o.covenant ? { covenant_id: o.covenant.covenantId, authorizing_input: o.covenant.authorizingInput } : {}) }));
function run(sil, fx, name) {
  writeFileSync(D + `cdu_${name}.json`, JSON.stringify(fx));
  const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', [sil, '--test-file', D + `cdu_${name}.json`, '--test-name', name, '--run'], { maxBuffer: 1 << 28 });
  const err = r.stderr.toString(); const m = err.match(/J2_DEBUG active_sigscript_hex=([0-9a-f]+)/);
  const why = err.split('\n').filter((l) => /error:|verification failed|require|failed here/.test(l)).slice(0, 3).join(' | ').slice(0, 220);
  return { status: r.status, out: r.stdout.toString().split('\n')[0].slice(0, 80), action: m ? m[1] : null, why };
}
const actionOf = (inp, redeemLen) => { const b = Buffer.from(inp.signatureScript, 'hex'); const hdr = redeemLen > 255 ? 3 : 2; return b.subarray(0, b.length - redeemLen - hdr).toString('hex'); };
// ---- (1) ticket
{
  const ps = parsePushes(tx.inputs[1].signatureScript); const redeemLen = ps[ps.length - 1].data.length;
  const fx = { tests: [{ name: 'tk', function: 'authorize_spend', constructor_args: tkCtor, args: [H(ps[0].data)], expect: 'pass', tx: { version: 1, lock_time: 0, active_input_index: 1, inputs: inputsFx(1), outputs: outputsFx } }] };
  const r = run(LIB + 'sil-v1/PoolSideTicket.sil', fx, 'tk');
  console.log('ticket authorize_spend: upstream VM on REAL tx + REAL bettor sig =>', r.status === 0 ? 'PASS' : 'FAIL', r.out, r.why);
  console.log('ticket authorize_spend: upstream action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx.inputs[1], redeemLen));
  const d = { version: tx.version, lockTime: BigInt(tx.lockTime), inputs: tx.inputs.map((i) => { const p = par(i); return { txid: i.previousOutpoint.transactionId, index: i.previousOutpoint.index, sequence: BigInt(i.sequence), spkHex: p.scriptPublicKey.slice(4), amount: BigInt(p.value) }; }), outputs: tx.outputs.map((o) => ({ value: BigInt(o.value), spkHex: o.scriptPublicKey.slice(4), covenant: o.covenant ? { auth: o.covenant.authorizingInput, id: o.covenant.covenantId } : null })) };
  console.log('ticket sig vs my sighash port (input 1):', verify(ps[0].data.subarray(0, 64).toString('hex'), sighashAll(d, 1), tk[0]));
  const d2 = { ...d, outputs: d.outputs.map((o, k) => (k === 0 ? { ...o, covenant: null } : o)) };
  console.log('reverse arm (output0 covenant stripped):', verify(ps[0].data.subarray(0, 64).toString('hex'), sighashAll(d2, 1), tk[0]));
}
// ---- (2) RootClaim claim_draw
{
  const ps = parsePushes(tx.inputs[0].signatureScript); const redeemLen = ps[ps.length - 1].data.length;
  const vals = ps.slice(0, 16); // 16 params
  const args = [num(vals[0]), num(vals[1]), num(vals[2]), num(vals[3]), num(vals[4]), num(vals[5]), num(vals[6]), num(vals[7]), [], num(vals[9]), num(vals[10]), num(vals[11]), H(vals[12].data), H(vals[13].data), H(vals[14].data), H(vals[15].data)];
  const fx = { tests: [{ name: 'rc', function: 'claim_draw', constructor_args: rcCtor, args, expect: 'pass', tx: { version: 1, lock_time: 0, active_input_index: 0, inputs: inputsFx(0), outputs: outputsFx } }] };
  const r = run(LIB + 'RootClaim.sil', fx, 'rc');
  console.log('RootClaim claim_draw: upstream-encoded action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx.inputs[0], redeemLen));
  console.log('RootClaim claim_draw: upstream VM on REAL tx =>', r.status === 0 ? 'PASS' : 'FAIL', r.out, r.why);
}
