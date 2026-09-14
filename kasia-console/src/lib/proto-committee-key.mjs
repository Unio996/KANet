// proto-committee-key.mjs — 原型 v0 委员会/bettor 兼任 keypair 生成+存储 helper(接线笔③,
// 设计 §5/§0, Bettor 1354 三项纪律): 真调 crypto.js 既有 encrypt/decrypt(不自己发明加密方案) /
// 无明文暂存(含日志、错误信息, 本文件任何函数都不 log 任何参数或返回值) / 无第二份存储(只落
// proto_markets.committee_privkey_enc 这一份加密副本, 不进 relay_nodes, 不被
// relay-hotwallet-monitor 扫到, 不"顺手也存一份明文方便调试")。
//
// v0 单操作员模型(§5, Bettor GREEND-with-rulings): 5 槽委员会 + 兼任 bettor 身份, 全部共用
// 同一把一次性生成的 keypair——不是每个委员/每笔下注各生成一把。

import { encrypt, decrypt } from '../services/crypto.js';

/**
 * 生成一次性委员会 keypair。返回值里 privKeyHex 是明文——调用方必须立即调
 * encryptCommitteePrivkey() 拿到密文存库, 不允许把这个返回值原样存进任何持久化位置、
 * 不允许 log 它、不允许把它放进错误对象/消息里(违反"无明文暂存"纪律)。
 * @returns {Promise<{privKeyHex: string, pubkeyHex: string}>}
 */
export async function generateCommitteeKeypair() {
  const { PrivateKey } = await import('kaspa-wasm');
  const { randomBytes } = await import('node:crypto');
  const priv = new PrivateKey(randomBytes(32).toString('hex'));
  return {
    privKeyHex: priv.toString(),
    pubkeyHex: priv.toPublicKey().toXOnlyPublicKey().toString(),
  };
}

/**
 * 加密存储——本文件对外暴露的唯一"持久化形式"。落 proto_markets.committee_privkey_enc
 * 这一份(调用方负责写库, 本函数只管加密, 不碰 DB), 不做第二份(比如"再存一份到别的表/文件方便
 * debug"这种事)。
 * @param {string} privKeyHex
 * @returns {string} crypto.js encrypt() 产出的 JSON 信封字符串(v1/aes-256-gcm/iv/tag/ciphertext)
 */
export function encryptCommitteePrivkey(privKeyHex) {
  return encrypt(privKeyHex);
}

/**
 * 解密——调用方必须"就地用掉"(签名/派生地址后立即丢弃引用, 不存进任何变量之外的地方、不 log、
 * 不放进错误消息)。本函数本身不做任何 logging(哪怕是调试用的), 也不缓存解密结果。
 * @param {string} envelope
 * @returns {string} privKeyHex 明文
 */
export function decryptCommitteePrivkey(envelope) {
  return decrypt(envelope);
}
