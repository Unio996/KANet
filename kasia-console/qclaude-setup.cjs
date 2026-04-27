const kaspa = require("../shared/vendor/kaspa-wasm/kaspa.js");
const { Mnemonic, NetworkType, XPrv } = kaspa;

const mnemonic = Mnemonic.random();
const phrase = mnemonic.phrase;
const seed = mnemonic.toSeed();
const xprv = new XPrv(seed);
const derived = xprv.deriveChild(44, true).deriveChild(111111, true).deriveChild(0, true).deriveChild(0, false).deriveChild(0, false);
const privateKey = derived.toPrivateKey();
const keypair = privateKey.toKeypair();
const address = keypair.toAddress(NetworkType.Mainnet);

console.log("PHRASE=" + phrase);
console.log("ADDRESS=" + address.toString());

mnemonic.free();
xprv.free?.();
derived.free?.();
privateKey.free();
keypair.free();
address.free?.();
