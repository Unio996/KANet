// NWT fee 阶梯实验 步骤1: 独立 simnet 测试身份 + 挖块成熟 coinbase + 拆成 0.95 KAS fee UTXO。
// 只回答"节点 mempool 最低费是否接受", 不回答主网矿工排序。私钥只落 state 文件(simnet 无价值, gitignored), 不打印。
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
const kaspa = await import('kaspa-wasm');
const HERE = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/';
const STATE = HERE + '_nwt_ladder_state.json';
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const info = await rpc.getServerInfo();
console.log('node: version(server)=', info.serverVersion, 'network=', info.networkId, 'utxoindex=', info.hasUtxoIndex, 'virtualDaa=', String(info.virtualDaaScore));
const exeSha = createHash('sha256').update(readFileSync('D:/rusty-kaspa-v201/kaspad.exe')).digest('hex');
console.log('kaspad.exe sha256 =', exeSha, exeSha === '8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38' ? '(== 官方 2.0.1 pinned)' : '(MISMATCH!)');
let st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
if (!st) { const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex')); st = { privHex: priv.toString(), addr: priv.toPublicKey().toAddress('simnet').toString() }; writeFileSync(STATE, JSON.stringify(st)); }
console.log('my simnet address:', st.addr);
const mineOne = async () => { const { block } = await rpc.getBlockTemplate({ payAddress: st.addr }); return rpc.submitBlock({ block, allowNonDAABlocks: true }); };
let { entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] });
if (!entries.length) { const t0 = Date.now(); for (let i = 0; i < 1100; i++) await mineOne(); console.log('mined 1100 blocks in', Date.now() - t0, 'ms'); ({ entries } = await rpc.getUtxosByAddresses({ addresses: [st.addr] })); }
const daa = BigInt((await rpc.getBlockDagInfo()).virtualDaaScore);
const mature = entries.filter((e) => BigInt(e.blockDaaScore) + 1000n <= daa);
console.log('my UTXOs:', entries.length, 'mature(>=1000 DAA):', mature.length, 'sample amount(sompi)=', mature[0] ? String(mature[0].amount) : 'n/a');
// 拆分: 1 枚成熟 coinbase → 8 枚 0.95 KAS + 找零
const wantOuts = 8;
if (mature.length && !st.split) {
  const entry = mature.sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))[0];
  const g = new kaspa.Generator({ entries: [entry], outputs: Array.from({ length: wantOuts }, () => new kaspa.PaymentOutput(new kaspa.Address(st.addr), 95_000_000n)), priorityFee: 5_000_000n, changeAddress: new kaspa.Address(st.addr), networkId: 'simnet' });
  const priv = new kaspa.PrivateKey(st.privHex); let p; const ids = [];
  while ((p = await g.next())) { await p.sign([priv]); ids.push(await p.submit(rpc)); }
  await mineOne(); st.split = ids; writeFileSync(STATE, JSON.stringify(st)); console.log('split txs:', ids.join(','), '(mined 1 block)');
}
const after = (await rpc.getUtxosByAddresses({ addresses: [st.addr] })).entries.map((e) => String(e.amount));
console.log('UTXO amounts now (sompi):', JSON.stringify(after.slice(0, 12)));
await rpc.disconnect();
