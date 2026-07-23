// M0c-1 app provision — 签名能力信封验证 (authorizeAppCommand 完整链, 批3 stub 填实)
// 设计: docs/2026-07-23-m0c-1-app-provision-design.md §3 (step2-7)
//       + 母卡 docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md §4.1/§4.2/§5
//       + M-1.6 §5 canonical 信封要求 (docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md)
//
// 🔴 签名范围 (v0.2 MUST-FIX·立身之本): 验签绑「全 canonical envelope 去 signature 字段」——
//   protocol/domain/version + app_key_id + grant_id + relay_id + network + intent(全字段)
//   + intent_digest + nonce + issued_at + expires_at 全部在签名字节内 (M-1.6 §5 "任一字段变化
//   必须使签名失效")。只签 intent 的窄化 = 换 nonce 重放绕 M0c-3 / 跨 relay·network·grant 重放
//   / expiry 延期复用, 全被全信封绑签焊死 (§6 测试 10)。
// 🔴 strict-reject (§3 step4·对全信封): 未知字段 / 缺字段 / 类型错 → 拒。canonicalJson 序列化
//   在场的全部字段、不静默剥除任何键 (反 unknown-field 碰撞, memory
//   reference-feerules-hash-commit-unknown-field-collision)。
// 🔴 verify-value-source + TOCTOU (§3 step5 + M1-6): envelope.intent 字段集与值必须 === cmd 的
//   业务字段集与值 (relay switch 执行消费的同一字段, 禁旁支/re-parse) — "验的对象==执行的对象";
//   验证通过后 deepFreeze(cmd) (gate→switch 间现无 cmd 突变点[relay.mjs 已核], 冻结防未来引入)。
// 🔴 fail-closed (M1-4): 任一步失败/任何解析异常 → deny, 不推进状态。
// 🔶 nonce/replay (§3 step6): 本模块只做格式校验 + nonce 已在签名范围内; durable replay 校验
//   = M0c-3 接口 (设计 0b78d33a), 禁内存 nonce 占位。诚实边界: M0c-3 落地前, expiry 窗口内的
//   原样重放不被拦 (窗口由 MAX_ENVELOPE_TTL_MS 收紧)。
// 🔶 细粒度逐维度 scope (covenant witness/outputs 派生等复杂结构) = M0c-2 (设计 9ccfa6e7);
//   本模块是 M0c-1 粗粒度 intent⊆grant: 命令白名单 + relay/network + 标量维度 + 有效期/吊销。

import * as kaspa from 'kaspa-wasm';
import { getGrantFresh } from './grant-registry.mjs';
// M0c-1 §3.3a v0.4 (custodial_transfer 专属绑定器): relay 独立密码学核验派生地址 (KaspaWallet
// 已有能力, 不需要新数据访问权限——relay 不持有 CONSOLE_ENCRYPTION_KEY, 不碰 tg_custodial_wallets 表)。
import { KaspaWallet } from './wallet.mjs';
// G1 (2026-07-23·verdict-before-push 规则65 门②): canonical 序列化 + 结构规格纯函数抽到
// shared/lib/app-envelope-canonical.mjs（kasia-console 网关早拒验 + kasia-relay 权威验证共用，
// 防两份漂移）。零行为变化重构——canonicalJson/envelopeSigningMessage/intentDigestOf 输出字节
// 与重构前逐位一致（byte-identical 交叉验证见 scratch/ 自测脚本，Bettor `#`钉死 DoD）。
import {
  ENVELOPE_PROTOCOL,
  ENVELOPE_DOMAIN,
  ENVELOPE_VERSION,
  ENVELOPE_FIELDS,
  canonicalJson,
  envelopeSigningMessage,
  intentDigestOf,
  validateEnvelopeStructure,
  kasToSompiBig,
  parseJsonStringArray,
} from '../../../shared/lib/app-envelope-canonical.mjs';

export { ENVELOPE_PROTOCOL, ENVELOPE_DOMAIN, ENVELOPE_VERSION, canonicalJson, envelopeSigningMessage, intentDigestOf };

// envelope 生命周期上限: 收紧 M0c-3 前的重放窗诚实残留 (nonce durable 校验落地前唯一时间闸)。
const MAX_ENVELOPE_TTL_MS = 60 * 60 * 1000; // 1h
const ISSUED_AT_SKEW_MS = 2 * 60 * 1000;    // 容忍 app/relay 时钟偏差

// cmd 上的基础设施字段 (非业务语义, 不参与 intent==cmd 绑定):
//   type/action = 命令路由 (intent_type 单独绑), envelope = 信封本体,
//   __origin = sendCommandAsync 权威设置 (批A), requestId = IPC 回执关联。
const CMD_INFRA_FIELDS = new Set(['type', 'action', 'envelope', '__origin', 'requestId']);

// M0c-1 §3.3a (custodial_transfer 专属绑定器) 落码硬性要求 (NWT 红队 implementation-note 钉死·
// v0.3/v0.4 设计文档 §3.3a 第3点): privkeyHex 这类"执行专属、app 绝不可声明"的字段, 排除必须按
// cmd.type 命令类型门控, 绝不能实现成全局字段名黑名单——否则给 verify-value-source 完整性开逃
// 生舱后门 (任何命令类型只要塞个叫 privkeyHex 的字段就能跳过对应绑定检查)。目前唯一条目 =
// custodial_transfer; 未来若有第二个"执行专属字段"命令, 逐条加, 不共享排除逻辑。
const PER_TYPE_EXCLUDE_FIELDS = Object.freeze({
  custodial_transfer: Object.freeze(new Set(['privkeyHex'])),
});

// M0c-1 粗粒度标量维度抽取表 (§3 step5): 字段名 == relay switch 执行消费的同一字段
// (commands.mjs COMMAND_PAYLOAD_SCHEMA: transfer={target,amount}, stake_unlock_tx.to_address,
//  get_per_bet_address.marketId, prediction_refund_tx.branch, *_settle_tx.winner)。
// grant 对应 scope 列 NULL = 该维度未授权 → intent 触及即拒 (缺维度默认最严)。
const SCALAR_DIMENSIONS = Object.freeze([
  { dim: 'payee', fields: ['target', 'to_address'], grantCol: 'payee_scope', kind: 'membership' },
  { dim: 'amount', fields: ['amount'], grantCol: 'max_amount_sompi', kind: 'amount' },
  { dim: 'market', fields: ['marketId'], grantCol: 'market_scope', kind: 'membership' },
  { dim: 'branch', fields: ['branch', 'winner'], grantCol: 'branch_scope', kind: 'membership' },
  // Path B pilot 围栏 §2.1 (docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md·J1 relay 侧定案):
  // custodial_transfer intent 含 fromAddress 时才触发 (循环里 `if (!(f in env.intent)) continue`
  // 天然只对声明了这个字段的命令类型生效, 现网唯一是 custodial_transfer)——限定"从哪个托管钱包出账"
  // 只能是 grant 授权的地址集合, NULL=未授权→intent 含 fromAddress 即拒 (缺维度默认最严同族纪律)。
  // 这是 checkCustodialTransferBinding 密码学核验(哪把 key 对应这个地址)之外的独立第二层: 前者证
  // "cmd.privkeyHex 确实是这个 fromAddress 的钥匙", 本条证"这个 fromAddress 本身是被授权动用的"。
  { dim: 'source', fields: ['fromAddress'], grantCol: 'source_scope', kind: 'membership' },
]);

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEq(a[ka[i]], b[kb[i]])) return false;
  }
  return true;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * intent 字段集+值 === cmd 业务字段集+值 (verify-value-source: 验的值==执行消费的值)。
 * @param {string} cmdType 命令类型, 决定 PER_TYPE_EXCLUDE_FIELDS 命令级排除表 (§3.3a 硬性要求：
 *   per-type 门控, 非全局黑名单——同一 cmdType 参数保证排除逻辑不会泄漏到其他命令类型)。
 */
function checkIntentBindsCmd(intent, cmd, cmdType) {
  const extraExclude = PER_TYPE_EXCLUDE_FIELDS[cmdType]; // undefined 为绝大多数命令类型 (正常路径)
  const intentKeys = Object.keys(intent).sort();
  const cmdKeys = Object.keys(cmd)
    .filter((k) => !CMD_INFRA_FIELDS.has(k) && !(extraExclude && extraExclude.has(k)))
    .sort();
  if (intentKeys.length !== cmdKeys.length || intentKeys.some((k, i) => k !== cmdKeys[i])) {
    return `intent 字段集 [${intentKeys}] != cmd 业务字段集 [${cmdKeys}] (§3 step5 掉包拒)`;
  }
  for (const k of intentKeys) {
    if (!deepEq(intent[k], cmd[k])) return `intent.${k} != cmd.${k} (verify-value-source: 验的值必须==执行消费的值)`;
  }
  return null;
}

/**
 * custodial_transfer 专属绑定器 (§3.3a v0.4): relay 独立密码学核验 cmd.privkeyHex 确实派生出
 * 签名意图里的 fromAddress ——不是信任 Console/gateway 派生对了, 是 relay 自己重新证明一遍
 * (堵 Codex 洞: "证不了选了哪把 key")。派生用 ctx.network (relay 权威值, 从 process.env
 * NETWORK/KASPA_NETWORK 取得), 不用 cmd.network (v0.4 MUST-FIX: cmd/intent 里的 network 字段
 * 理论上可被上游 Console/gateway 影响, 不该被信任为派生输入; wallet.mjs testnet-10/11/12
 * 全映射同一 NetworkType.Testnet, 地址前缀不足以区分, 不能靠"前缀天然不同"这种弱推断)。
 * 另补 intent.network===env.network 绑定 (env.network 已被 178 行绑定到 ctx.network, 此前
 * intent 内的 network 字段从未跟 env.network 互相校验过, 是 v0.4 追加发现的同根空缺链路)。
 * 返回 null=过, 字符串=deny 原因 (原因绝不带 privkeyHex 本身, 只带非敏感地址/字段名——no-key-leak)。
 */
function checkCustodialTransferBinding(env, cmd, ctx) {
  if (env.intent.network !== env.network) {
    return `intent.network(${env.intent.network}) != envelope.network(${env.network}) (§3.3a v0.4 network join 拒)`;
  }
  let derivedAddress;
  try {
    derivedAddress = KaspaWallet.fromPrivateKey(cmd.privkeyHex, ctx.network).getAddress();
  } catch {
    // 不 echo cmd.privkeyHex (no-key-leak); 格式非法/构造异常统一转 deny, 不留未捕获异常。
    return 'custodial privkeyHex 派生失败 (格式非法, §3.3a step4 fail-closed)';
  }
  if (derivedAddress !== env.intent.fromAddress) {
    return 'custodial 派生地址 != intent.fromAddress (§3.3a step4 密码学核验拒, key/源址不匹配)';
  }
  return null;
}

/** M0c-1 粗粒度 intent ⊆ grant (§3 step5)。返回 null=过, 字符串=deny 原因。 */
function checkIntentWithinGrant(env, grant) {
  const allowed = parseJsonStringArray(grant.allowed_commands, 'allowed_commands');
  if (!allowed.includes(env.intent_type)) {
    return `命令 ${env.intent_type} ∉ grant.allowed_commands (grant inflation 拒, §6-3)`;
  }
  if (env.intent_version !== grant.typed_intent_version) {
    return `intent_version ${env.intent_version} != grant.typed_intent_version ${grant.typed_intent_version}`;
  }
  const relayScope = parseJsonStringArray(grant.relay_scope, 'relay_scope');
  if (!relayScope.includes(env.relay_id)) return `relay_id ∉ grant.relay_scope`;
  if (env.network !== grant.network) return `network != grant.network`;

  for (const { dim, fields, grantCol, kind } of SCALAR_DIMENSIONS) {
    for (const f of fields) {
      if (!(f in env.intent)) continue;
      const raw = grant[grantCol];
      if (raw === null || raw === undefined) {
        return `intent 含 ${dim} 维度字段 ${f} 但 grant.${grantCol} 未授权 (缺维度默认最严拒)`;
      }
      if (kind === 'amount') {
        const sompi = kasToSompiBig(env.intent[f]);
        if (sompi > BigInt(raw)) return `amount ${env.intent[f]} KAS 超 grant 单笔上限 ${raw} sompi`;
      } else {
        const scopeSet = parseJsonStringArray(raw, grantCol);
        if (!scopeSet.includes(String(env.intent[f]))) return `intent.${f}=${String(env.intent[f]).slice(0, 48)} ∉ grant.${grantCol}`;
      }
    }
  }
  return null;
}

const denyResult = (reason) => ({
  decision: 'deny', reason,
  authenticated: false, callerId: null, grantId: null, intentDigest: null,
});

/**
 * app 信封完整验证链 (§3 step2-7)。返回 AuthResult (母卡 §5 接口):
 *   { decision, reason, authenticated, callerId, grantId, intentDigest }
 * callerId 语义 = service 身份 (app_key_id), 永远不是端用户身份 (母卡 §5.1: 不设 userId 字段,
 * 命令 payload 里的端用户标识对本 gate 是不透明业务数据, 不读不信不转述为身份)。
 * @param {object} cmd 冻结候选命令 (relay.mjs IPC 入站, validateCommandPayload 已过)
 * @param {object} ctx { relayId, network, nowMs? } — relay 自身身份, 由 authorize.mjs 从 env 取
 */
export function verifyAppEnvelope(cmd, ctx = {}) {
  try {
    // step2 解信封 + step4 strict-reject 全信封（结构先行: 字段集恰好匹配 + 类型恰好匹配）——
    // G1 单一真相源：调共享库 validateEnvelopeStructure（Bettor DoD: 别只搬一半, kasia-console
    // 网关早拒验用同一份，不许本地再维护一份逻辑重复的循环）。
    const env = cmd?.envelope;
    const structErr = validateEnvelopeStructure(env);
    if (structErr) return denyResult(structErr);
    if (env.protocol !== ENVELOPE_PROTOCOL) return denyResult('envelope.protocol 不匹配');
    if (env.domain !== ENVELOPE_DOMAIN) return denyResult('envelope.domain 不匹配 (domain separation)');
    if (env.version !== ENVELOPE_VERSION) return denyResult('envelope.version 不匹配');

    // relay/network 绑定本 relay (跨 relay/network 重放在签名范围内 + 这里双重拒)
    if (!ctx.relayId || env.relay_id !== ctx.relayId) return denyResult('envelope.relay_id 不匹配本 relay');
    if (!ctx.network || env.network !== ctx.network) return denyResult('envelope.network 不匹配本 relay network');
    if (env.intent_type !== cmd.type) return denyResult('envelope.intent_type != cmd.type');

    // intent digest 自洽 (声明 == 重算; digest 供 M0c-3 nonce 绑定 + 审计)
    const digest = intentDigestOf(env.intent);
    if (digest !== env.intent_digest) return denyResult('intent_digest != sha256(canonical(intent))');

    // grant fresh 读 (§2·零缓存, 吊销即时可见; 读失败 fail-closed)
    const gr = getGrantFresh(env.grant_id);
    if (!gr.ok) return denyResult(`grant registry 读失败 fail-closed: ${gr.error}`);
    if (!gr.grant) return denyResult('grant 不存在 (未知 grant_id, §6-4)');
    const grant = gr.grant;
    if (grant.app_key_id !== env.app_key_id) return denyResult('grant.app_key_id != envelope.app_key_id');

    // step3 验签 (v0.2 MUST-FIX 签名范围): 消息 = canonical(全 envelope 去 signature), 公钥来自权威 grant 行
    let sigOk = false;
    try {
      sigOk = kaspa.verifyMessage({
        message: envelopeSigningMessage(env),
        signature: env.signature,
        publicKey: grant.app_pubkey,
      });
    } catch { sigOk = false; }
    if (!sigOk) return denyResult('信封签名验证失败 (全 canonical envelope 去 signature, §3 step3)');

    // 时间窗 (envelope) — nonce durable 校验归 M0c-3, 这里收紧窗口
    const now = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
    if (!Number.isInteger(env.issued_at) || !Number.isInteger(env.expires_at)) return denyResult('issued_at/expires_at 非整数 ms');
    if (env.issued_at > now + ISSUED_AT_SKEW_MS) return denyResult('envelope.issued_at 在未来');
    if (now > env.expires_at) return denyResult('envelope 已过期 (§6-5)');
    if (env.expires_at - env.issued_at > MAX_ENVELOPE_TTL_MS) return denyResult('envelope TTL 超上限 (M0c-3 前重放窗收紧)');

    // grant 有效期 + 吊销 (unix 秒; fresh 读保证吊销即时, §6-11)
    if (grant.revoked) return denyResult('grant 已吊销 (fresh 读即时可见, §6-5/11)');
    const nowSec = Math.floor(now / 1000);
    if (nowSec < grant.valid_from || nowSec > grant.valid_until) return denyResult('grant 不在有效期 (§6-5)');

    // step5a intent == cmd 绑定 (verify-value-source / M1-6 验的对象==执行的对象)
    const bindErr = checkIntentBindsCmd(env.intent, cmd, cmd.type);
    if (bindErr) return denyResult(bindErr);

    // step5a-custodial (§3.3a v0.4·G2 落码): custodial_transfer 专属密码学核验 (privkeyHex↔
    // fromAddress 独立派生比对 + network 四值 join), 命令类型门控 (cmd.type==='custodial_transfer')
    // 非全局——发生在 checkIntentBindsCmd 通过之后、deepFreeze(cmd) 之前 (同一步, 非事后补丁)。
    if (cmd.type === 'custodial_transfer') {
      const custErr = checkCustodialTransferBinding(env, cmd, ctx);
      if (custErr) return denyResult(custErr);
    }

    // step5b intent ⊆ grant (MF3 粗粒度)
    const scopeErr = checkIntentWithinGrant(env, grant);
    if (scopeErr) return denyResult(scopeErr);

    // step6 [M0c-3 接口] nonce durable replay 校验 — 留接口不占位 (设计 §3 step6: 禁内存 nonce)。
    // nonce 已在签名范围内 (换 nonce = 签名失效); M0c-3 落地后在此接 durable+atomic reserve。

    // step7 冻结 canonical cmd (M1-6): switch 只消费验证过的这份, 防 gate→switch 间未来引入突变。
    deepFreeze(cmd);

    return {
      decision: 'allow',
      reason: 'app envelope 全链验证通过 (§3 step2-7)',
      authenticated: true,
      callerId: env.app_key_id,
      grantId: env.grant_id,
      intentDigest: digest,
    };
  } catch (e) {
    // M1-4: 任何解析/评估异常 → fail-closed deny, 不推进状态。
    return denyResult(`envelope 验证异常 fail-closed (M1-4): ${e?.message || String(e)}`);
  }
}
