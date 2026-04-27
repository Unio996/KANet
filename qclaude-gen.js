const kaspa = require('./shared/vendor/kaspa-wasm/kaspa.js');
const { Mnemonic, NetworkType, PrivateKey, XPrv } = kaspa;

const mnemonic = Mnemonic.random();
const phrase = mnemonic.phrase;
console.log("PHRASE=" + phrase);

// Use the same approach as wallet.mjs
const seed = mnemonic.toSeed();
const xprv = new XPrv(seed);
const derived = xprv
  .deriveChild(44, true)
  .deriveChild(111111, true)
  .deriveChild(0, true)
  .deriveChild(0, false)
  .deriveChild(0, false);

// Get raw private key from derived xprv
const xprvStr = derived.intoString('xprv');
console.log("xprv=" + xprvStr);

// Extract 32 bytes from base58 xprv (same decode as wallet.mjs)
function decodeBase58(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 0n;
  for (const c of str) result = result * 58n + BigInt(ALPHABET.indexOf(c));
  const hex = result.toString(16).padStart(164, '0');
  return Buffer.from(hex, 'hex');
}

const raw = decodeBase58(xprvStr);
const privKeyHex = raw.slice(46, 78).toString('hex');
console.log("privKeyHex=" + privKeyHex);

const privateKey = new PrivateKey(privKeyHex);
const keypair = privateKey.toKeypair();
const address = keypair.toAddress(NetworkType.Mainnet);
console.log("ADDRESS=" + address.toString());

mnemonic.free();
xprv.free?.();
derived.free?.();
privateKey.free();
keypair.free();
address.free?.();
