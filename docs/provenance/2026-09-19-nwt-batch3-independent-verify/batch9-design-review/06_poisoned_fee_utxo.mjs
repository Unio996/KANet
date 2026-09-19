// NWT 实验(simnet, 我自己的身份与 UTXO, 官方 2.0.1): relay 地址上若出现【带 covenant 绑定、spk 却是 relay 自己 P2PK】的"毒化 fee UTXO"(任何人可造: genesis covenant 免权限),
// 节点怎么处理?  ① 造它 ② 把它当普通 fee 输入花掉(无 covenant 输出续约) —— 看是否被接受, 以及节点 storage mass 是按 p=1 还是 p=2 算。
// 只回答批9 设计审 D6(fee 输入是否要断言 covenantId==null)。simnet 无价值; 私钥只在 gitignored state 文件。
import { readFileSync, writeFileSync } from 'node:fs';
import { signOnlyDeclaredInputs } from '../../../kasia-relay/src/lib/covenant-broadcast.mjs';
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
const BUDGET = 70; // 与 J2 proto builder 的 PROTO_V0_COMPUTE_BUDGET 同
const mkInput = (op, amount, blockDaaScore) => ({ previousOutpoint: op, signatureScript: new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: BUDGET, utxo: { outpoint: op, amount, scriptPublicKey: spk(), blockDaaScore } });
const daa = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const { entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
const big = entries.filter((e) => BigInt(e.amount) === 5_000_000_000n && BigInt(e.blockDaaScore) + 1000n <= daa);
if (big.length < 1) throw new Error('需要至少 1 枚成熟的 50 KAS UTXO');
const b = big[big.length - 1];
const op0 = { transactionId: b.outpoint.transactionId, index: b.outpoint.index };
note({ step: 0, info: 'using own mature 50 KAS UTXO', outpoint: op0.transactionId.slice(0, 12) + ':' + op0.index });

// ① 造毒化 UTXO: 输出0 = 1 KAS, spk=我自己的 P2PK, 带 genesis covenant(授权输入 0); 输出1 = 找零
const FEE1 = 10_000_000n, POISON = 100_000_000n;
const tx1 = new kaspa.Transaction({ version: 1, inputs: [mkInput(op0, 5_000_000_000n, BigInt(b.blockDaaScore))], outputs: [new kaspa.TransactionOutput(POISON, spk()), new kaspa.TransactionOutput(5_000_000_000n - POISON - FEE1, spk())], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
tx1.populateGenesisCovenants([new kaspa.GenesisCovenantGroup(0, [0])]);
signOnlyDeclaredInputs({ tx: tx1, signInputIndices: [0], privateKey: priv, kaspa });
tx1.finalize();
const cov1 = tx1.outputs[0].covenant;
note({ step: 1, what: 'create poisoned output (covenant-bound, spk = my own P2PK)', txid: tx1.id, out0CovenantId: cov1 ? String(cov1.covenantId).slice(0, 12) + '…' : null });
try { const r = await rpc.submitTransaction({ transaction: tx1, allowOrphan: false }); note({ step: 1, result: 'ACCEPTED', txid: String(r.transactionId ?? tx1.id) }); }
catch (e) { note({ step: 1, result: 'REJECTED', node: String(e.message).slice(0, 300) }); await rpc.disconnect(); process.exit(0); }
await mineOne(); await mineOne();
const { entries: e2 } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
const pu = e2.find((e) => e.outpoint.transactionId === tx1.id && e.outpoint.index === 0);
note({ step: 1, poisonedUtxoOnNode: !!pu, hasCovenantIdField: pu ? ('covenantId' in pu || pu.covenantId !== undefined || pu.utxoEntry?.covenantId !== undefined) : null, covenantIdFromNode: pu ? String(pu.covenantId ?? pu.utxoEntry?.covenantId ?? '') .slice(0, 12) : null, keys: pu ? Object.keys(pu) : null });

// ② 当普通 fee 输入花掉(无 covenant 输出): 1 输入(带 covenant 的 P2PK) → 1 个普通输出
const opP = { transactionId: tx1.id, index: 0 };
const daa2 = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const FEE2 = 20_000_000n;
const tx2 = new kaspa.Transaction({ version: 1, inputs: [mkInput(opP, POISON, daa2)], outputs: [new kaspa.TransactionOutput(POISON - FEE2, spk())], lockTime: 0n, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
signOnlyDeclaredInputs({ tx: tx2, signInputIndices: [0], privateKey: priv, kaspa });
tx2.finalize();
const wasmMass = BigInt(kaspa.calculateTransactionMass('simnet', tx2));
note({ step: 2, what: 'spend poisoned covenant-bound UTXO as a plain fee input, no covenant continuation', txid: tx2.id, wasmLocalMass: String(wasmMass) });
try {
  const r = await rpc.submitTransaction({ transaction: tx2, allowOrphan: false });
  const me = await rpc.getMempoolEntry({ transactionId: tx2.id, includeOrphanPool: true, filterTransactionPool: false });
  const j = JSON.parse(JSON.stringify(me, jsonSafe)); const m = j.mempoolEntry ?? j.entry ?? j;
  note({ step: 2, result: 'ACCEPTED', txid: String(r.transactionId ?? tx2.id), nodeStorageMass: String(m.mass ?? m.transaction?.mass), nodeComputeMass: String(m.transaction?.verboseData?.computeMass), fee: String(m.fee) });
} catch (e) { note({ step: 2, result: 'REJECTED', node: String(e.message).slice(0, 400) }); }
await mineOne();
writeFileSync(HERE + 'poisoned_fee_log.json', JSON.stringify(log, jsonSafe, 1));
await rpc.disconnect();
