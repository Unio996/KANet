// test-framework/lib/app-envelope-sdk.mjs — app 侧信封签发器(测试 SDK)
// 复用 relay 侧 app-envelope.mjs 的 canonical / signing-message 定义(单一真相源, 防签发端与验证端漂移)。
// 设计: docs/2026-07-23-m0c-1-app-provision-harness-design.md §4
//
// 这是"诚实 app"的信封构造器: 给定 intent + grant 凭证, 产出 relay gate 会接受的合法信封。
// 攻击 persona(forger/toctou)在此基础上做篡改(改字段/掉包/错钥签)。

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RELAY_LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../kasia-relay/src/lib');

// 复用 relay 侧定义(canonical/签名消息/常量)—— 签发端与验证端同一份, 语义不可能漂移。
const envMod = await import(pathToFileURL(path.join(RELAY_LIB, 'app-envelope.mjs')).href);
export const { canonicalJson, intentDigestOf, envelopeSigningMessage,
  ENVELOPE_PROTOCOL, ENVELOPE_DOMAIN, ENVELOPE_VERSION } = envMod;

// kaspa-wasm 从 relay node_modules 加载(与 relay 同一份 wasm)。
const kaspa = await import(pathToFileURL(path.resolve(RELAY_LIB, '../../node_modules/kaspa-wasm/kaspa.js')).href);

/**
 * 构造并签名一个合法信封 cmd(诚实 app)。
 * @param {object} p { type, intent, appKeyId, grantId, relayId, network, privkeyHex, ttlMs?, issuedAt?, nonce? }
 * @returns cmd { type, ...intent, __origin:'app', envelope } — 可直接喂 relay-gate-driver.send
 */
export function buildAppCmd(p) {
  const {
    type, intent, appKeyId, grantId, relayId, network, privkeyHex,
    ttlMs = 5 * 60 * 1000, issuedAt, nonce,
  } = p;
  const now = issuedAt ?? Date.now();
  const envelope = {
    protocol: ENVELOPE_PROTOCOL, domain: ENVELOPE_DOMAIN, version: ENVELOPE_VERSION,
    app_key_id: appKeyId, grant_id: grantId, relay_id: relayId, network,
    intent_type: type, intent_version: 1, intent,
    intent_digest: intentDigestOf(intent),
    nonce: nonce ?? ('nonce-' + Math.random().toString(36).slice(2)),
    issued_at: now, expires_at: now + ttlMs,
    signature: '00',
  };
  const priv = new kaspa.PrivateKey(privkeyHex);
  envelope.signature = kaspa.signMessage({ message: envelopeSigningMessage(envelope), privateKey: priv });
  return { type, ...intent, __origin: 'app', envelope };
}

/** 偷合法签名后改一个 envelope 字段(不重签)——伪造者攻击。返回篡改后的 cmd。 */
export function tamperEnvelopeField(cmd, field, value) {
  const env = { ...cmd.envelope, [field]: value };
  return { ...cmd, envelope: env };
}

/** 错私钥重签(偷到信封没偷到私钥)。 */
export function resignWithWrongKey(cmd, wrongPrivHex) {
  const env = { ...cmd.envelope, signature: '00' };
  const priv = new kaspa.PrivateKey(wrongPrivHex);
  env.signature = kaspa.signMessage({ message: envelopeSigningMessage(env), privateKey: priv });
  return { ...cmd, envelope: env };
}

/** 掉包: envelope 签的 intent 不动, 只改 cmd 顶层执行字段(签小执行大)。 */
export function swapExecField(cmd, field, value) {
  return { ...cmd, [field]: value };
}

export function genKeypair() {
  const privHex = Buffer.from(kaspa.PrivateKey.random?.().toString?.() || '', 'hex').length === 32
    ? kaspa.PrivateKey.random().toString()
    : require('node:crypto').randomBytes(32).toString('hex');
  const priv = new kaspa.PrivateKey(privHex);
  return { privHex, xonly: priv.toPublicKey().toXOnlyPublicKey().toString() };
}
