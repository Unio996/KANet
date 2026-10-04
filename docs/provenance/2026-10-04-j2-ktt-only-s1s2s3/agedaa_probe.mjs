// agedaa_probe.mjs — 账本1846(B 项, Bettor 要求): 在 2.0.1 simnet 上证明 `this.ageDaa`(= OpCheckSequenceVerify, 相对 DAA 年龄)真共识可用。
// 抛弃型测试合约 AgeProbe(不碰主网集 .sil, 不进仓): entry go() { require(this.ageDaa >= AGE); }
// 四个真实广播: ① age 未到+sequence=AGE ⇒ 应拒; ② age 已到+sequence=0 ⇒ 应拒; ③ age 已到+sequence=AGE-1 ⇒ 应拒; ④ age 已到+sequence=AGE ⇒ 应过。
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { kaspa, rpcConnect, sleep, log, daa } from './s3lib.mjs';
const OUT = 'D:/kanet-tn12/scratch/_j2_s3';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_s12';
const AGE = 150;
for (const l of readFileSync(`${OUT}/env.s3.simnet`, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) process.env[m[1]] = m[2]; }
process.env.DB_PATH = `${OUT}/_agedaa_probe.db`;
const { compileSilV100 } = await import(pathToFileURL(`${WT}/kasia-console/src/lib/pool-bshard-artifacts.mjs`).href);
writeFileSync(`${OUT}/AgeProbe.sil`, `pragma silverscript ^0.1.0;\ncontract AgeProbe() {\n    entry go() {\n        require(this.ageDaa >= ${AGE});\n    }\n}\n`);
const compiled = compileSilV100(`${OUT}/AgeProbe.sil`, [], 'AgeProbe');
const redeem = Buffer.from(compiled.script);
const entry = compiled._raw.contracts.AgeProbe.entries?.go;
log('compiled redeem bytes', redeem.length, 'entry', JSON.stringify(entry)?.slice(0, 200));
const { ScriptBuilder, Transaction, TransactionOutput, Address, PrivateKey, payToAddressScript, addressFromScriptPublicKey, Generator, PaymentOutput } = kaspa;
const p2shSpk = ScriptBuilder.fromScript(new Uint8Array(redeem)).createPayToScriptHashScript();
const p2shAddr = addressFromScriptPublicKey(p2shSpk, 'simnet').toString();
const rpc = await rpcConnect();
const bank = new PrivateKey(readFileSync(`${OUT}/../_j2_tok_sim/bank.key`, 'utf8').trim());
const bankAddr = bank.toPublicKey().toAddress('simnet').toString();
// 资助: bank → P2SH 2 KAS
const { entries } = await rpc.getUtxosByAddresses([new Address(bankAddr)]);
const gen = new Generator({ entries: entries.slice(0, 40), outputs: [new PaymentOutput(new Address(p2shAddr), 200_000_000n)], priorityFee: 0n, changeAddress: new Address(bankAddr), networkId: 'simnet' });
let p, fundTx; while ((p = await gen.next())) { await p.sign([bank]); fundTx = await p.submit(rpc); }
log('funded', p2shAddr.slice(0, 30), 'tx', fundTx);
let utxo = null; for (let i = 0; i < 60 && !utxo; i++) { const r = await rpc.getUtxosByAddresses([new Address(p2shAddr)]); utxo = r.entries.find((e) => e.outpoint.transactionId === fundTx); if (!utxo) await sleep(500); }
if (!utxo) throw new Error('funding utxo not seen');
const daaAt = Number(utxo.blockDaaScore); log('utxo daa', daaAt, 'now', await daa(rpc));
const spend = async (label, seq) => {
  const act = new ScriptBuilder({ flags: { covenantsEnabled: true } });
  if (entry?.dispatch_tag) act.addData(new Uint8Array(Buffer.from(entry.dispatch_tag.replace(/^0x/, ''), 'hex')));
  act.addData(new Uint8Array(redeem));
  const sig = act.drain();
  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundTx, index: Number(utxo.outpoint.index) }, signatureScript: sig, sequence: BigInt(seq), sigOpCount: 0, computeBudget: 300 }],
    outputs: [new TransactionOutput(200_000_000n - 5_000_000n, payToAddressScript(new Address(bankAddr)))],
    lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const nowDaa = await daa(rpc);
  try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); log(`  ${label}: seq=${seq} age=${nowDaa - daaAt} ⇒ ACCEPTED txid=${r.transactionId}`); return { accepted: true, txid: r.transactionId, age: nowDaa - daaAt }; }
  catch (e) { log(`  ${label}: seq=${seq} age=${nowDaa - daaAt} ⇒ REJECTED: ${String(e.message || e).slice(0, 220)}`); return { accepted: false, err: String(e.message || e).slice(0, 400), age: nowDaa - daaAt }; }
};
const res = {};
res.t1_age_not_reached = await spend('① age 未到', AGE);
while ((await daa(rpc)) - daaAt < AGE + 40) await sleep(1500);
res.t2_seq_zero = await spend('② age 已到但 sequence=0', 0);
res.t3_seq_below = await spend('③ age 已到但 sequence=AGE-1', AGE - 1);
res.t4_honest = await spend('④ age 已到 + sequence=AGE', AGE);
const verdict = !res.t1_age_not_reached.accepted && !res.t2_seq_zero.accepted && !res.t3_seq_below.accepted && res.t4_honest.accepted;
log(verdict ? 'RESULT: ageDaa 在 2.0.1 simnet 真共识上语义正确(①②③拒, ④过)' : 'RESULT: ❌ 与预期不符, 见上');
writeFileSync(`${OUT}/agedaa_probe_result.json`, JSON.stringify({ AGE, p2shAddr, fundTx, daaAt, res, verdict }, null, 1));
process.exit(verdict ? 0 : 1);
