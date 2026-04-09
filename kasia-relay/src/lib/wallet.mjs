// Wallet: BIP39 mnemonic → BIP44 private key → Kaspa address
import * as kaspa from 'kaspa-wasm';

const { PrivateKey, NetworkType, Mnemonic, XPrv } = kaspa;

function getNetworkType(network) {
  switch (network) {
    case 'mainnet': return NetworkType.Mainnet;
    case 'testnet-10':
    case 'testnet-11':
    case 'testnet-12': return NetworkType.Testnet;
    default: throw new Error(`Unsupported network type: ${network}`);
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

function derivedToPrivateKey(derived) {
  if (derived && typeof derived.toPrivateKey === 'function') return derived.toPrivateKey();
  if (PrivateKey && typeof PrivateKey.fromXPrv === 'function') return PrivateKey.fromXPrv(derived);
  if (derived?.privateKey) return derived.privateKey;
  // npm kaspa-wasm ^0.13.0: extract 32-byte privkey from base58-encoded xprv
  if (derived && typeof derived.intoString === 'function') {
    const raw = decodeBase58(derived.intoString('xprv'));
    const privKeyHex = raw.slice(46, 78).toString('hex');
    return new PrivateKey(privKeyHex);
  }
  const keys = derived ? Object.keys(derived) : [];
  throw new Error(`Cannot convert derived key to PrivateKey. Keys: ${keys.join(', ')}`);
}

function derivePrivateKeyFromMnemonic(phrase, accountIndex = 0) {
  const mnemonic = new Mnemonic(phrase);
  const seed = mnemonic.toSeed();
  const xprv = new XPrv(seed);
  const derived = xprv
    .deriveChild(44, true)
    .deriveChild(111111, true)
    .deriveChild(accountIndex, true)
    .deriveChild(0, false)
    .deriveChild(0, false);
  return derivedToPrivateKey(derived);
}

export class KaspaWallet {
  constructor(privateKey, network) {
    this.privateKey = privateKey;
    this.keypair = privateKey.toKeypair();
    this.network = network;
  }

  static fromMnemonic(phrase, network = 'mainnet', accountIndex = 0) {
    if (!phrase) throw new Error('Mnemonic phrase is required');
    try {
      const privateKey = derivePrivateKeyFromMnemonic(phrase, accountIndex);
      return new KaspaWallet(privateKey, network);
    } catch (error) {
      throw new Error(`Invalid mnemonic phrase: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getAddress() { return this.keypair.toAddress(getNetworkType(this.network)).toString(); }
  getPrivateKey() { return this.privateKey; }
  getNetworkType() { return getNetworkType(this.network); }
  getNetworkId() { return this.network; }
}

let walletInstance = null;

export function getWallet() {
  if (!walletInstance) {
    const mnemonic = process.env.KASPA_MNEMONIC;
    const network = process.env.KASPA_NETWORK || 'mainnet';
    const accountIndex = parseInt(process.env.KASPA_ACCOUNT_INDEX || '0', 10);
    if (!mnemonic) throw new Error('KASPA_MNEMONIC environment variable must be set');
    walletInstance = KaspaWallet.fromMnemonic(mnemonic, network, accountIndex);
  }
  return walletInstance;
}
