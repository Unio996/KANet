// Derive Kaspa address from mnemonic (BIP44 m/44'/111111'/0'/0/0)
import { Mnemonic, XPrv, PrivateKey, NetworkType } from 'kaspa-wasm';

function getNetworkType(network) {
  switch (network) {
    case 'mainnet': return NetworkType.Mainnet;
    case 'testnet-10':
    case 'testnet-11': return NetworkType.Testnet;
    default: return NetworkType.Mainnet;
  }
}

// Decode base58 string to Buffer (for extracting raw private key from xprv)
function decodeBase58(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 0n;
  for (const c of str) result = result * 58n + BigInt(ALPHABET.indexOf(c));
  const hex = result.toString(16).padStart(164, '0');
  return Buffer.from(hex, 'hex');
}

export function addressFromMnemonic(phrase, network = 'mainnet') {
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed();
  const xprv = new XPrv(seed);
  const derived = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(0, true)
    .deriveChild(0, false)
    .deriveChild(0, false);

  // Extract 32-byte private key from the base58-encoded xprv
  // xprv layout: [4 version][1 depth][4 fingerprint][4 child][32 chaincode][1 0x00][32 privkey][4 checksum]
  const raw = decodeBase58(derived.intoString('xprv'));
  const privKeyHex = raw.slice(46, 78).toString('hex');

  const privateKey = new PrivateKey(privKeyHex);
  const keypair = privateKey.toKeypair();
  return keypair.toAddress(getNetworkType(network)).toString();
}
