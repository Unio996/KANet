// M0c-1 app envelope — canonical 序列化 + 结构规格（kasia-console 网关侧 + kasia-relay 权威验证侧共用纯函数）
// 设计: docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md §3.2/§3.3（G1 共享库抽取，防两份漂移）
//       + docs/2026-07-23-m0c-1-app-provision-design.md §3（签名/结构规格来源，权威定义）
//
// 抽取范围：只含零 relay 特定依赖的纯函数（canonical 序列化 + 字段结构规格 + 协议常量）。
// grant/registry 读取、`checkIntentBindsCmd`（业务字段绑定，含 custodial_transfer 命令级特判见母卡 §3.3a）、
// 签名验证（需 kaspa-wasm）等 relay 权威验证逻辑不在本模块——那些留在 kasia-relay/src/lib/app-envelope.mjs，
// 本模块只是它们的上游依赖，反向不成立（本模块不 import 任何一侧的业务代码）。
//
// 🔴 verdict-before-push（规则65 门②）: 本次抽取是纯净重构（zero behavior change），不改变
// canonicalJson/envelopeSigningMessage 的输出字节，不改变 ENVELOPE_FIELDS 结构规格——
// kasia-relay/src/lib/app-envelope.mjs 重构为 import 这里的定义，自测（scratch/m0c1-app-provision-selftest.mjs）
// 通过数与重构前逐条一致才算过（不引入新失败）。

import { createHash } from 'node:crypto';

export const ENVELOPE_PROTOCOL = 'kanet-m0c1-app-envelope';
export const ENVELOPE_DOMAIN = 'kanet.m0c1.app-command.v1'; // domain separation (M-1.6 §5)
export const ENVELOPE_VERSION = 1;

// strict 字段规格（app-provision §3 step4）: 恰好这些键、恰好这些类型。多一键/少一键/类型错 = 拒。
export const ENVELOPE_FIELDS = Object.freeze({
  protocol: 'string',
  domain: 'string',
  version: 'number',
  app_key_id: 'string',
  grant_id: 'string',
  relay_id: 'string',
  network: 'string',
  intent_type: 'string',
  intent_version: 'number',
  intent: 'object',
  intent_digest: 'string',
  nonce: 'string',
  issued_at: 'number',
  expires_at: 'number',
  signature: 'string',
});

/**
 * canonical 确定性序列化: 对象键递归字典序; 只允许 JSON-safe 标量; 在场字段全部序列化
 * (绝不静默剥除未知键 — 两份语义不同的载荷不可能产出同一 canonical 字节)。
 * 非法类型 (undefined/NaN/Infinity/BigInt/function) → throw (调用方 fail-closed deny)。
 */
export function canonicalJson(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonical: 非有限 number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) {
      if (v[k] === undefined) throw new Error(`canonical: 键 ${k} 值为 undefined`);
      parts.push(JSON.stringify(k) + ':' + canonicalJson(v[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonical: 不可序列化类型 ${t}`);
}

export function intentDigestOf(intent) {
  return 'sha256:' + createHash('sha256').update(canonicalJson(intent), 'utf8').digest('hex');
}

// G2 (2026-07-23·同 G1 单一真相源纪律): grant scope 判定用到的两个纯函数，gateway 早拒验
// 的 amount cap 检查 + relay 权威 checkIntentWithinGrant 共用同一份，防两份漂移。

/** KAS 十进制字符串 → sompi BigInt (transfer.amount 经 validateCommandPayload coerce 后为 KAS 字符串)。 */
export function kasToSompiBig(s) {
  const m = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`amount 非法 KAS 十进制: ${String(s).slice(0, 32)}`);
  return BigInt(m[1]) * 100000000n + BigInt((m[2] || '').padEnd(8, '0'));
}

/** grant 表里 JSON 字符串数组列（如 allowed_commands/relay_scope/payee_scope）解析，非法 → throw。 */
export function parseJsonStringArray(raw, name) {
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string')) {
    throw new Error(`grant.${name} 非字符串数组`);
  }
  return arr;
}

/** 签名消息 = canonical(全 envelope 去 signature) — 签发端(provision/app SDK)与验证端共用同一定义。 */
export function envelopeSigningMessage(envelope) {
  const { signature, ...unsigned } = envelope;
  return canonicalJson(unsigned);
}

/**
 * strict-reject 结构校验（app-provision §3 step4）: 字段集恰好匹配 ENVELOPE_FIELDS + 每个字段类型恰好匹配。
 * 返回 null = 通过；字符串 = deny 原因（调用方原样转 denyResult，不改措辞）。
 * 纯函数：不做协议/domain/version 值本身的比对（那属于调用方业务判定，见 app-envelope.mjs 后续步骤）。
 */
export function validateEnvelopeStructure(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return 'envelope 缺失/非对象 (§3 step2)';
  for (const k of Object.keys(env)) {
    if (!(k in ENVELOPE_FIELDS)) return `envelope 未知字段 ${k} (strict-reject, §3 step4)`;
  }
  for (const [k, t] of Object.entries(ENVELOPE_FIELDS)) {
    if (!(k in env)) return `envelope 缺字段 ${k} (strict-reject)`;
    if (t === 'object') {
      if (typeof env[k] !== 'object' || env[k] === null || Array.isArray(env[k])) return `envelope.${k} 非对象`;
    } else if (typeof env[k] !== t) {
      return `envelope.${k} 类型错 (需 ${t})`;
    }
  }
  return null;
}
