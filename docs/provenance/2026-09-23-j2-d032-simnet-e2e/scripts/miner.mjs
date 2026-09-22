// miner.mjs — 持续挖 D-032 e2e 隔离 simnet(--enable-unsynced-mining, 单节点单矿工)。挖到固定的一次性
// throwaway 地址(私钥落盘到本目录, 仅供本次 e2e 内部转账用, 不是任何生产密钥, simnet 无价值)。
// 用法: node miner.mjs [intervalMs=300]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey } = kaspa;
const KEYFILE = 'D:/kanet-tn12/scratch/_j2_d032_e2e/miner-throwaway-key.txt';
let privHex;
if (fs.existsSync(KEYFILE)) privHex = fs.readFileSync(KEYFILE, 'utf8').trim();
else { privHex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'); fs.writeFileSync(KEYFILE, privHex); }
const priv = new PrivateKey(privHex);
const minerAddr = priv.toPublicKey().toAddress('simnet').toString();
console.log('[miner] throwaway coinbase address:', minerAddr);
const intervalMs = Number(process.argv[2]) || 300;
const rpc = new RpcClient({ url: 'ws://127.0.0.1:29517', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo(); if (info.networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }
console.log('[miner] connected, networkId=simnet, starting loop interval=' + intervalMs + 'ms');
let n = 0, lastLogAt = 0;
while (true) {
  try {
    const tpl = await rpc.getBlockTemplate({ payAddress: minerAddr, extraData: [] });
    await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
    n++;
    const now = Date.now();
    if (now - lastLogAt > 10_000) { console.log(`[miner] mined ${n} blocks so far, daa=${tpl.block.header.daaScore}`); lastLogAt = now; }
  } catch (e) { console.log('[miner] submit failed (normal during reorg/race): ' + String(e?.message || e).slice(0, 150)); }
  await new Promise((r) => setTimeout(r, intervalMs));
}
