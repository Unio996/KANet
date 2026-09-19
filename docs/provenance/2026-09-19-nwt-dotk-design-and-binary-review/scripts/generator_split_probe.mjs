// NWT: 离线(无 RPC, 不广播)探针 —— 主网 console 转账用的 kaspa-wasm Generator 在什么 UTXO 形状下把一笔 47 KAS transfer 拆成多笔。
const kaspa = await import('kaspa-wasm');
const { Generator, PaymentOutput, Address, PrivateKey, ScriptPublicKey } = kaspa;
const priv = new PrivateKey('11'.repeat(32)); // 合成测试钥匙(全 0x11), 仅本探针, 无价值
const senderStr = priv.toPublicKey().toAddress('mainnet').toString();
const mkSpk = () => kaspa.payToAddressScript(new Address(senderStr));
// addresses built per-run (wasm moves objects into Generator)
const mk = (i, amountKas) => ({ address: new Address(senderStr), outpoint: { transactionId: (i + 1).toString(16).padStart(64, '0'), index: 0 }, amount: BigInt(Math.round(amountKas * 1e8)), scriptPublicKey: mkSpk(), blockDaaScore: 500_000_000n, isCoinbase: false });
async function run(label, utxosKas) {
  const entries = utxosKas.map((a, i) => mk(i, a));
  try {
    const g = new Generator({ entries, outputs: [new PaymentOutput(new Address(senderStr), 47n * 100_000_000n)], priorityFee: 3_000_000n, changeAddress: new Address(senderStr), networkId: 'mainnet' });
    const txs = []; let p; while ((p = await g.next())) txs.push({ inputs: p.transaction.inputs.length, outputs: p.transaction.outputs.length, mass: String(p.mass ?? ''), fee: String(p.feeAmount ?? '') });
    const s = g.summary();
    console.log(label.padEnd(44), 'txs=', txs.length, 'fees(KAS)=', Number(s.fees) / 1e8, 'stages=', s.stages, 'tx detail=', JSON.stringify(txs.slice(0, 3)));
  } catch (e) { console.log(label.padEnd(44), 'ERROR', String(e).slice(0, 120)); }
}
await run('S1 单 UTXO 100 KAS', [100]);
await run('S2 单 UTXO 78 KAS (≥ 1.65×S 规则下限)', [78]);
await run('S3 单 UTXO 60 KAS (change 13)', [60]);
await run('S4 单 UTXO 47.05 KAS (change ≈0.05, 小找零)', [47.05]);
await run('S5 单 UTXO 47.5 KAS (change ≈0.5)', [47.5]);
await run('S6 20 个 5 KAS', Array(20).fill(5));
await run('S7 120 个 0.5 KAS (总 60)', Array(120).fill(0.5));
await run('S8 400 个 0.2 KAS (总 80)', Array(400).fill(0.2));
