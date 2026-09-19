// NWT 实验(simnet, 官方 2.0.1, 我自己的身份): (1) 链式未确认交易(child 花 parent 的未确认输出)节点 mempool 是否接受;
// (2) 同一输入的替换(RBF): 更高 fee / 相同 fee / 更低 fee 各自的结果。回答 dotk M4-7(reveal 是否可不等 commit 确认)与 M1(commit 被替换)的开放点。
// 不挖块直到全部提交完; 只用普通 P2PK 交易(不涉及 covenant), 只回答 mempool 行为。
import { readFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const HERE = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/';
const st = JSON.parse(readFileSync(HERE + '_nwt_ladder_state.json', 'utf8'));
const priv = new kaspa.PrivateKey(st.privHex);
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const jsonSafe = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
const mineOne = async () => { const { block } = await rpc.getBlockTemplate({ payAddress: st.addr }); return rpc.submitBlock({ block, allowNonDAABlocks: true }); };
const A = () => new kaspa.Address(st.addr);
const spk = () => kaspa.payToAddressScript(A());
const daa = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const { entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
const big = entries.filter((e) => BigInt(e.amount) === 5_000_000_000n && BigInt(e.blockDaaScore) + 1000n <= daa);
if (big.length < 3) throw new Error('需要至少 3 枚成熟的 50 KAS UTXO');
const toEntry = (e) => ({ address: A(), outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: BigInt(e.amount), scriptPublicKey: spk(), blockDaaScore: BigInt(e.blockDaaScore), isCoinbase: true });
async function gen(entryObjs, outKas, priorityFee) {
  const g = new kaspa.Generator({ entries: entryObjs, outputs: [new kaspa.PaymentOutput(A(), BigInt(Math.round(outKas * 1e8)))], priorityFee, changeAddress: A(), networkId: 'simnet' });
  const p = await g.next(); await p.sign([priv]); return p;
}
const submit = async (p, label) => {
  try { const r = await rpc.submitTransaction({ transaction: p.transaction, allowOrphan: false }); console.log(JSON.stringify({ label, txid: String(r.transactionId ?? p.id), result: 'ACCEPTED' })); return true; }
  catch (e) { console.log(JSON.stringify({ label, txid: p.id, result: 'REJECTED', node: String(e.message).slice(0, 260) })); return false; }
};
// —— (1) 链式未确认: P1 花 U1(已成熟 coinbase); C 花 P1 的找零输出(未确认)
const u1 = toEntry(big[0]);
const p1 = await gen([u1], 10, 3_000_000n);
await submit(p1, 'chain: parent P1 (spends confirmed UTXO)');
const tx1 = p1.transaction; const outs1 = tx1.outputs;
const changeIdx = outs1.findIndex((o) => BigInt(o.value) !== 1_000_000_000n);
const childEntry = { address: A(), outpoint: { transactionId: p1.id, index: changeIdx }, amount: BigInt(outs1[changeIdx].value), scriptPublicKey: spk(), blockDaaScore: daa, isCoinbase: false };
const c1 = await gen([childEntry], 5, 3_000_000n);
await submit(c1, 'chain: child C spends P1 change (UNCONFIRMED parent in mempool)');
// —— (2) 替换: 同一输入 U2, A(低 fee) 先进 mempool, 再 B(更高 fee) / B'(相同 fee) / B''(更低 fee)
const u2 = toEntry(big[1]);
const a = await gen([u2], 10, 3_000_000n);
const okA = await submit(a, 'rbf: A (fee low) spends U2');
const bHigh = await gen([toEntry(big[1])], 11, 30_000_000n);
const okB = await submit(bHigh, 'rbf: B (same input, HIGHER fee, different outputs)');
const bSame = await gen([toEntry(big[1])], 12, 3_000_000n);
await submit(bSame, 'rbf: B2 (same input, SAME fee level as A)');
const bLow = await gen([toEntry(big[1])], 13, 1_000_000n);
await submit(bLow, 'rbf: B3 (same input, LOWER fee)');
// 结果: mempool 里到底是 A 还是 B
for (const [n, p] of [['A', a], ['B(high)', bHigh]]) { try { await rpc.getMempoolEntry({ transactionId: p.id, includeOrphanPool: false, filterTransactionPool: false }); console.log(JSON.stringify({ inMempool: n })); } catch { console.log(JSON.stringify({ notInMempool: n })); } }
await mineOne(); await mineOne();
await rpc.disconnect();
