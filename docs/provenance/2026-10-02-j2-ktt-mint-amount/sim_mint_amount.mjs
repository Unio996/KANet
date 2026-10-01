// sim_mint_amount.mjs — KTT 指定数量铸币的 simnet 真共识验证(第一步)。直接调 relay 生产 handler
// (kasia-relay/src/lib/p2sh.mjs unlockKttV2Mint/unlockKttV2Transfer), 真广播, 节点 = KANet-UI 的 simnet(29935)。
// 用法: node sim_mint_amount.mjs <funderIndex> <lockSompi> <amount> [steps]   steps 逗号分隔: mint,xfer,xfer2,xfer-bad
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const WT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(WT, 'kasia-console/'));
const kaspa = require('kaspa-wasm');
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:29935';
process.env.KTT_PANEL_ENABLED = '1'; process.env.KTT_PANEL_RELAY_ID = 'sim-relay'; process.env.RELAY_NODE_ID = 'sim-relay';
const P = await import(pathToFileURL(join(WT, 'kasia-relay/src/lib/p2sh.mjs')).href);
const { computeKttV2TokenArtifact } = await import(pathToFileURL(join(WT, 'kasia-console/src/lib/pool-bshard-artifacts.mjs')).href);
const [fi, lockArg, amountArg, stepsArg] = process.argv.slice(2);
const steps = (stepsArg || 'mint,xfer').split(',');
const funders = JSON.parse(fs.readFileSync('D:/kanet-tn12/scratch/_kanetui_broadcast_simnet/funders.json', 'utf8'));
const f = funders[Number(fi)];
const priv = new kaspa.PrivateKey(f.priv);
const wallet = { getPrivateKey: () => priv, getNetworkId: () => 'simnet' };
const xonly = (p) => Buffer.from(kaspa.payToAddressScript(p.toPublicKey().toAddress('mainnet')).script, 'hex').subarray(1, 33).toString('hex');
const me = xonly(priv);
const rpc = new kaspa.RpcClient({ url: process.env.KASPA_RPC_URL, encoding: kaspa.Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function utxosOf(addr) { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(addr)]); return entries; }
const amt = (e) => BigInt(e.amount ?? e.entry?.amount ?? 0);
const op = (e) => e.outpoint;
async function utxoByTx(addr, txid) { for (let i = 0; i < 40; i++) { const e = (await utxosOf(addr)).find(x => op(x).transactionId === txid); if (e) return e; await wait(1500); } throw new Error('utxo of tx not found ' + txid); }
async function biggest(addr, minAmt = 0n) { // 最大的已确认 UTXO
  for (let i = 0; i < 40; i++) { const es = (await utxosOf(addr)).filter(e => amt(e) > minAmt).sort((a, b) => (amt(b) > amt(a) ? 1 : -1)); if (es.length) return es[0]; await wait(1500); }
  throw new Error('no utxo ' + addr);
}
const lock = BigInt(lockArg), amount = BigInt(amountArg);
let ok = true; const log = (...a) => console.log(...a);
const art = (a, scheme, ownerHex) => computeKttV2TokenArtifact({ amount: Number(a), ownerScheme: scheme, ownerBytesHex: ownerHex });
const addrOfArt = (a) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, a.scriptPubKeyHex.slice(2)), 'simnet').toString();
const mintArt = art(amount, 0, me);
const kttAddr = addrOfArt(mintArt);
let cur; // {address, art, txid, index}
if (steps.includes('mint')) {
  const fund = await biggest(f.addr, lock + 20_000_000n);
  log(`funder#${fi} UTXO ${amt(fund)} sompi; lock=${lock} amount=${amount}`);
  const r = await P.unlockKttV2Mint({ wallet, networkId: 'simnet', cmd: { ktt: { redeem_hex: Buffer.from(mintArt.script).toString('hex'), seed_sompi: lock.toString(), change_address: f.addr }, inputs: { funding: { address: f.addr, outpointTxid: op(fund).transactionId, index: op(fund).index } } } });
  log('MINT ok', JSON.stringify(r));
  await wait(6000);
  const kttU = await utxoByTx(kttAddr, r.txId);
  log(`  代币 UTXO KAS 面值=${amt(kttU)}  代币数量(State.amount)=${amount}  fee=${r.feeSompi}`);
  if (amt(kttU) !== lock) { ok = false; log('FAIL 面值不等于 lock'); }
  cur = { address: kttAddr, art: mintArt, txid: op(kttU).transactionId, index: op(kttU).index };
}
async function xfer(label, destScheme, destHex, tokenAmount) {
  const feeU = await biggest(f.addr, 6_600_000n + 0n);
  const destArt = art(amount, destScheme, destHex); // 数量守恒: 目标 State.amount 与源一致(转全部)
  const cmd = { ktt: { source_redeem_hex: Buffer.from(cur.art.script).toString('hex'), dest_redeem_hex: Buffer.from(destArt.script).toString('hex'), dest_owner_hex: destHex, dest_owner_scheme: destScheme, amount: tokenAmount.toString() },
    inputs: { ktt: { address: cur.address, outpointTxid: cur.txid, index: cur.index }, fee: { address: f.addr, outpointTxid: op(feeU).transactionId, index: op(feeU).index } }, outputs: { fee_change_address: f.addr } };
  const r = await P.unlockKttV2Transfer({ wallet, networkId: 'simnet', cmd });
  log(`${label} ok txid=${r.txId} locked=${r.lockedSompi} tokens=${r.amountSompi}`);
  await wait(6000);
  const dAddr = addrOfArt(destArt); const du = await utxoByTx(dAddr, r.txId);
  log(`  目标 UTXO KAS 面值=${amt(du)} covenantId=${String(du.entry?.covenantId ?? du.covenantId)}`);
  cur = { address: dAddr, art: destArt, txid: op(du).transactionId, index: op(du).index };
}
try {
  if (steps.includes('xfer')) await xfer('XFER1(自己→自己, owner 不变地址换 State? 同 owner 同 amount 即同地址)', 0, me, amount);
} catch (e) { ok = false; log('XFER FAIL', e.message); }
try {
  if (steps.includes('xfer2')) { const other = xonly(new kaspa.PrivateKey('77'.repeat(32))); await xfer('XFER2(→他人)', 0, other, amount); }
} catch (e) { ok = false; log('XFER2 FAIL', e.message); }
if (steps.includes('xfer-bad')) { // 对抗: State.amount 比源多 1 ⇒ sum_out>sum_in 必须被共识拒绝
  try { await xfer('XFER-BAD(多 1)', 0, me, amount + 1n); ok = false; log('FAIL 多出的数量竟被接受!'); } catch (e) { log('XFER-BAD 被拒绝(符合预期):', String(e.message).slice(0, 220)); }
}
log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
await rpc.disconnect(); process.exitCode = ok ? 0 : 1; // 不用 process.exit(): Windows 上 wasm RpcClient 关闭后立即 exit 会撞 libuv 断言
