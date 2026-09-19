// NWT 实验(续): 毒化(带 covenant 绑定)P2PK 输入对节点 storage mass 的影响。
// 造一枚 0.95 KAS 毒化 UTXO + 一枚 0.95 KAS 普通 UTXO(同一笔), 然后一笔 2 输入 → 4 个小输出 的交易同时花掉它们, 读节点 storage mass,
// 对照我的 KIP-9 公式: 毒化输入按 p=2(covenant)算 vs 按 p=1(普通)算, 看哪个逐位命中。同时对照 kaspa-wasm 本地 mass(plurality 恒 1)。
import { readFileSync, writeFileSync } from 'node:fs';
import { signOnlyDeclaredInputs } from '../../../kasia-relay/src/lib/covenant-broadcast.mjs';
const { calcStorageMass, utxoPlurality, spkLenOf } = await import('file:///D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/port_mass.mjs');
const kaspa = await import('kaspa-wasm');
const HERE = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/';
const st = JSON.parse(readFileSync(HERE + '_nwt_ladder_state.json', 'utf8'));
const priv = new kaspa.PrivateKey(st.privHex);
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const jsonSafe = (k, v) => (typeof v === 'bigint' ? v.toString() : v);
const log = []; const note = (o) => { log.push(o); console.log(JSON.stringify(o, jsonSafe)); };
const mineOne = async () => { const { block } = await rpc.getBlockTemplate({ payAddress: st.addr }); return rpc.submitBlock({ block, allowNonDAABlocks: true }); };
const A = () => new kaspa.Address(st.addr);
const spk = () => kaspa.payToAddressScript(A());
const mkInput = (op, amount, bds) => ({ previousOutpoint: op, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: { outpoint: op, amount, scriptPublicKey: spk(), blockDaaScore: bds } });
const daa = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const { entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
const big = entries.filter((e) => BigInt(e.amount) === 5_000_000_000n && BigInt(e.blockDaaScore) + 1000n <= daa);
if (big.length < 1) throw new Error('需要至少 1 枚成熟的 50 KAS UTXO');
const b = big[big.length - 1]; const op0 = { transactionId: b.outpoint.transactionId, index: b.outpoint.index };
const V = 95_000_000n, F3 = 10_000_000n;
// tx3: 输出0 = 0.95 KAS 毒化(covenant), 输出1 = 0.95 KAS 普通, 输出2 = 找零
const tx3 = new kaspa.Transaction({ version: 1, inputs: [mkInput(op0, 5_000_000_000n, BigInt(b.blockDaaScore))], outputs: [new kaspa.TransactionOutput(V, spk()), new kaspa.TransactionOutput(V, spk()), new kaspa.TransactionOutput(5_000_000_000n - 2n * V - F3, spk())], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
tx3.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0])]);
signOnlyDeclaredInputs({ tx: tx3, signInputIndices: [0], privateKey: priv, kaspa }); tx3.finalize();
try { await rpc.submitTransaction({ transaction: tx3, allowOrphan: false }); note({ step: 3, result: 'ACCEPTED', txid: tx3.id }); } catch (e) { note({ step: 3, result: 'REJECTED', node: String(e.message).slice(0, 300) }); await rpc.disconnect(); process.exit(0); }
await mineOne(); await mineOne();
// tx4: 2 输入(毒化 + 普通) → 4 个小输出(各 0.2 KAS) + 找零
const daa2 = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const FEE4 = 30_000_000n; const O = 20_000_000n;
const ins = [mkInput({ transactionId: tx3.id, index: 0 }, V, daa2), mkInput({ transactionId: tx3.id, index: 1 }, V, daa2)];
const outVals = [O, O, O, O, 2n * V - 4n * O - FEE4];
const tx4 = new kaspa.Transaction({ version: 1, inputs: ins, outputs: outVals.map((v) => new kaspa.TransactionOutput(v, spk())), lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
signOnlyDeclaredInputs({ tx: tx4, signInputIndices: [0, 1], privateKey: priv, kaspa }); tx4.finalize();
const wasm = BigInt(kaspa.calculateTransactionMass('simnet', tx4));
const P = (p, a) => ({ p: BigInt(p), a: BigInt(a) });
const L = spkLenOf(spk());
const pPlain = utxoPlurality(BigInt(L), false), pCov = utxoPlurality(BigInt(L), true);
const outs = outVals.map((v) => P(pPlain, v));
const f_poison_as_cov = calcStorageMass([P(pCov, V), P(pPlain, V)], outs).mass;
const f_poison_as_plain = calcStorageMass([P(pPlain, V), P(pPlain, V)], outs).mass;
note({ step: 4, what: '2-in(poisoned covenant-bound + plain) -> 5-out', txid: tx4.id, wasmLocalMass: String(wasm), plurality_plain: String(pPlain), plurality_covenant: String(pCov), myFormula_poison_counted_as_covenant: String(f_poison_as_cov), myFormula_poison_counted_as_plain: String(f_poison_as_plain) });
try {
  await rpc.submitTransaction({ transaction: tx4, allowOrphan: false });
  const me = await rpc.getMempoolEntry({ transactionId: tx4.id, includeOrphanPool: true, filterTransactionPool: false });
  const j = JSON.parse(JSON.stringify(me, jsonSafe)); const m = j.mempoolEntry ?? j.entry ?? j;
  note({ step: 4, result: 'ACCEPTED', nodeStorageMass: String(m.mass ?? m.transaction?.mass), nodeComputeMass: String(m.transaction?.verboseData?.computeMass), fee: String(m.fee) });
} catch (e) { note({ step: 4, result: 'REJECTED', node: String(e.message).slice(0, 400) }); }
await mineOne();
writeFileSync(HERE + 'poisoned_mass_log.json', JSON.stringify(log, jsonSafe, 1));
await rpc.disconnect();
