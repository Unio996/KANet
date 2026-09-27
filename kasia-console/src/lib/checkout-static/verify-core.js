// verify-core.js — 纯逻辑, 零浏览器全局依赖(document/location/fetch 全不碰), 只依赖调用方注入的
// kaspaWasm 模块对象 + blake2b 函数。checkout.js(真实浏览器页面)与
// docs/provenance/.../verify_core_parity_test.mjs(Node 侧与 commission-plan-sdk.mjs 逐字节对比测试)
// 共用同一份代码——保证"浏览器里跑的逻辑"与"SDK 里跑的逻辑"是同一份实现, 不是分别维护两份可能
// 悄悄分叉的平行代码。
//
// 算法逐字对应 commission-plan-sdk.mjs 的 canonicalQuoteBytes/verifyQuoteSignature/verifyChain/
// dedupAndCapChannelSpks/spkBytesFromAddress——不能直接 import 那个文件(它 import 了
// pool-bshard-artifacts.mjs/generic-entry-witness.mjs 等一整串 Node-only 依赖), 独立重写但保持
// 算法逐条一致，靠下方 Node 测试(zero-diff against real SDK output)守住不分叉。

export const SIGCHAIN_DOMAIN = 'KANET-COMMISSION-CHAIN-V1';
export const MAX_CHANNELS = 5;

export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

export function canonicalQuoteBytes(quote) {
  const { signature_hex, ...rest } = quote;
  return new TextEncoder().encode(canonicalJson(rest));
}

export function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
export function b64urlToBytes(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function verifyQuoteSignature(kaspaWasm, quote) {
  if (!quote.signature_hex || !quote.merchant_pubkey_hex) return false;
  const msgHex = bytesToHex(canonicalQuoteBytes(quote));
  try { return !!kaspaWasm.verifyMessage({ message: msgHex, signature: quote.signature_hex, publicKey: quote.merchant_pubkey_hex }); }
  catch { return false; }
}

function concatBytes(...arrs) {
  const total = arrs.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

export function chainDigest0(kaspaWasm, blake2b, quote, network) {
  const qh = blake2b(canonicalQuoteBytes(quote), { dkLen: 32 });
  return blake2b(concatBytes(new TextEncoder().encode(SIGCHAIN_DOMAIN), qh, new TextEncoder().encode(network)), { dkLen: 32 });
}

function chainMessageBytes(prevDigest, position, addressSpk, signingPubkey) {
  return concatBytes(prevDigest, new Uint8Array([position & 0xff]), addressSpk, signingPubkey);
}

export function verifyChain(kaspaWasm, blake2b, quote, entries, network) {
  if (entries.length > MAX_CHANNELS) return { ok: false, reason: `签名链长度 ${entries.length} > 上限 ${MAX_CHANNELS}, 结构性拒绝` };
  let d = chainDigest0(kaspaWasm, blake2b, quote, network);
  for (let k = 1; k <= entries.length; k++) {
    const e = entries[k - 1];
    if (e.position !== k) return { ok: false, reason: `位置不连续, 期望 ${k} 实际 ${e.position}` };
    const msg = chainMessageBytes(d, k, e.address_spk, e.signing_pubkey);
    let valid;
    try { valid = !!kaspaWasm.verifyMessage({ message: bytesToHex(msg), signature: e.sig, publicKey: bytesToHex(e.signing_pubkey) }); }
    catch { valid = false; }
    if (!valid) return { ok: false, reason: `第 ${k} 环签名校验失败` };
    d = blake2b(msg, { dkLen: 32 });
  }
  return { ok: true, chainDigest: d, channelSpks: entries.map(e => e.address_spk) };
}

export function spkBytesFromAddress(kaspaWasm, addrStr) {
  const spk = kaspaWasm.payToAddressScript(new kaspaWasm.Address(addrStr));
  const versionBytes = new Uint8Array([spk.version & 0xff, (spk.version >> 8) & 0xff]);
  const scriptHexBytes = new Uint8Array(spk.script.length / 2);
  for (let i = 0; i < scriptHexBytes.length; i++) scriptHexBytes[i] = parseInt(spk.script.substr(i * 2, 2), 16);
  return concatBytes(versionBytes, scriptHexBytes);
}

export function dedupAndCapChannelSpks(kaspaWasm, rawAddrs) {
  if (rawAddrs.length > MAX_CHANNELS) return { ok: false, reason: `原始位置数 ${rawAddrs.length} > 上限 ${MAX_CHANNELS}` };
  const seen = []; const spks = [];
  for (let i = 0; i < rawAddrs.length; i++) {
    let spk;
    try { spk = spkBytesFromAddress(kaspaWasm, rawAddrs[i]); }
    catch (e) { return { ok: false, reason: `第 ${i + 1} 个渠道地址无法解析为标准地址(${e.message})` }; }
    const spkHex = bytesToHex(spk);
    spks.push(seen.includes(spkHex) ? null : spk);
    if (!seen.includes(spkHex)) seen.push(spkHex);
  }
  return { ok: true, spks };
}
