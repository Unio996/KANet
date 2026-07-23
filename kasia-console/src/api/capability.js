// M0c-1 机制A — HTTP 能力网关（G2 wallet/transfer 落码·藏 default-off 503）
// 设计: docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md §3/§3.3a/§6
// 派工: Bettor `#xw1umo`（Codex V03-FINAL D 节：default-off 代码落码闸 = fold+NWT diff，不等
//   Owner Path A/B——那是「激活上 live」的另一个闸，Path 无关本批）。
//
// 🔴 本批仍不激活钱路（`ADMIN_CAPABILITY_GATEWAY_ENABLED` 未设 → 恒 503，零新增暴露面）：
//   业务逻辑真正接线（本批），但激活（把 flag 置 1 让请求真的走到底）归 Owner 授权 + Path B
//   containment 清单 + pilot 钱包（Bettor 另开的闸，不在本批范围）。
//
// 🔴 origin='app' 唯一铸造点（§5 NWT 5 角度自答①）：本文件是全仓唯一允许对
//   `sendCommandAsync(..., 'app')` 发起调用的位置——lint 规则待补（§6 计划项，本批未落）。
//
// G1/G2 单一真相源（Bettor DoD·防两份漂移）：canonical 序列化/结构校验/amount 解析/grant 数组解析
// 全部复用 shared/lib/app-envelope-canonical.mjs（与 kasia-relay/src/lib/app-envelope.mjs 权威验证
// 共用同一份定义，不在本文件重新实现）。
import {
  validateEnvelopeStructure,
  ENVELOPE_PROTOCOL,
  ENVELOPE_DOMAIN,
  ENVELOPE_VERSION,
  envelopeSigningMessage,
  kasToSompiBig,
} from '../../../shared/lib/app-envelope-canonical.mjs';
import { sqlite } from '../db/client.js';
import { decrypt } from '../services/crypto.js';
import { privKeyHexFromMnemonic } from '../services/wallet.js';
import { sendCommandAsync } from '../services/relay-manager.js';

const GATEWAY_ENABLED = () => process.env.ADMIN_CAPABILITY_GATEWAY_ENABLED === '1';
const CUSTODIAL_RELAY_ID = () => process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null;

/**
 * grant fresh 读（网关侧自己的 sqlite 连接，Console 本来就有——不是 relay 那种 readOnly node:sqlite
 * 独立通道；同一张表 m0c1_app_grants，M0C1_GRANT_DB_PATH 传给 relay 子进程时也是指向这同一个
 * console.db）。每次调用新查询，不缓存（同 grant-registry.mjs fresh 读语义）。
 */
function getGrantFreshGateway(grantId) {
  try {
    const row = sqlite.prepare('SELECT * FROM m0c1_app_grants WHERE grant_id = ?').get(String(grantId));
    return { ok: true, grant: row || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * 网关早拒验：结构 + protocol/domain/version + intent_type + 签名（MUST，§3.2）+ grant 存在/未吊销/
 * 有效期 + amount cap（cheap-to-expensive：这几步全部零解密成本，任一步失败都在触发 privkey 派生前
 * 拒绝——Bettor `#xw1umo` 钦定顺序，防止无效签名/超额请求白白触发一次 AES 解密）。
 * 返回 { ok:true, grant, env } 或 { ok:false, code, error }（code 供 handler 映射 HTTP 状态）。
 */
async function earlyRejectCheck(env, intentType) {
  const structErr = validateEnvelopeStructure(env);
  if (structErr) return { ok: false, code: 400, error: structErr };
  if (env.protocol !== ENVELOPE_PROTOCOL || env.domain !== ENVELOPE_DOMAIN || env.version !== ENVELOPE_VERSION) {
    return { ok: false, code: 400, error: 'envelope.protocol/domain/version 不匹配' };
  }
  if (env.intent_type !== intentType) {
    return { ok: false, code: 403, error: `本路由不接受命令 ${env.intent_type}（须 ${intentType}）` };
  }

  // grant fresh 读（cheap，一次 DB 查询，供签名验证取 app_pubkey + 后续 amount cap 复用同一行）
  const gr = getGrantFreshGateway(env.grant_id);
  if (!gr.ok) return { ok: false, code: 503, error: `grant registry 读失败: ${gr.error}` };
  if (!gr.grant) return { ok: false, code: 401, error: 'grant 不存在' };
  const grant = gr.grant;
  if (grant.app_key_id !== env.app_key_id) return { ok: false, code: 401, error: 'grant.app_key_id != envelope.app_key_id' };
  if (grant.revoked) return { ok: false, code: 401, error: 'grant 已吊销' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec < grant.valid_from || nowSec > grant.valid_until) return { ok: false, code: 401, error: 'grant 不在有效期' };

  // 签名验证 MUST（§3.2，网关侧独立验证，非可选、非等 relay 兜底）——放在 grant 读之后（要 app_pubkey）
  // 但仍在派生 privkey 之前（cheap-to-expensive 顺序：无效签名不触发解密）。
  const kaspa = await import('kaspa-wasm');
  let sigOk = false;
  try {
    sigOk = kaspa.verifyMessage({ message: envelopeSigningMessage(env), signature: env.signature, publicKey: grant.app_pubkey });
  } catch { sigOk = false; }
  if (!sigOk) return { ok: false, code: 401, error: '信封签名验证失败（网关早拒验）' };

  // amount cap（cheap-to-expensive 第二项：超额不触发解密）。只查这一个维度——payee/relay/network 等
  // 其余 scope 维度是 relay 权威验证的职责（§3.2「两层验证独立成立」，网关不重造完整 checkIntentWithinGrant，
  // 避免网关变成第二个可能漂移的授权引擎，只做「早拒 + 防止浪费解密」这两件事）。
  if ('amount' in (env.intent || {})) {
    if (grant.max_amount_sompi === null || grant.max_amount_sompi === undefined) {
      return { ok: false, code: 403, error: 'amount 维度未授权（grant.max_amount_sompi 缺失，缺维度默认最严拒）' };
    }
    let sompi;
    try { sompi = kasToSompiBig(env.intent.amount); } catch (e) { return { ok: false, code: 400, error: e.message }; }
    if (sompi > BigInt(grant.max_amount_sompi)) {
      return { ok: false, code: 403, error: `amount 超 grant 单笔上限（超额请求，未触发解密）` };
    }
  }

  return { ok: true, grant, env };
}

/**
 * custodial_transfer 专属执行绑定器（gateway 侧一半，§3.3a 第 5 点·J1 relay 侧一半独立落码配对）：
 * 只接受 intent.fromAddress（已过签名验证的字段，非直接不可信输入）作为唯一输入，查
 * tg_custodial_wallets（UNIQUE(kaspa_address)）取 mnemonic_encrypted，CONSOLE_ENCRYPTION_KEY
 * just-in-time 解密派生 privkeyHex。绝不接受请求体里任何声称的 privkeyHex 值——这个字段
 * 网关自己造，不是从 body 里读出来的（verify-value-source：值来自权威查询非 caller 输入）。
 */
function deriveCustodialExecFields(fromAddress) {
  const w = sqlite.prepare('SELECT kaspa_address, mnemonic_encrypted, network FROM tg_custodial_wallets WHERE kaspa_address = ?').get(fromAddress);
  if (!w) return { ok: false, error: '托管钱包不存在（fromAddress 未注册）' };
  let privkeyHex;
  try {
    const mnemonic = decrypt(w.mnemonic_encrypted); // fail-loud if CONSOLE_ENCRYPTION_KEY missing
    privkeyHex = privKeyHexFromMnemonic(mnemonic);
  } catch (e) {
    // 🔴 no-key-leak: 错误消息绝不带任何密钥材料/助记词（同 tg-wallet.js:121 既有安全消息模式）
    return { ok: false, error: 'wallet decrypt failed（检查 CONSOLE_ENCRYPTION_KEY）' };
  }
  return { ok: true, privkeyHex, fromAddress: w.kaspa_address, network: w.network };
}

const CAPABILITY_ROUTES = Object.freeze([
  { path: '/api/capability/wallet/transfer', intentType: 'custodial_transfer' },
]);

export async function registerCapabilityRoutes(fastify) {
  for (const { path, intentType } of CAPABILITY_ROUTES) {
    fastify.post(path, async (request, reply) => {
      // ① feature-flag 默认 off，与 relay armed 状态解耦（v0.2 MUST-FIX，比照 operator-settle.js:36-37）。
      //    本批激活仍不开（Path B containment 清单 + Owner 授权后另批置 1）。
      if (!GATEWAY_ENABLED()) {
        return reply.code(503).send({ ok: false, error: 'capability gateway disabled (ADMIN_CAPABILITY_GATEWAY_ENABLED != 1)' });
      }
      const env = request.body?.envelope;
      const check = await earlyRejectCheck(env, intentType);
      if (!check.ok) return reply.code(check.code).send({ ok: false, error: check.error });

      // 🔴 到此为止，全部 cheap 检查已过（结构/协议/intent_type/grant 存在吊销有效期/签名/amount cap）。
      // 只有这些都通过才触发下面的 privkey 派生（expensive：DB 查询 + AES 解密）。
      if (intentType === 'custodial_transfer') {
        const fromAddress = check.env.intent?.fromAddress;
        if (typeof fromAddress !== 'string' || !fromAddress) {
          return reply.code(400).send({ ok: false, error: 'intent.fromAddress 缺失/非法' });
        }
        const derived = deriveCustodialExecFields(fromAddress);
        if (!derived.ok) return reply.code(401).send({ ok: false, error: derived.error });

        const relayId = CUSTODIAL_RELAY_ID();
        if (!relayId) return reply.code(503).send({ ok: false, error: '转账暂不可用（CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配）' });

        // cmd 组装：意图字段（已签名验证过）+ 派生执行字段（网关自己查出来的，非 body 输入）+ envelope
        // 原样带上供 relay 权威重验（§3.2 信封端到端不可变，网关不改动 env 任何字段）。强制 origin='app'
        // ——本文件是全仓唯一允许传 'app' 给 sendCommandAsync 的位置（§5 角度①）。
        const cmd = {
          type: intentType,
          fromAddress: derived.fromAddress,
          target: check.env.intent.target,
          amount: check.env.intent.amount,
          network: check.env.intent.network,
          privkeyHex: derived.privkeyHex,
          envelope: check.env,
        };
        try {
          const result = await sendCommandAsync(relayId, cmd, undefined, 'app');
          const txId = result?.txId || null;
          if (!txId) return reply.code(503).send({ ok: false, error: '转账未上链（relay 无 txId，可能 RPC down 或 relay 侧拒绝）' });
          // 🔴 no-key-leak: 回执只回 txId/amount/target/fromAddress（公开信息），绝不回 privkeyHex。
          return reply.send({ ok: true, txId, amount: cmd.amount, target: cmd.target, fromAddress: cmd.fromAddress });
        } catch (e) {
          return reply.code(500).send({ ok: false, error: 'transfer failed: ' + (e?.message || 'unknown') });
        }
      }

      // 其余 intentType（本批未注册任何其他路由）不会走到这里；防御性兜底。
      return reply.code(501).send({ ok: false, error: 'capability route: intent_type 未接线业务逻辑' });
    });
  }
}
