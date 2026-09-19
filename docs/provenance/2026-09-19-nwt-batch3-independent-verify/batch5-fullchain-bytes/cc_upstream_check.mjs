// NWT: 对链上 close_commit / convert_to_claim 的 sigScript action 做字节验证: 自写解析器解出参数 → 喂 patched cli-debugger(上游 Rust 编码器) → 比 action; close_commit 另跑完整 VM(真实 tx/签名)。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parsePushes } from './decode_pushes.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const T = JSON.parse(readFileSync(D + 'fullchain_txs.json', 'utf8'));
const CC = '9e3398a6b9d61c81b255f8a8ecbdd85d07e736fa42f684529acb15ab41f68570', CL = '1b1133ebb096379cbcbdc29c48716f21516383397c8dae747ebcf2c2172ef983';
const toHex = (b) => '0x' + Buffer.from(b).toString('hex');
const ctorRaw = (f) => JSON.parse(readFileSync(D + f, 'utf8')).map((n) => (n.kind === 'bytes' ? toHex(n.value) : n.value));
const num = (p) => Number(p.kind === 'OP_0' ? 0 : (p.small ?? 0));
function runDbg(fx, name) {
  writeFileSync(D + `upc_${name}.json`, JSON.stringify(fx));
  const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/RootClose.sil', '--test-file', D + `upc_${name}.json`, '--test-name', name, '--run'], { maxBuffer: 1 << 28 });
  const err = r.stderr.toString(); const m = err.match(/J2_DEBUG active_sigscript_hex=([0-9a-f]+)/);
  return { status: r.status, out: r.stdout.toString().split('\n')[0].slice(0, 100), action: m ? m[1] : null };
}
const actionOf = (tx, redeemLen) => Buffer.from(tx.inputs[0].signatureScript, 'hex').subarray(0, Buffer.from(tx.inputs[0].signatureScript, 'hex').length - redeemLen - 3).toString('hex');
// ---- close_commit
{
  const tx = T[CC]; const ps = parsePushes(tx.inputs[0].signatureScript); const redeemLen = ps[ps.length - 1].data.length;
  const args = [...ps.slice(0, 5).map((p) => toHex(p.data)), ...ps.slice(5, 10).map((p) => toHex(p.data)), num(ps[10]), num(ps[11]), toHex(ps[12].data), toHex(ps[13].data), toHex(ps[14].data)];
  const ctor0 = ctorRaw('rc_ctor_close.json'); // closed=0 版
  const ctorNew = [...ctor0.slice(0, 9), 1, num(ps[11]), toHex(ps[12].data)];
  const fx = { tests: [{ name: 'cc', function: 'close_commit', constructor_args: ctor0, args, expect: 'pass',
    tx: { version: 1, lock_time: Number(tx.lockTime), active_input_index: 0,
      inputs: tx.inputs.map((i, k) => { const par = T[i.previousOutpoint.transactionId].outputs[i.previousOutpoint.index]; return { prev_txid: i.previousOutpoint.transactionId, prev_index: i.previousOutpoint.index, sequence: 0, utxo_value: Number(par.value), ...(k === 0 ? { covenant_id: par.covenant.covenantId } : {}) }; }),
      outputs: tx.outputs.map((o, k) => (k === 0 ? { value: Number(o.value), covenant_id: o.covenant.covenantId, authorizing_input: o.covenant.authorizingInput, constructor_args: ctorNew } : { value: Number(o.value), script_hex: o.scriptPublicKey.slice(4) })) } }] };
  const r = runDbg(fx, 'cc');
  console.log('close_commit: upstream VM on REAL on-chain tx + REAL committee sigs =>', r.status === 0 ? 'PASS' : 'FAIL', r.out);
  console.log('close_commit: upstream-encoded action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx, redeemLen));
}
// ---- convert_to_claim (只比编码; 执行需 RootClaim 外部模板输出, 不在本检范围)
{
  const tx = T[CL]; const ps = parsePushes(tx.inputs[0].signatureScript); const redeemLen = ps[ps.length - 1].data.length;
  const args = [num(ps[0]), toHex(ps[1].data), toHex(ps[2].data), num(ps[3]), num(ps[4]), toHex(ps[5].data), toHex(ps[6].data)];
  const ctor1 = ctorRaw('rc_ctor_conve.json');
  const fx = { tests: [{ name: 'cl', function: 'convert_to_claim', constructor_args: ctor1, args, expect: 'fail', tx: { version: 1, lock_time: 0, active_input_index: 0, inputs: [{ utxo_value: 20000000 }], outputs: [{ value: 20000000 }] } }] };
  const r = runDbg(fx, 'cl');
  console.log('convert_to_claim: upstream-encoded action == on-chain action (', r.action ? r.action.length / 2 : 'n/a', 'B ) =>', r.action === actionOf(tx, redeemLen));
}
