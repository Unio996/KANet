// delivery-crypto.js — 数字商品「付款后交付」(设计 docs/2026-10-07-j2-digital-goods-delivery-design-v0.2/0.3.md) 的密码学与链接纯函数。
// 零 import、零浏览器专有全局(只用 globalThis.crypto / TextEncoder, 浏览器与 Node ≥19 同一实现), 与 order-receipt.js 同风格 ⇒ 静态页与 console 共用同一份。
//
// 模型(v0.2 §4.B): 商家与买家各自从同一个 orderNonce(128 位) + 订单地址派生:
//   K        = HKDF-SHA256(ikm = nonce, salt = utf8(订单地址), info = "kanet-delivery-v1/aead")        → AES-256-GCM 密钥
//   信箱私钥 = HKDF-SHA256(ikm = nonce, salt = utf8(订单地址), info = "kanet-delivery-v1/mailbox/<ctr>") → 拒绝采样至 1 ≤ k < n(secp256k1 阶)
// 交付物 = AES-GCM(明文; AAD = "kanet-delivery-v1|"+订单地址), 链上 payload = "KDL1" ‖ iv(12) ‖ 密文‖tag。
// 机密性 = nonce 的保密性。🔴 nonce 只许走 URL 片段(#)或页面内, 绝不进查询串/请求 URL/日志(v0.3 §3)——本文件的链接构造与解析函数就是那条规则的唯一实现点。
//
// 信箱地址(P2PK)需要 kaspa-wasm 的 PrivateKey, 本文件不引入它: 调用方注入 kaspa(见 mailboxAddress)。

export const MAGIC = 'KDL1';
export const IV_BYTES = 12;
export const MAX_PLAINTEXT_BYTES = 1024;   // 链接/激活码足够; 上限也约束链上 payload 大小(≈ 4+12+1024+16 字节)
const SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const HEX32_RE = /^[0-9a-f]{32}$/;
const INFO_AEAD = 'kanet-delivery-v1/aead';
const INFO_MAILBOX = 'kanet-delivery-v1/mailbox/';
const AAD_PREFIX = 'kanet-delivery-v1|';
const MAX_SCALAR_TRIES = 16;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const subtle = () => { const s = globalThis.crypto?.subtle; if (!s) throw new Error('delivery-crypto: 需要 WebCrypto(globalThis.crypto.subtle)'); return s; };
const hexToBytes = (h) => { if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new Error('非法 hex'); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function checkInputs(orderNonceHex, orderAddress) {
  if (typeof orderNonceHex !== 'string' || !HEX32_RE.test(orderNonceHex)) throw new Error('delivery-crypto: orderNonceHex 必须是 32 位小写 hex(128 位)');
  if (typeof orderAddress !== 'string' || orderAddress.length < 10 || orderAddress.length > 200) throw new Error('delivery-crypto: orderAddress 缺失或长度异常');
}

async function hkdf32(orderNonceHex, orderAddress, info) {
  const s = subtle();
  const ikm = await s.importKey('raw', hexToBytes(orderNonceHex), 'HKDF', false, ['deriveBits']);
  const bits = await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(orderAddress), info: enc.encode(info) }, ikm, 256);
  return new Uint8Array(bits);
}

/** 纯函数(可测拒绝采样): 对 counter 0.. 依次取 deriveFn(ctr) 的 32 字节, 返回第一个满足 1 ≤ k < n 的私钥 hex。 */
export async function pickScalar(deriveFn) {
  for (let ctr = 0; ctr < MAX_SCALAR_TRIES; ctr++) {
    const b = await deriveFn(ctr);
    const k = BigInt('0x' + bytesToHex(b));
    if (k >= 1n && k < SECP256K1_N) return { privHex: bytesToHex(b), counter: ctr };
  }
  throw new Error('delivery-crypto: 拒绝采样 16 次仍无合法私钥(概率 ≈ 2^-512, 视为实现错误)');
}

/** @returns {Promise<{mailboxPrivHex:string, counter:number}>} 信箱私钥(买家/商家同源派生, 均可事后清扫信箱) */
export async function deriveMailboxKey({ orderNonceHex, orderAddress }) {
  checkInputs(orderNonceHex, orderAddress);
  const { privHex, counter } = await pickScalar((ctr) => hkdf32(orderNonceHex, orderAddress, INFO_MAILBOX + ctr));
  return { mailboxPrivHex: privHex, counter };
}

/** 信箱 P2PK 地址。kaspa 由调用方注入(kaspa-wasm 模块, 需 PrivateKey)。 */
export function mailboxAddress(kaspa, mailboxPrivHex, network) {
  return new kaspa.PrivateKey(mailboxPrivHex).toPublicKey().toAddress(network).toString();
}

async function aeadKey(orderNonceHex, orderAddress, usage) {
  return subtle().importKey('raw', await hkdf32(orderNonceHex, orderAddress, INFO_AEAD), 'AES-GCM', false, usage);
}
const aad = (orderAddress) => enc.encode(AAD_PREFIX + orderAddress);

/**
 * 加密交付物 ⇒ 链上 payload(hex)。plaintext: string(utf-8)或 Uint8Array, ≤ MAX_PLAINTEXT_BYTES。
 * iv 随机(不可复用: 同 nonce 下多次加密不同交付物也安全, 因 iv 每次新取)。_ivForTest 仅测试注入。
 */
export async function encryptDeliverable({ orderNonceHex, orderAddress, plaintext, _ivForTest }) {
  checkInputs(orderNonceHex, orderAddress);
  const pt = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  if (!(pt instanceof Uint8Array) || pt.length === 0) throw new Error('delivery-crypto: plaintext 不能为空');
  if (pt.length > MAX_PLAINTEXT_BYTES) throw new Error(`delivery-crypto: plaintext ${pt.length}B > ${MAX_PLAINTEXT_BYTES}B 上限`);
  const iv = _ivForTest || globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(orderAddress), tagLength: 128 }, await aeadKey(orderNonceHex, orderAddress, ['encrypt']), pt));
  return bytesToHex(enc.encode(MAGIC)) + bytesToHex(iv) + bytesToHex(ct);
}

/** 解密链上 payload(hex)。失败(格式/魔数/长度/AEAD 校验)一律返回 null——垃圾 payload 与他人 payload 自然被忽略, 不抛。成功 ⇒ 明文 string(utf-8; 非 utf-8 ⇒ null)。 */
export async function decryptDeliverable({ orderNonceHex, orderAddress, payloadHex }) {
  checkInputs(orderNonceHex, orderAddress);
  try {
    if (typeof payloadHex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(payloadHex)) return null;
    const b = hexToBytes(payloadHex);
    if (b.length < 4 + IV_BYTES + 16 + 1 || b.length > 4 + IV_BYTES + MAX_PLAINTEXT_BYTES + 16) return null;
    if (dec.decode(b.subarray(0, 4)) !== MAGIC) return null;
    const iv = b.subarray(4, 4 + IV_BYTES), ct = b.subarray(4 + IV_BYTES);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aad(orderAddress), tagLength: 128 }, await aeadKey(orderNonceHex, orderAddress, ['decrypt']), ct);
    return dec.decode(pt);
  } catch { return null; }
}

/**
 * 从读后端返回的地址历史里挑出交付物(v0.3 §1): 只看 isAccepted 且深度 ≥ minDepth 的交易, 第一条解密成功者即是; 其余忽略。
 * @param {{orderNonceHex:string, orderAddress:string, txs:Array<{txid:string,payloadHex?:string,isAccepted:boolean,acceptingBlueScore:number}>, currentBlueScore:number, minDepth?:number}} o
 * @returns {Promise<{status:'delivered', txid:string, plaintext:string}|{status:'pending_depth', needed:number}|{status:'none'}>}
 */
export async function pickDeliverable({ orderNonceHex, orderAddress, txs, currentBlueScore, minDepth = 20 }) {
  let shallow = 0;
  for (const t of txs || []) {
    if (!t || !t.payloadHex) continue;
    const pt = await decryptDeliverable({ orderNonceHex, orderAddress, payloadHex: t.payloadHex });
    if (pt === null) continue;                                   // 先验 AEAD: 只有"真是给这个订单的密文"才谈深度
    if (!t.isAccepted || !Number.isFinite(t.acceptingBlueScore) || !Number.isFinite(currentBlueScore) || currentBlueScore - t.acceptingBlueScore < minDepth) { shallow = Math.max(shallow, 1); continue; }
    return { status: 'delivered', txid: t.txid, plaintext: pt };
  }
  return shallow ? { status: 'pending_depth', needed: minDepth } : { status: 'none' };
}

// ───────── 发票链接: nonce 只走片段(#) —— 唯一实现点 ─────────

/**
 * 商家发票链接。publicParams(q/ch/sc 等公开的报价/渠道参数)走查询串; orderNonceHex 只进 #n=。
 * 任何把 nonce 放进查询串的企图(publicParams 里出现 nonce 的 ≥8 位 hex 子串)一律抛——防调用方手滑。
 */
export function buildInvoiceLink({ baseUrl, publicParams = {}, orderNonceHex }) {
  if (!HEX32_RE.test(orderNonceHex || '')) throw new Error('buildInvoiceLink: orderNonceHex 非法');
  const u = new URL(baseUrl);
  if (u.hash) throw new Error('buildInvoiceLink: baseUrl 不得自带片段');
  for (const [k, v] of Object.entries(publicParams)) {
    if (k === 'n' || k === 'nonce') throw new Error(`buildInvoiceLink: 公开参数不得使用键 ${k}`);
    if (leaksNonce(String(v), orderNonceHex)) throw new Error(`buildInvoiceLink: 公开参数 ${k} 含 nonce 片段 — nonce 只许进片段`);
    u.searchParams.set(k, String(v));
  }
  if (leaksNonce(u.search, orderNonceHex) || leaksNonce(u.pathname, orderNonceHex)) throw new Error('buildInvoiceLink: baseUrl 路径/查询含 nonce 片段');
  u.hash = `n=${orderNonceHex}`;
  return u.toString();
}
/** s 里是否含 nonce 的任何连续 ≥8 位 hex 子串(大小写不敏感)。 */
export function leaksNonce(s, orderNonceHex) {
  const hay = String(s).toLowerCase(), n = orderNonceHex.toLowerCase();
  for (let i = 0; i + 8 <= n.length; i++) if (hay.includes(n.substr(i, 8))) return true;
  return false;
}
/** 从 location.hash 读 nonce; 缺失/非法 ⇒ null。只读片段, 不读 search。 */
export function readNonceFromHash(hash) {
  const m = /^#?(?:.*&)?n=([0-9a-f]{32})(?:&.*)?$/.exec(String(hash || ''));
  return m ? m[1] : null;
}
/** 读取后立即抹掉地址栏里的片段(history.replaceState)。location/history 注入, 便于测试。返回 nonce 或 null。 */
export function takeNonceFromLocation(location, history, documentTitle = '') {
  const n = readNonceFromHash(location.hash);
  if (n) history.replaceState(null, documentTitle, location.pathname + location.search);   // 不带 hash
  return n;
}
