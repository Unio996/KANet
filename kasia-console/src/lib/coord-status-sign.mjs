// coord-status-sign.mjs — D-010 落地①(J1tn, 2026-07-10): coord-status 频道内容签名门核心逻辑。
//
// 信任根 = 内容显式签名(blake2b(content) + relay 私钥 schnorr 签名),不是 sender_address——
// 今晚 scout 归因卡(D-010 finding①副产出)证实被动扫链拿密码学 input 归因在现有 kaspad RPC 下
// 结构性做不到(WONT-FIX),本模块是唯一正解路径。签名/验签本身用 kaspa-wasm 的 signMessage/
// verifyMessage(底层 schnorr,历史上被项目内命名成"ecdsa_sign"是遗留误命名,非真 ECDSA)。
//
// 格式(docs/2026-07-10-d010-handoff-status-channel-proposal.md §2.1):
//   <正文...>
//   SIG:<hex>
// SIG 行本身不参与哈希——签名覆盖的是"SIG: 行之前的全部内容"(含末尾换行前的最后一行),
// 验签端必须原样重建同一段字节再算 hash,否则永远验不过(同 trade-protocol-filter.js 的
// "剥离 signature 字段后重建同一份 JSON" 纪律,这里是文本版)。

import { blake2b } from '@noble/hashes/blake2b';

const SIG_LINE_PREFIX = 'SIG:';

/**
 * computeContentHashHex — blake2b(content, dkLen=32) 转 hex,项目既有惯例
 * (同 gate-tmpl-hash.mjs 的 Buffer.from(blake2b(...)).toString('hex') 写法)。
 * @param {string} content
 * @returns {string} 64 字符 hex
 */
export function computeContentHashHex(content) {
  return Buffer.from(blake2b(Buffer.from(content, 'utf8'), { dkLen: 32 })).toString('hex');
}

/**
 * splitSignedMessage — 从完整消息文本里拆出"待验签正文"和"签名 hex"。
 * 规则:最后一个以 "SIG:" 开头的行是签名行,该行(连同其前的换行符)被剥离后,
 * 剩余文本(去掉末尾多余空白)= 被签名的原文。
 * @param {string} fullText
 * @returns {{content: string, signature: string|null}} signature=null 表示没找到 SIG 行(未签名消息)
 */
export function splitSignedMessage(fullText) {
  const lines = String(fullText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith(SIG_LINE_PREFIX)) {
      const signature = line.slice(SIG_LINE_PREFIX.length).trim();
      const content = lines.slice(0, i).join('\n').replace(/\s+$/, '');
      return { content, signature: signature || null };
    }
    if (line.trim() !== '') break; // 非空行且不是 SIG: 开头 → 从末尾起没有签名行, 停止往上找
  }
  return { content: String(fullText || '').replace(/\s+$/, ''), signature: null };
}

/**
 * buildSignedMessage — 拼装"正文 + SIG 行"的完整消息文本(签名产出侧用)。
 * @param {string} content
 * @param {string} signatureHex
 * @returns {string}
 */
export function buildSignedMessage(content, signatureHex) {
  return `${content}\n${SIG_LINE_PREFIX}${signatureHex}`;
}

/**
 * verifyCoordStatusMessage — 读端验签入口。fail-closed: 任何解析/验签异常一律 valid=false,
 * 不抛异常吞掉真相(读端调用方应该把 valid=false 当"消息不存在"处理,同 D-010 §2.1 铁律)。
 * @param {string} fullText  完整消息文本(含 SIG: 行)
 * @param {string} publicKeyHex  已知的 relay x-only pubkey(64 hex 字符),由调用方提供
 *   ——不从消息本身或本地 DB 派生,避免"两条推导路径没被证明位级相同"的隐患(同 NWT 审查提醒)。
 * @returns {{valid: boolean, content: string, signature: string|null, error?: string}}
 */
export async function verifyCoordStatusMessage(fullText, publicKeyHex) {
  const { content, signature } = splitSignedMessage(fullText);
  if (!signature) return { valid: false, content, signature: null, error: 'no SIG: line found' };
  if (!publicKeyHex) return { valid: false, content, signature, error: 'publicKeyHex required' };
  try {
    const { verifyMessage } = await import('kaspa-wasm');
    const hashHex = computeContentHashHex(content);
    const valid = verifyMessage({ message: hashHex, signature, publicKey: publicKeyHex });
    return { valid: !!valid, content, signature };
  } catch (err) {
    return { valid: false, content, signature, error: err.message };
  }
}
