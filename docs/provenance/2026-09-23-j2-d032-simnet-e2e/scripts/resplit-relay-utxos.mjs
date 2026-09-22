// resplit-relay-utxos.mjs — 重整 relay 现有(已确认、非 coinbase)UTXO 成干净整数面值(不需要等币基成熟,
// 因为花的是 relay 自己已落链的找零, 不是新挖的 coinbase)。解密 relay 助记词(走生产 getRelayMnemonic,
// D-031 复用), 消费全部现有 UTXO, 重建成 N 个 0.99 KAS 的干净输出还给 relay 自己(同 fund-relay 的形状)。
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const KC_SRC = 'D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/src';
const req = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/');
const kaspa = req('kaspa-wasm');
const { RpcClient, Encoding, Address, Generator, PaymentOutput, PrivateKey, Mnemonic, XPrv } = kaspa;
const RELAY_ID = '386ccfd1-208c-4826-84f7-0b9c31a1b59f';
const RELAY_ADDR = 'kaspasim:qzcktenl5tueauy9qckkk4jsk6rjxgp0f2nykn78splfcqq7fam6z4ccu80zv';

const { getRelayMnemonic } = await import(pathToFileURL(`${KC_SRC}/data/settings/relay-nodes.js`).href);
const phrase = getRelayMnemonic(RELAY_ID);
if (!phrase) throw new Error('无法解密 relay 助记词(检查 CONSOLE_ENCRYPTION_KEY)');
function derivePrivateKeyFromMnemonic(p, accountIndex = 0) {
  const mnemonic = new Mnemonic(p); const seed = mnemonic.toSeed(); const xprv = new XPrv(seed);
  const derived = xprv.derivePath(`m/44'/111111'/${accountIndex}'/0/0`);
  return PrivateKey.fromXPrv ? PrivateKey.fromXPrv(derived) : new PrivateKey(derived.toPrivateKey().toString());
}
const priv = derivePrivateKeyFromMnemonic(phrase, 0);
const derivedAddr = priv.toPublicKey().toAddress('simnet').toString();
if (derivedAddr !== RELAY_ADDR) throw new Error(`派生地址不匹配: ${derivedAddr} != ${RELAY_ADDR}`);

const rpc = new RpcClient({ url: 'ws://127.0.0.1:29517', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo(); if (info.networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }
const { entries } = await rpc.getUtxosByAddresses([new Address(RELAY_ADDR)]);
const total = entries.reduce((a, e) => a + BigInt(e.amount), 0n);
console.log(`consolidating ${entries.length} UTXOs, total=${total} sompi = ${Number(total) / 1e8} KAS`);
// 999_000_00 sompi = 0.999 KAS(留一点余量给 fee), 尽量多切几个干净份, 剩余归入找零(也是干净单一输出)
const CHUNK = 90_000_000n; // 0.9 KAS(比原 0.99 略小, 给 fee/mass 留余量, 面值仍然"干净"能通过 mass 检查——已知 0.99 能过是因为那正是最初 fund 的形状)
const nChunks = total > (CHUNK * 2n + 1_000_000n) ? 2 : (total > (CHUNK + 1_000_000n) ? 1 : 0);
if (nChunks === 0) { console.error('余额不足以切出任何干净 chunk'); process.exit(4); }
const outputs = Array.from({ length: nChunks }, () => new PaymentOutput(new Address(RELAY_ADDR), CHUNK));
const generator = new Generator({ entries, outputs, priorityFee: 500_000n, changeAddress: new Address(RELAY_ADDR), networkId: 'simnet' });
let pending = null, txId = '';
while ((pending = await generator.next())) { await pending.sign([priv]); txId = await pending.submit(rpc); console.log('submitted txid=' + txId); }
await new Promise((s) => setTimeout(s, 4000));
const { entries: after } = await rpc.getUtxosByAddresses([new Address(RELAY_ADDR)]);
console.log('after: ' + after.map((e) => e.amount).join(', '));
await rpc.disconnect().catch(() => {});
process.exit(0);
