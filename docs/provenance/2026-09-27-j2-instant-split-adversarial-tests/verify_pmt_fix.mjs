process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, ScriptPublicKey, Generator, PaymentOutput } = kaspa;
const { createSplitProtocol, buildSplitTx, buildRefundTx } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/src/lib/instant-split-sdk.mjs');
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/scripts/audit/generic-entry-witness.mjs');

const RPC_URL = 'ws://127.0.0.1:29817';
const rpc = new RpcClient({ url: RPC_URL, encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const fundingWallet = new PrivateKey('982c3b5bb2ec24adb34191238ffb41645513a3a5c717d6266dadcd489836c04e');
const fundingAddr = fundingWallet.toPublicKey().toAddress('simnet').toString();
function genAddr() { const p = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')); return p.toPublicKey().toAddress('simnet').toString(); }
async function currentPmt() { const bdi = await rpc.getBlockDagInfo(); return Number(bdi.pastMedianTime); }
async function mine(n) { for (let i = 0; i < n; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: fundingAddr, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); } }
async function fund(addr, amt) {
  const bdi = await rpc.getBlockDagInfo(); const tip = BigInt(bdi.virtualDaaScore);
  const { entries: all } = await rpc.getUtxosByAddresses([new Address(fundingAddr)]);
  const entries = all.filter(e => (tip - BigInt(e.blockDaaScore)) > 1000n);
  const gen = new Generator({ entries, outputs: [new PaymentOutput(new Address(addr), amt)], priorityFee: 0n, changeAddress: new Address(fundingAddr), networkId: 'simnet' });
  let txId = ''; let p; while ((p = await gen.next())) { await p.sign([fundingWallet]); txId = await p.submit(rpc); }
  await mine(3);
  return txId;
}
async function getUtxo(addr) { const { entries } = await rpc.getUtxosByAddresses([addr]); return { transactionId: entries[0].outpoint.transactionId, index: entries[0].outpoint.index, amountSompi: entries[0].amount }; }

const results = [];
async function record(name, expect, fn) {
  let outcome; try { outcome = await fn(); } catch (e) { outcome = { err: 'LOCAL_THROW: ' + e.message }; }
  const accepted = !!outcome.transactionId;
  const pass = (expect === 'accept') === accepted;
  results.push({ name, expect, accepted, detail: outcome.transactionId || outcome.err, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} expect=${expect} accepted=${accepted} :: ${outcome.transactionId || outcome.err}`);
}

const MAX_SPLIT_FEE = 40_000_000n, MAX_REFUND_FEE = 10_000_000n;

await record('T10_refund_pmt_fixed', 'accept', async () => {
  const m = genAddr(), b = genAddr(), pr = genAddr();
  const pmt0 = await currentPmt();
  const cfg = { network: 'simnet', merchant: { address: m, amountSompi: 700000000n }, broker: { address: b, amountSompi: 250000000n }, payerRefundAddress: pr, deadlineMs: pmt0 - 60000, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE };
  const protocol = createSplitProtocol(cfg);
  await fund(protocol.address, 1000000000n);
  const utxo = await getUtxo(protocol.address);
  const pmtNow = await currentPmt();
  console.log('  pmtNow=', pmtNow, 'deadlineMs=', protocol.deadlineMs, 'diff=', pmtNow - protocol.deadlineMs);
  const { tx } = buildRefundTx(protocol, utxo, pmtNow);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

await record('T11_split_freshnet', 'accept', async () => {
  const m = genAddr(), b = genAddr(), pr = genAddr();
  const cfg = { network: 'simnet', merchant: { address: m, amountSompi: 700000000n }, broker: { address: b, amountSompi: 250000000n }, payerRefundAddress: pr, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE };
  const protocol = createSplitProtocol(cfg);
  await fund(protocol.address, 700000000n + 250000000n + 5000000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

await record('T15a_refund_fee_boundary_pmt_fixed', 'accept', async () => {
  const m = genAddr(), b = genAddr(), pr = genAddr();
  const pmt0 = await currentPmt();
  const cfg = { network: 'simnet', merchant: { address: m, amountSompi: 700000000n }, broker: { address: b, amountSompi: 250000000n }, payerRefundAddress: pr, deadlineMs: pmt0 - 60000, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE };
  const protocol = createSplitProtocol(cfg);
  await fund(protocol.address, 1000000000n);
  const utxo = await getUtxo(protocol.address);
  const entryAbi = protocol.entries.refund;
  const sigHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, {}), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const outVal = BigInt(utxo.amountSompi) - MAX_REFUND_FEE;
  const spk = Buffer.concat([Buffer.from([0x20]), protocol.refundPk, Buffer.from([0xac])]).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [new TransactionOutput(outVal, new ScriptPublicKey(0, spk))], lockTime: BigInt(protocol.deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

await record('T15b_refund_fee_over_boundary_reject_reason_check', 'reject', async () => {
  const m = genAddr(), b = genAddr(), pr = genAddr();
  const pmt0 = await currentPmt();
  const cfg = { network: 'simnet', merchant: { address: m, amountSompi: 700000000n }, broker: { address: b, amountSompi: 250000000n }, payerRefundAddress: pr, deadlineMs: pmt0 - 60000, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE };
  const protocol = createSplitProtocol(cfg);
  await fund(protocol.address, 1000000000n);
  const utxo = await getUtxo(protocol.address);
  const entryAbi = protocol.entries.refund;
  const sigHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, {}), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const outVal = BigInt(utxo.amountSompi) - MAX_REFUND_FEE - 1n;
  const spk = Buffer.concat([Buffer.from([0x20]), protocol.refundPk, Buffer.from([0xac])]).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [new TransactionOutput(outVal, new ScriptPublicKey(0, spk))], lockTime: BigInt(protocol.deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
  const reasonIsScriptFail = (r.err || '').includes('verify the signature script');
  const reasonIsNotFinalized = (r.err || '').includes('not finalized');
  console.log('  reject reason check: scriptFail=', reasonIsScriptFail, 'notFinalized=', reasonIsNotFinalized);
  if (reasonIsNotFinalized) return { err: 'WRONG REASON (still PMT-related, fix incomplete): ' + r.err };
  return r;
});

console.log('\n=== SUMMARY ===');
let pass = 0; for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`); if (r.pass) pass++; }
console.log(`${pass}/${results.length} PASS`);
await rpc.disconnect().catch(() => {});
process.exit(pass === results.length ? 0 : 1);
