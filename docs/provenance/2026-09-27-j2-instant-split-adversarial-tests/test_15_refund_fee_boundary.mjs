process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, ScriptPublicKey, Generator, PaymentOutput } = kaspa;
const { createSplitProtocol } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/src/lib/instant-split-sdk.mjs');
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/scripts/audit/generic-entry-witness.mjs');

const MAX_REFUND_FEE = 10_000_000n;
const rpc = new RpcClient({ url: 'ws://127.0.0.1:29717', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const fundingWallet = new PrivateKey('dcb975899fc09882906beec6a51b479d4916c335dfb63991e062ffa5887cb5df');
const fundingAddr = fundingWallet.toPublicKey().toAddress('simnet').toString();
function genAddr() { const p = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')); return p.toPublicKey().toAddress('simnet').toString(); }
function mkOut(value, pubkey32) { const spk = Buffer.concat([Buffer.from([0x20]), Buffer.from(pubkey32), Buffer.from([0xac])]).toString('hex'); return new TransactionOutput(value, new ScriptPublicKey(0, spk)); }
async function tipTs() { const bdi = await rpc.getBlockDagInfo(); const blk = await rpc.getBlock({hash:bdi.tipHashes[0],includeTransactions:false}); return Number(blk.block.header.timestamp); }
async function fund(addr, amt) {
  const bdi = await rpc.getBlockDagInfo(); const tip = BigInt(bdi.virtualDaaScore);
  const { entries: all } = await rpc.getUtxosByAddresses([new Address(fundingAddr)]);
  const entries = all.filter(e => (tip - BigInt(e.blockDaaScore)) > 1000n);
  const gen = new Generator({ entries, outputs: [new PaymentOutput(new Address(addr), amt)], priorityFee: 0n, changeAddress: new Address(fundingAddr), networkId: 'simnet' });
  let txId=''; let p; while ((p=await gen.next())) { await p.sign([fundingWallet]); txId = await p.submit(rpc); }
  for (let i=0;i<3;i++){ const tpl = await rpc.getBlockTemplate({payAddress:fundingAddr,extraData:[]}); await rpc.submitBlock({block:tpl.block,allowNonDAABlocks:true}); }
}
async function getUtxo(addr) { const {entries} = await rpc.getUtxosByAddresses([addr]); return { transactionId: entries[0].outpoint.transactionId, index: entries[0].outpoint.index, amountSompi: entries[0].amount }; }

const m = genAddr(), b = genAddr(), pr = genAddr();
const ts = await tipTs();
const cfg = { network:'simnet', merchant:{address:m,amountSompi:700000000n}, broker:{address:b,amountSompi:250000000n}, payerRefundAddress: pr, deadlineMs: ts - 600000, maxSplitFeeSompi: 40000000n, maxRefundFeeSompi: MAX_REFUND_FEE };
const protocol = createSplitProtocol(cfg);
await fund(protocol.address, 1000000000n);
const utxo = await getUtxo(protocol.address);
const entryAbi = protocol.entries.refund;
const sigHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, {}), Buffer.from(protocol.redeemScriptHex,'hex')).toString('hex');

// (a) at the boundary: output.value == input.value - max_refund_fee (exactly) -> ACCEPT
const txA = new Transaction({ version:1, inputs:[{previousOutpoint:{transactionId:utxo.transactionId,index:utxo.index},signatureScript:sigHex,sequence:0n,sigOpCount:0,computeBudget:70}], outputs:[mkOut(BigInt(utxo.amountSompi)-MAX_REFUND_FEE, protocol.refundPk)], lockTime: BigInt(protocol.deadlineMs), gas:0n, subnetworkId:'0000000000000000000000000000000000000000', payload:''});
const rA = await rpc.submitTransaction({transaction: txA, allowOrphan:false}).catch(e=>({err:e.message}));
console.log('[T15a boundary exact] expect=accept', JSON.stringify(rA));

// (b) beyond the boundary: try to take max_refund_fee+1 as fee (output.value = input - max_refund_fee - 1) -> REJECT
// need a fresh utxo since (a) might have consumed it if accepted
const utxo2 = await (async () => {
  if (rA.transactionId) {
    // fund a second instance
    const m2=genAddr(), b2=genAddr(), pr2=genAddr();
    const cfg2 = { ...cfg, merchant:{address:m2,amountSompi:700000000n}, broker:{address:b2,amountSompi:250000000n}, payerRefundAddress: pr2 };
    const protocol2 = createSplitProtocol(cfg2);
    await fund(protocol2.address, 1000000000n);
    return { u: await getUtxo(protocol2.address), p: protocol2 };
  }
  return { u: utxo, p: protocol };
})();
const p2 = utxo2.p, u2 = utxo2.u;
const sigHex2 = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, p2.entries.refund, {}), Buffer.from(p2.redeemScriptHex,'hex')).toString('hex');
const txB = new Transaction({ version:1, inputs:[{previousOutpoint:{transactionId:u2.transactionId,index:u2.index},signatureScript:sigHex2,sequence:0n,sigOpCount:0,computeBudget:70}], outputs:[mkOut(BigInt(u2.amountSompi)-MAX_REFUND_FEE-1n, p2.refundPk)], lockTime: BigInt(p2.deadlineMs), gas:0n, subnetworkId:'0000000000000000000000000000000000000000', payload:''});
const rB = await rpc.submitTransaction({transaction: txB, allowOrphan:false}).catch(e=>({err:e.message}));
console.log('[T15b beyond boundary] expect=reject', JSON.stringify(rB));

console.log('\nSUMMARY: T15a', rA.transactionId ? 'PASS(accepted)' : 'FAIL', '| T15b', !rB.transactionId ? 'PASS(rejected)' : 'FAIL');
await rpc.disconnect().catch(()=>{});
process.exit(0);
