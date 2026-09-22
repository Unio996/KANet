// fund-relay-d032.mjs — 改自四臂 harness 的 fund-relay.mjs(D-031 复用同一套 mine-to-throwaway → custodial-send 手法),
// 指向本次隔离环境(relay 地址硬编码, RPC 端口 29517)。用法: node fund-relay-d032.mjs
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/');
const kaspa = require('kaspa-wasm'); const { RpcClient, Encoding, PrivateKey, Generator, Address, PaymentOutput } = kaspa;
const RELAY_ADDR = 'kaspasim:qzcktenl5tueauy9qckkk4jsk6rjxgp0f2nykn78splfcqq7fam6z4ccu80zv';
const rpc = new RpcClient({ url: 'ws://127.0.0.1:29517', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo(); if (info.networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }
const balKas = async (addr) => { const b = await rpc.getBalanceByAddress({ address: addr }); return Number(b.balance) / 1e8; };
const N_OUT = Number(process.argv[2]) || 4;
const before = await balKas(RELAY_ADDR);
console.log(`relay liquid before=${before} KAS, topping up ${N_OUT} x 0.99`);
const priv = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
const fundAddr = priv.toPublicKey().toAddress('simnet').toString();
const tpl = await rpc.getBlockTemplate({ payAddress: fundAddr, extraData: [] });
const r = await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
console.log(`funder block mined report=${JSON.stringify(r.report?.type ?? r)} daa=${tpl.block.header.daaScore} (funder=<throwaway ${fundAddr.slice(0, 20)}...>)`);
const t0 = Date.now(); let txId = ''; let lastErr = ''; let lastLogAt = 0;
while (!txId && Date.now() - t0 < 900000) {
  try {
    const { entries } = await rpc.getUtxosByAddresses([new Address(fundAddr)]);
    if (!entries || entries.length === 0) throw new Error('funder 还没有可见 UTXO');
    const outputs = Array.from({ length: N_OUT }, () => new PaymentOutput(new Address(RELAY_ADDR), 99_000_000n));
    const generator = new Generator({ entries, outputs, priorityFee: 500_000n, changeAddress: new Address(fundAddr), networkId: 'simnet' });
    let pending = null;
    while ((pending = await generator.next())) { await pending.sign([priv]); txId = await pending.submit(rpc); }
  } catch (e) {
    const m = String(e?.message ?? e).slice(0, 300); if (m !== lastErr) { console.log('send attempt failed(等成熟/重试): ' + m); lastErr = m; }
    if (Date.now() - lastLogAt > 20000) { const dag = await rpc.getBlockDagInfo(); console.log(`[progress] elapsed=${Math.round((Date.now() - t0) / 1000)}s daa=${dag.virtualDaaScore}`); lastLogAt = Date.now(); }
    txId = ''; await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log('funding tx=' + (txId ? String(txId).slice(0, 20) + '…' : 'NONE(超时)'));
await new Promise((s) => setTimeout(s, 3000));
const after = await balKas(RELAY_ADDR);
console.log(`relay balance now = ${after} KAS`);
await rpc.disconnect().catch(() => {}); process.exit(after > 0 ? 0 : 1);
