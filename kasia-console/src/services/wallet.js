// Derive Kaspa address from mnemonic (BIP44 m/44'/111111'/0'/0/0)
import { Mnemonic, XPrv, NetworkType } from 'kaspa-wasm';

function getNetworkType(network) {
  switch (network) {
    case 'mainnet': return NetworkType.Mainnet;
    case 'testnet-10':
    case 'testnet-11': return NetworkType.Testnet;
    default: return NetworkType.Mainnet;
  }
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
  const privateKey = derived.toPrivateKey();
  const keypair = privateKey.toKeypair();
  return keypair.toAddress(getNetworkType(network)).toString();
}
