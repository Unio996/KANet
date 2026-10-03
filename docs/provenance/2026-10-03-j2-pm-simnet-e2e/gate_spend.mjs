// gate_spend.mjs — 隔离实验(不经 settle 编排): 用 canonical sample 的【真 RISC0 groth16 receipt】(imageId c9918501…, 3o6cs)
// 经 ZK-SDK 建 gate P2SH → 银行密钥注资 FUND_KAS → 以 computeBudget 1500 花 gate(只花 gate, 输出回银行)。
// 量: ① kaspad 2.0.1 simnet 真共识是否接受 OpZkPrecompile groth16 验证 ② 节点要求的最小费(先提交低费让节点自报 required) ③ 花后 gate 余额 = 全部转入矿工费还是找零(取决于 builder 是否给 change_address)。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { rpcConnect, kaspa, sleep, log, WT, SIM } from './lib.mjs';
const { Transaction, TransactionOutput, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, Address, Generator, PaymentOutput, PrivateKey } = kaspa;
const zk = createRequire(import.meta.url)('D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js');
const SAMPLE = `${WT}/zk-payout-guest/proofs/3o6cs-attest-0a358fa0`;
const receiptHex = readFileSync(`${SAMPLE}/3o6cs_receipt.hex`, 'utf8').trim();
const sum = JSON.parse(readFileSync(`${SAMPLE}/3o6cs_receipt.summary.json`, 'utf8'));
const FUND_KAS = Number(process.argv[2] || 1);
const BUDGET = Number(process.argv[3] || 1500);
const builder = zk.ZkScriptBuilder.newR0({ flags: { covenantsEnabled: true } });
builder.commitToGroth16WithFixedJournal(sum.image_id, sum.journal_digest);
const { sigScript, redeemScript } = builder.finalizeWithGroth16FixedJournalProof(receiptHex);
const gateAddr = addressFromScriptPublicKey(payToScriptHashScript(new Uint8Array(Buffer.from(redeemScript, 'hex'))), 'simnet').toString();
log('gate addr', gateAddr, 'redeem bytes', redeemScript.length / 2, 'sigScript bytes', sigScript.length / 2);
const rpc = await rpcConnect();
const bank = new PrivateKey(readFileSync(`${SIM}/bank.key`, 'utf8').trim());
const bankAddr = bank.toPublicKey().toAddress('simnet').toString();
// fund
const { entries } = await rpc.getUtxosByAddresses([new Address(bankAddr)]);
const dag = await rpc.getBlockDagInfo();
const mature = entries.filter((e) => BigInt(e.blockDaaScore) + 1100n < dag.virtualDaaScore).slice(0, 3);
const gen = new Generator({ entries: mature, outputs: [new PaymentOutput(new Address(gateAddr), BigInt(Math.round(FUND_KAS * 1e8)))], priorityFee: 0n, changeAddress: new Address(bankAddr), networkId: 'simnet' });
let p, fundTx; while ((p = await gen.next())) { await p.sign([bank]); fundTx = await p.submit(rpc); }
log('fund tx', fundTx);
let u = null; for (let i = 0; i < 100 && !u; i++) { const r = await rpc.getUtxosByAddresses([new Address(gateAddr)]); u = r.entries.find((e) => e.outpoint.transactionId === fundTx); if (!u) await sleep(300); }
const gateValue = BigInt(u.amount);
log('gate utxo value sompi', gateValue.toString());
const mk = (fee) => new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: u.outpoint.transactionId, index: u.outpoint.index }, signatureScript: sigScript, sequence: 0n, sigOpCount: 0, computeBudget: BUDGET }],
  outputs: [new TransactionOutput(gateValue - fee, payToAddressScript(new Address(bankAddr)))], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
// ① 先给个明显偏低的费让节点自报 required
let required = null;
for (const fee of [1_000n, 100_000n]) {
  try { const r = await rpc.submitTransaction({ transaction: mk(fee), allowOrphan: false }); log('UNEXPECTED accepted at fee', fee.toString(), r.transactionId); process.exit(0); }
  catch (e) { const m = String(e?.message ?? e); log(`fee ${fee} rejected (node raw):`, m.slice(0, 300)); const mm = /amount of (\d+)/.exec(m); if (mm) required = BigInt(mm[1]); }
}
log('node-required fee (sompi) =', required?.toString());
const fee = required ? required + required / 20n : 5_000_000n;   // +5% 余量
const tx = mk(fee);
const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
log('ACCEPTED spend of ZK gate: txid', r.transactionId, 'fee paid sompi', fee.toString(), `(${Number(fee) / 1e8} KAS)`, '| gate value', gateValue.toString());
await sleep(3000);
const { entries: after } = await rpc.getUtxosByAddresses([new Address(bankAddr)]);
log('output landed on bank?', after.some((e) => e.outpoint.transactionId === r.transactionId));
process.exit(0);
