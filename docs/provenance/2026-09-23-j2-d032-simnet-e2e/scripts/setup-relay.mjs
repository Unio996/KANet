// setup-relay.mjs — 建一个真实 simnet relay(真助记词, 真派生地址, 走生产 createRelayNode, 不裸造 DB 行, D-031 复用)。
// 用法: DB_PATH=... CONSOLE_ENCRYPTION_KEY=... node setup-relay.mjs
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const KC_SRC = 'D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-console/src';
const kaspa = createRequire('D:/kanet-tn12/scratch/_j2_wt_e2e/kasia-relay/')('kaspa-wasm');
const { Mnemonic, XPrv, PrivateKey } = kaspa;

function derivePrivateKeyFromMnemonic(phrase, accountIndex = 0) {
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed();
  const xprv = new XPrv(seed);
  const derived = xprv.derivePath(`m/44'/111111'/${accountIndex}'/0/0`);
  return PrivateKey.fromXPrv ? PrivateKey.fromXPrv(derived) : new PrivateKey(derived.toPrivateKey().toString());
}

const mn = Mnemonic.random(24);
const phrase = mn.phrase;
const priv = derivePrivateKeyFromMnemonic(phrase, 0);
const address = priv.toPublicKey().toAddress('simnet').toString();

const { createRelayNode } = await import(pathToFileURL(`${KC_SRC}/data/settings/relay-nodes.js`).href);
const relayId = createRelayNode({ name: 'proto-d032-e2e', mnemonic: phrase, address, network: 'simnet', pollMs: 2000 });
console.log(JSON.stringify({ relayId, address }));
