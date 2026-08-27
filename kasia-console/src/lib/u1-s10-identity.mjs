// §10 跨节点 pubkey 身份 v1 · S10 信封 + 纯函数验证器 (C1, 2026-08-27, J2)
// 设计: docs/2026-08-19-s10-pubkey-identity-design.md @847bcf22 (L1/L2/L3, MUST-FIX A/B/C, P1/P4/P7/P8/P9)
// 切片: docs/2026-08-27-j2-s10-commit-slice-plan-v0.1.md C1 · 实施计划 v0.3 bd01ac89 #1/#2
//
// 🔴 本模块【零 DB、零 IPC、零 relay 访问】(L3/P4): 远端身份验证是纯密码学、payload 自足; 谁在这里查 relay_nodes / 调 relay,
//    那本身就是 L3 违规。绑定 relay_id ↔ pubkey 是注册流(C3)的 L5 事, 不在验证器里。
// 🔴 network 取【本地权威】(MUST-FIX A / P7): 调用方只能把本地配置传进来; 本模块独立比对 env.network === localNetwork,
//    不等 ⇒ 拒。payload 自报的 network 永远不是权威(J1 (543) 实测: 用 payload network 重建 ⇒ 验签 TRUE = 跨网重放成立)。
// 🔴 operation 硬白名单 (P9): v1 只收 'register'; rotate/revoke/未知 —— 签名再合法也拒(否则预留域退化成别名)。
// 🔴 L1 归一与建键同址 (J1 (541) 实测承重①): kaspa-wasm 接受大写 hex 并归一 ⇒ 同钥两串在原语层是合法别名,
//    小写 /^[0-9a-f]{64}$/ 是唯一防线, 本模块导出 assertCanonicalPubkey 供注册流建键前【同一函数】复用。
// 🔴 crypto 失败两路都拒 (J1 (541) 实测承重②): verifyMessage 对篡改/错钥/128 位垃圾返 false, 对长度错签名【throw】
//    ('Invalid input length 128'); 不 try/catch = 500, catch 后 skip = 闸变装饰 ⇒ throw 与 false 同拒。
// 🔴 canonical 字节【设计层冻结】(MUST-FIX B): 6 字段固定序, 各 u32be(len) ‖ utf8(value) 串接; 被签消息 =
//    prefix ‖ network ‖ '|' ‖ lowerhex(sha256(canonical)); prefix = domain ‖ '-v' ‖ version ‖ '|' 【派生非字面量】
//    (bump 版本时前缀随 domain/version 自动移, 老签名天然落旧域)。golden vectors: artifacts/2026-08-19-s10-golden-vectors-v1.json
//    (J1 第二实现已逐字节对拍; 签名非锚 —— kaspa-wasm signMessage aux-rand 非确定)。
import { createHash } from 'node:crypto';

export const S10_DOMAIN = 'KANET-U1-IDENTITY';
export const S10_VERSION = '1';
export const S10_OPERATIONS = Object.freeze(['register']);                 // v1 硬白名单 (P9)
export const S10_NETWORKS = Object.freeze(['testnet-12', 'mainnet']);      // L2 闭枚举
export const S10_FIELDS = Object.freeze(['domain', 'version', 'network', 'relayPubkeyXOnly', 'operation', 'epoch']);   // canonical 固定序
export const S10_ENVELOPE_KEYS = Object.freeze([...S10_FIELDS, 'signature']);                                              // 信封 7 键(白名单)
export const S10_PUBKEY_RE = /^[0-9a-f]{64}$/;                              // L1: 恰 32 字节 x-only, 小写 hex, 不归一

export const S10_REJECT = Object.freeze({
  MALFORMED: 'MALFORMED',                                 // 非对象 / 键不在白名单 / 字段非字符串或空
  DOMAIN_VERSION_MISMATCH: 'DOMAIN_VERSION_MISMATCH',     // domain/version 与本验证方不同(老签名落旧域)
  NETWORK_MISMATCH: 'NETWORK_MISMATCH',                   // env.network ≠ 本地权威 network(含本地配置本身不在闭枚举)
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',         // operation ∉ S10_OPERATIONS(签名合法也拒)
  PUBKEY_NOT_CANONICAL: 'PUBKEY_NOT_CANONICAL',           // L1: 非小写 64-hex 或 kaspa-wasm 不能解析
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',                 // verifyMessage 返 false【或 throw】
});

const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** canonical 字节 (MUST-FIX B (b) 长度前缀串接): 6 字段固定序, 各 u32be(utf8 len) ‖ utf8. 只编码不判语义。 */
export function canonicalBytes(fields) {
  const f = fields || {};
  const parts = [];
  for (const k of S10_FIELDS) {
    if (!isStr(f[k])) throw new TypeError(`canonicalBytes: field ${k} must be a non-empty string`);
    const v = Buffer.from(f[k], 'utf8');
    parts.push(u32be(v.length), v);
  }
  return Buffer.concat(parts);
}

/** prefix 派生: domain ‖ '-v' ‖ version ‖ '|' (v1 = 'KANET-U1-IDENTITY-v1|'); 不是字面量, 随 domain/version 移。 */
export const s10Prefix = (domain = S10_DOMAIN, version = S10_VERSION) => `${domain}-v${version}|`;

export const s10CanonicalSha256Hex = (fields) => createHash('sha256').update(canonicalBytes(fields)).digest('hex');

/** 被签消息 = prefix ‖ network ‖ '|' ‖ lowerhex(sha256(canonical)). network 明文既在 hash 外也在 hash 内(两处同源, 由 verify 保证)。 */
export function s10SignedMessage(fields) {
  const f = fields || {};
  return `${s10Prefix(f.domain, f.version)}${f.network}|${s10CanonicalSha256Hex(f)}`;
}

/**
 * L1 入口校验(拒非规范形, 贵活之前): 小写 64-hex ∧ kaspa-wasm 能解析为 x-only 点。
 * 🔴 不归一: 大写/0x/短串一律拒(原语会接受大写并归一 ⇒ 若这里 toLowerCase, 同钥两串就成了合法别名)。
 * @param {string} hex
 * @param {{ parseXOnly?: (hex:string)=>unknown }} [opts]  parseXOnly 仅供测试注入; 默认 kaspa-wasm XOnlyPublicKey
 */
export async function assertCanonicalPubkey(hex, opts = {}) {
  if (typeof hex !== 'string' || !S10_PUBKEY_RE.test(hex)) {
    return { ok: false, code: S10_REJECT.PUBKEY_NOT_CANONICAL, reason: 'relayPubkeyXOnly 须恰 64 位【小写】hex(不归一: 大写/0x/长度不对一律拒)' };
  }
  try {
    const parse = opts.parseXOnly || (async (h) => { const { XOnlyPublicKey } = await import('kaspa-wasm'); return new XOnlyPublicKey(h); });
    const pk = await parse(hex);
    const back = typeof pk?.toString === 'function' ? pk.toString() : null;
    if (back !== hex) return { ok: false, code: S10_REJECT.PUBKEY_NOT_CANONICAL, reason: `kaspa-wasm 解析后回写 ${back} ≠ 输入(不是规范串)` };
    return { ok: true, relayPubkeyXOnly: hex };
  } catch (e) {
    return { ok: false, code: S10_REJECT.PUBKEY_NOT_CANONICAL, reason: `kaspa-wasm 不能解析为 x-only 点: ${e?.message || e}` };
  }
}

/**
 * 验证一份 S10 信封 { domain, version, network, relayPubkeyXOnly, operation, epoch, signature }。
 * 顺序(便宜在前、贵活在后, 每步 fail-closed):
 *   ① 形状: 对象, 键 ⊆ 白名单 7 键且 7 键齐、皆非空字符串(signature 允许首尾空白, 其余不 trim: canonical 字节严格)
 *   ② domain/version === 本验证方常量 (老版本签名落旧域, 不跨版本冒充)
 *   ③ network: 本地权威 localNetwork 须 ∈ S10_NETWORKS 且 env.network === localNetwork (MUST-FIX A; 不读 payload 当权威)
 *   ④ operation ∈ S10_OPERATIONS (P9, === 白名单)
 *   ⑤ L1 pubkey 规范形
 *   ⑥ verifyMessage({ message: s10SignedMessage(env), signature, publicKey: env.relayPubkeyXOnly }) —— 公钥【只】取 payload (P1);
 *      false 与 throw 同拒 (J1 (541) ②)
 * @param {object} env
 * @param {{ localNetwork: string, verifyMessageFn?: Function, parseXOnly?: Function }} opts
 *        localNetwork 必传 = 本地配置(KASPA_NETWORK 等); 缺 ⇒ 拒(NETWORK_MISMATCH), 绝不回落到 env.network。
 *        verifyMessageFn / parseXOnly 仅供测试注入; 生产走 kaspa-wasm。
 * @returns {{ok:true, relayPubkeyXOnly:string, operation:string, epoch:string, network:string, signedMessage:string} | {ok:false, code:string, reason:string}}
 */
export async function verifyS10Envelope(env, opts = {}) {
  const rej = (code, reason) => ({ ok: false, code, reason });
  // ① 形状
  if (!env || typeof env !== 'object' || Array.isArray(env)) return rej(S10_REJECT.MALFORMED, 's10 须是对象');
  const keys = Object.keys(env);
  const extra = keys.filter(k => !S10_ENVELOPE_KEYS.includes(k));
  if (extra.length) return rej(S10_REJECT.MALFORMED, `s10 含白名单外的键: ${extra.join(',')}`);
  for (const k of S10_ENVELOPE_KEYS) if (!isStr(env[k])) return rej(S10_REJECT.MALFORMED, `s10.${k} 缺或非非空字符串`);
  const signature = env.signature.trim();
  if (!signature) return rej(S10_REJECT.MALFORMED, 's10.signature 空');
  // ② domain / version
  if (env.domain !== S10_DOMAIN || env.version !== S10_VERSION) {
    return rej(S10_REJECT.DOMAIN_VERSION_MISMATCH, `domain/version ${env.domain}/${env.version} ≠ 本验证方 ${S10_DOMAIN}/${S10_VERSION}(老签名落旧域, 不跨版本认)`);
  }
  // ③ network: 本地权威
  const localNetwork = opts.localNetwork;
  if (!isStr(localNetwork) || !S10_NETWORKS.includes(localNetwork)) {
    return rej(S10_REJECT.NETWORK_MISMATCH, `本地权威 network 缺或不在闭枚举 ${S10_NETWORKS.join('|')}: ${String(localNetwork)} ⇒ 拒(绝不回落到 payload 的 network)`);
  }
  if (env.network !== localNetwork) return rej(S10_REJECT.NETWORK_MISMATCH, `env.network=${env.network} ≠ 本地权威 ${localNetwork}(跨网重放拒, MUST-FIX A)`);
  // ④ operation
  if (!S10_OPERATIONS.includes(env.operation)) return rej(S10_REJECT.OPERATION_NOT_ALLOWED, `operation=${env.operation} ∉ ${S10_OPERATIONS.join('|')}(v1 register-only; 签名合法也拒)`);
  // ⑤ L1
  const l1 = await assertCanonicalPubkey(env.relayPubkeyXOnly, { parseXOnly: opts.parseXOnly });
  if (!l1.ok) return l1;
  // ⑥ 验签: 公钥只取 payload (P1); 消息由 6 canonical 字段重建(network 用 env.network, 已与本地权威相等)
  const message = s10SignedMessage(env);
  const verify = opts.verifyMessageFn || (async (args) => { const { verifyMessage } = await import('kaspa-wasm'); return verifyMessage(args); });
  let valid = false;
  try { valid = await verify({ message, signature, publicKey: env.relayPubkeyXOnly }); }
  catch (e) { return rej(S10_REJECT.SIGNATURE_INVALID, `verifyMessage threw: ${e?.message || e}(异常与 false 同拒)`); }
  if (valid !== true) return rej(S10_REJECT.SIGNATURE_INVALID, 'verifyMessage 返 false(消息/签名/公钥不匹配)');
  return { ok: true, relayPubkeyXOnly: env.relayPubkeyXOnly, operation: env.operation, epoch: env.epoch, network: env.network, signedMessage: message };
}
