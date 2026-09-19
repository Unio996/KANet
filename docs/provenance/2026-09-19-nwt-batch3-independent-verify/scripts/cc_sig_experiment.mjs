// NWT 批4离线审: J2 buildCloseCommitTxJson 的"先签后挂 covenant"顺序 vs 上游 VM(cli-debugger)。
// 复刻 J2 的时序: presign 时输出无 covenant → createInputSignature; 最终 tx 才有 covenant(authorizing_input=0, covenant_id 不变)。
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fixture, priv, DEADLINE } from './cc_fixture.mjs';
const kaspa = await import('kaspa-wasm');
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
// 先跑一遍占位夹具, 从调试器的 J2_TX_DEBUG 转储里读出【本次密钥下】真实的 utxo/输出 spk(spk 随委员公钥变, 不能硬编码)
writeFileSync(D + 'cc_probe.json', JSON.stringify(fixture({ sigs: Array(5).fill('0x' + '00'.repeat(65)), name: 'nwt_cc_probe' })));
const pr = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/src/lib/RootClose.sil', '--test-file', D + 'cc_probe.json', '--test-name', 'nwt_cc_probe', '--run'], { maxBuffer: 1 << 26 });
const perr = pr.stderr.toString();
const P2SH_IN = perr.match(/utxo\[0\] amount=20000000 spk_version=0 spk_script_hex=([0-9a-f]+)/)[1];
const P2SH_OUT = perr.match(/output\[0\] value=20000000 spk_version=0 spk_script_hex=([0-9a-f]+)/)[1];
const spkIn = new kaspa.ScriptPublicKey(0, P2SH_IN);
const mkIn = (txid, amt) => { const op = { transactionId: txid, index: 0 }; return { previousOutpoint: op, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 1, utxo: { outpoint: op, amount: amt, scriptPublicKey: spkIn, blockDaaScore: 0n } }; };
function signedHex({ withCovenant }) {
  const out = new kaspa.TransactionOutput(20000000n, new kaspa.ScriptPublicKey(0, P2SH_OUT));
  if (withCovenant) out.covenant = new kaspa.CovenantBinding(0, new kaspa.Hash('ab'.repeat(32)));
  const tx = new kaspa.Transaction({ version: 1, inputs: [mkIn('00'.repeat(32), 20000000n), mkIn('01'.repeat(32), 95000000n)], outputs: [out], lockTime: BigInt(DEADLINE), subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
  const r = kaspa.createInputSignature(tx, 0, priv, kaspa.SighashType.All);
  const h = r.startsWith('0x') ? r.slice(2) : r;
  return '0x' + h.slice(2); // 去掉 0x41 push 前缀 → 65B
}
function run(label, sigHex, covenantOnOutput) {
  const name = 'nwt_cc_' + label;
  writeFileSync(D + `cc_${label}.json`, JSON.stringify(fixture({ sigs: Array(5).fill(sigHex), covenantOnOutput, name })));
  const r = spawnSync('D:/silverscript-debugger-3ed9733-eprintln/target/release/cli-debugger.exe', ['D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/src/lib/RootClose.sil', '--test-file', D + `cc_${label}.json`, '--test-name', name, '--run'], { maxBuffer: 1 << 26 });
  const out = r.stdout.toString().split('\n').slice(0, 3).join(' | ').slice(0, 200);
  console.log(`${label.padEnd(34)} exit=${r.status}  ${out}`);
}
const sigNoCov = signedHex({ withCovenant: false });   // J2 时序: 签名时输出还没有 covenant
const sigWithCov = signedHex({ withCovenant: true });  // 修正时序: 输出先挂 covenant 再签
run('A_control_nocov_tx_sig_nocov', sigNoCov, false);   // 对照: tx 也没有 covenant, 用 nocov 签名 → 应 PASS(证明其余承诺字段都对得上)
run('B_J2order_cov_tx_sig_nocov', sigNoCov, true);      // J2 时序: 最终 tx 有 covenant, 签名承诺的是无 covenant
run('C_fixed_cov_tx_sig_cov', sigWithCov, true);        // 修正: tx 有 covenant, 签名也是带 covenant 的
