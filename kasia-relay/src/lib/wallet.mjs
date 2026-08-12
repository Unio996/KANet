// Wallet: BIP39 mnemonic → BIP44 private key → Kaspa address
import * as kaspa from 'kaspa-wasm';

const { PrivateKey, NetworkType, Mnemonic, XPrv } = kaspa;

function getNetworkType(network) {
  switch (network) {
    case 'mainnet': return NetworkType.Mainnet;
    case 'testnet-10':
    case 'testnet-11':
    case 'testnet-12': return NetworkType.Testnet;  // Phase 3a SS testnet (Bettor r193 5/19)
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

/**
 * N5-② · account index 严格解析 —— A2 spec v1.2-rc「两个逃逸口一起钉死」的 relay 侧那一半。
 *
 * 🔴 **旧写法 `parseInt(process.env.KASPA_ACCOUNT_INDEX || '0', 10)` 有两个毛病, 都不报错**:
 *    ① `KASPA_ACCOUNT_INDEX` **全仓一处读、零处写** ⇒ 它只可能来自**继承环境** ——
 *       一个环境变量就能让同一份助记词派生到**另一把钥匙**上(@J1tn `8969aca7` 四臂 ④≠① 实测)。
 *       console 侧已同批改成**显式传**(`buildRelayKeyEnv`), 这里负责**坏值不再静默**。
 *    ② `parseInt` 的坏值行为是**静默取一个别的数**: `parseInt('1e3',10)===1`(不是 1000)、
 *       `parseInt(' 7x',10)===7`、`parseInt('abc',10)===NaN`。
 *       🔴 **NaN 那一支 @J1tn 明确标了"没走到底、别当已知"** ⇒ 本实现**不再让它有机会发生**:
 *          改用 `Number()`(对 `'7x'`/`'abc'` 直接 NaN, 不会截半个数字出来)+ 显式整数校验, **坏值抛**。
 *
 * 🔨 判据: **坏值静默取默认 = 把"配置错了"变成"跑起来了但签的是另一把钥匙"** —— 那是最难查的一类。
 */
export function resolveAccountIndex(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const s = String(raw).trim();
  // 🔴 **只收规范十进制** —— 我第一版写的是 `Number()` + `Number.isInteger`, 被自己的用例抓了:
  //    `Number('1e3') === 1000` 是整数**会被放行**, 而旧 `parseInt('1e3',10) === 1`。
  //    ⇒ **同一个字符串, 两个解析器给出两个不同的数** —— 这正是最该拒的形状:
  //      它不会报错, 只会让"这个 relay 用哪把钥匙"取决于**谁去读那个变量**。
  //    account index 就是个小非负整数, 没有任何理由接受指数/小数/正负号写法。
  if (!/^\d+$/.test(s)) {
    throw new Error(`KASPA_ACCOUNT_INDEX 非法: ${JSON.stringify(raw)} — 只接受规范十进制非负整数(坏值一律抛, 不静默取 0/NaN/别的数)`);
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`KASPA_ACCOUNT_INDEX 非法: ${JSON.stringify(raw)} — 必须是非负整数`);
  }
  return n;
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

  // r281 (Bettor 5/30 — Owner P0): privkey-backed wallet for relays whose key is a raw kaspa privkey
  // (no mnemonic available). Owner钦定: 私钥=控制权, 系统该支持. KaspaWallet constructor already accepts
  // a PrivateKey directly; this factory wraps it for the privkey-relay startup path (getWallet reads
  // KASPA_PRIVKEY env when set, see below).
  static fromPrivateKey(privKeyHex, network = 'mainnet') {
    if (!privKeyHex || typeof privKeyHex !== 'string') throw new Error('privKeyHex (32-byte hex string) required');
    const clean = privKeyHex.startsWith('0x') ? privKeyHex.slice(2) : privKeyHex;
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error('privKeyHex must be 64 hex chars (32 bytes)');
    try {
      return new KaspaWallet(new PrivateKey(clean), network);
    } catch (error) {
      throw new Error(`Invalid private key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getAddress() { return this.keypair.toAddress(getNetworkType(this.network)).toString(); }
  getPrivateKey() { return this.privateKey; }
  getNetworkType() { return getNetworkType(this.network); }
  getNetworkId() { return this.network; }
  /**
   * Generator-compatible networkId (KANet-UI r55 5/24 Layer 4 root cause).
   * vendored kaspa-wasm only knows 'testnet-10' / 'testnet-11' for Generator.networkId.
   * 'testnet-12' raw passes RpcClient OK but Generator constructor throws RuntimeError "unreachable".
   * Map testnet-12 → testnet-10 for Generator only (= same NetworkType.Testnet, wasm-accepted string).
   * RPC connect uses raw getNetworkId() — RpcClient handles testnet-12 fine.
   */
  getGeneratorNetworkId() {
    if (this.network === 'testnet-12') return 'testnet-10';
    return this.network;
  }
}

let walletInstance = null;

export function getWallet() {
  if (!walletInstance) {
    const network = process.env.KASPA_NETWORK || 'mainnet';
    // r281 (Bettor 5/30, Owner P0): privkey-backed relay path takes precedence over mnemonic.
    // Console startRelay sets KASPA_PRIVKEY for relays whose key is a raw kaspa privkey (imported
    // via /api/relay/import-privkey, no mnemonic available — = Owner钦定 privkey-as-control).
    const privKey = process.env.KASPA_PRIVKEY;
    if (privKey) {
      walletInstance = KaspaWallet.fromPrivateKey(privKey, network);
      return walletInstance;
    }
    const mnemonic = process.env.KASPA_MNEMONIC;
    const accountIndex = resolveAccountIndex(process.env.KASPA_ACCOUNT_INDEX);
    if (!mnemonic) throw new Error('KASPA_MNEMONIC or KASPA_PRIVKEY environment variable must be set');
    walletInstance = KaspaWallet.fromMnemonic(mnemonic, network, accountIndex);
  }
  return walletInstance;
}
