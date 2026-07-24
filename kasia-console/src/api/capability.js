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

// Path B 围栏 §2.4（docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md）：进程外限流参数
// （Bettor ratify 数值）——每 grant_id 每 RATE_LIMIT_WINDOW_MS 窗口内 ≤ RATE_LIMIT_MAX 次请求。
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟
const RATE_LIMIT_MAX = 3; // 每 grant_id 每分钟 3 笔（J1 `19:44:07` 提案，Bettor ratify）
const RATE_LIMIT_CLEANUP_MULTIPLE = 10; // 清理超过 10 倍窗口的旧行，自清理不另起 cron

/**
 * Path B 围栏 §2.4：进程外（DB 持久化，非内存计数器）限流，keyed by app-grant（Bettor 原话）——
 * 用 env.grant_id 这个**未验证的声明值**（签名验证之前，见 §2.4 母卡诚实标注：NWT note 已定性
 * 这是可用性风险非资金安全风险，第三方可耗合法 app 配额但转不出钱，Bettor accept for pilot）。
 * 返回 { ok:true } 或 { ok:false, error }。fail-closed：DB 异常算拒绝，不放行。
 */
function checkRateLimit(grantId) {
  const now = Date.now();
  try {
    // 自清理：每次检查顺带删除超过 10 倍窗口的旧行，不需要独立 cron/daemon。
    sqlite.prepare('DELETE FROM pilot_rate_limit_log WHERE requested_at < ?').run(now - RATE_LIMIT_WINDOW_MS * RATE_LIMIT_CLEANUP_MULTIPLE);
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const { cnt } = sqlite.prepare('SELECT COUNT(*) AS cnt FROM pilot_rate_limit_log WHERE grant_id = ? AND requested_at >= ?').get(String(grantId), windowStart);
    if (cnt >= RATE_LIMIT_MAX) {
      // 🔴 超限不记录本次尝试（防止被拒请求本身继续膨胀计数、放大拒绝面，§2.4 母卡已标注）。
      return { ok: false, error: `grant 限流：每 ${RATE_LIMIT_WINDOW_MS / 1000}s 至多 ${RATE_LIMIT_MAX} 笔请求` };
    }
    sqlite.prepare('INSERT INTO pilot_rate_limit_log (grant_id, requested_at) VALUES (?, ?)').run(String(grantId), now);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '限流检查异常（fail-closed 拒）: ' + (e?.message || 'unknown') };
  }
}

/**
 * 网关早拒验：结构 + protocol/domain/version + intent_type + 限流（§2.4）+ 签名（MUST，§3.2）+
 * grant 存在/未吊销/有效期 + amount cap（cheap-to-expensive：这几步全部零解密成本，任一步失败都在
 * 触发 privkey 派生前拒绝——Bettor `#xw1umo` 钦定顺序，防止无效签名/超额请求白白触发一次 AES 解密）。
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

  // 限流（§2.4，cheap-to-expensive 第一项：结构确认过 grant_id 是字符串之后、签名验证之前）——
  // keyed by 声明的 grant_id，读的是 ENVELOPE_FIELDS 结构已保证存在的字段，无需等 grant 查证。
  const rl = checkRateLimit(env.grant_id);
  if (!rl.ok) return { ok: false, code: 429, error: rl.error };

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
 * Path B 围栏 §2.7（docs/2026-07-23-m0c-1-path-b-pilot-containment-design.md）：gateway 转发
 * custodial_transfer 命令前，主动查一次 relay 的 armed 状态——纵深防御第二层，防"两个 flag
 * 分批开"（gateway=on 但 relay armed=off）导致 relay 侧全部密码学核验（checkCustodialTransferBinding/
 * network 绑定/source_scope）被 `authorizeCommand` 无条件放行静默跳过（`authorize.mjs:66`
 * `if (!GATE_ARMED) return {decision:'allow'}`，在判断 origin 之前）。
 * 🔴 这次查询本身 origin='internal'（NWT `20:05` relay 侧 diff 审 note）：运维/系统诊断查询非外部
 * app 业务意图，不占用 origin='app' 唯一铸造点；`get_arm_status` 在 READONLY_ALLOWLIST 里不需要信封。
 * 🔶 诚实边界：有理论 TOCTOU 窗口（本次查询到实际转发之间 armed 状态理论上可能翻转）——不是 100%
 * 银弹，主防线仍是 §2.6"两 flag 必须同批次开"运维硬约束+re-arm 六门前置，本查询是运行时兜底第二层。
 */
async function checkRelayArmed(relayId) {
  try {
    const result = await sendCommandAsync(relayId, { type: 'get_arm_status' }, 5000, 'internal');
    if (!result?.ok) return { ok: false, error: 'relay armed 状态查询失败（result.ok=false）' };
    if (result.armed !== true) return { ok: false, error: 'relay 未 armed（ADMIN_M0C1_GATE_ARMED != 1），网关侧转发已暂停' };
    return { ok: true };
  } catch (e) {
    // fail-closed: 查不到状态（relay 未起/超时/IPC 异常）一律当作"不能确认已 armed"，不放行转发。
    return { ok: false, error: 'relay armed 状态查询异常（fail-closed 拒转发）: ' + (e?.message || 'unknown') };
  }
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

      // 🔴 到此为止，全部 cheap 检查已过（结构/协议/intent_type/限流/grant 存在吊销有效期/签名/
      // amount cap）。custodial_transfer 分支下方还有 pilot 白名单（§2.1）+ relay armed 状态确认
      // （§2.7）两道，都通过才触发 privkey 派生（expensive：DB 查询 + AES 解密）。
      if (intentType === 'custodial_transfer') {
        const fromAddress = check.env.intent?.fromAddress;
        if (typeof fromAddress !== 'string' || !fromAddress) {
          return reply.code(400).send({ ok: false, error: 'intent.fromAddress 缺失/非法' });
        }

        // 🔴 Path B 围栏 §2.1：gateway 早拒白名单层（non-authoritative，纵深防御第一层，独立于
        // relay 侧 grant-scoped source_scope 权威层，见母卡 §2.1）。空 Set = 未配置 = default-deny
        // 拒所有（同 M0c-1 default-deny 精神，不会因为忘配这个 env 变量而"意外开放"）。cheap：纯
        // env 解析 + Set 查找，无 DB/IPC，早于 relayId 解析。
        const pilotAllowlist = new Set((process.env.PILOT_WALLET_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean));
        if (!pilotAllowlist.has(fromAddress)) {
          return reply.code(403).send({ ok: false, error: 'fromAddress 不在 pilot 白名单（gateway 早拒层，非 grant scope 缺陷）' });
        }

        const relayId = CUSTODIAL_RELAY_ID();
        if (!relayId) return reply.code(503).send({ ok: false, error: '转账暂不可用（CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配）' });

        // 🔴 Path B 围栏 §2.7：真正转发前先查一次 relay armed 状态（纵深防御第二层，见函数注释）。
        // 放在 derive（AES 解密）之前——armed 查询本身也是 cheap-to-expensive 顺序的延伸：relay 未
        // armed 时不该白白解密一次钱包私钥只为了发一个注定会被静默放行、零验证执行的命令。
        const armCheck = await checkRelayArmed(relayId);
        if (!armCheck.ok) return reply.code(503).send({ ok: false, error: armCheck.error });

        const derived = deriveCustodialExecFields(fromAddress);
        if (!derived.ok) return reply.code(401).send({ ok: false, error: derived.error });

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
