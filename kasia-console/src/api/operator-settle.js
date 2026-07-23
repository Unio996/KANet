// M0c-1 批B — operator-scoped 结算专道 (relay.js:1726 收敛 A 方案的 money-path 出口).
// 设计: docs/2026-07-23-m0c-1-operator-settle-lane-design.md v0.2
//   (Bettor 方向审 GREEN + NWT 红队 GREEN-with-2-note + 复核全闭 GREEN).
// gate-arming 硬前置: M0c-1 gate armed 前此专道到位, 是 operator 手动结算 (事故兜底刚需) 的合法 money-path 出口.
//
// auth 三层 (镜像 coord-status/zk-close-v2, 复用 admin-secret-tier 件⑥ tier 体系):
//   ① env 开关 ADMIN_OPERATOR_SETTLE_ENABLED != '1' → 503 (默认 off, operator 手动结算时才开)
//   ② checkAdminSecretTier(ADMIN_SECRET_OPERATOR_SETTLE) — 独立 operator 密钥, 绝不复用/派生共享 ingest secret
//      (§2.4 头号判据: tg-bot 等场景A app 持 ingest secret 但不持此 tier → money-path 面排除场景A).
//   ③ IP allowlist (默认 localhost).
// 命令白名单两档 (NWT note-1 收窄 WHAT 不只 WHO):
//   档一 covenant-specific (结算语义明确, OPERATOR_SETTLE tier 放行) / 档二 transfer (额外 OPERATOR_TRANSFER tier=实更严两把 secret) / ecdsa_sign 剔除.
// origin='operator' (第四类, 供 relay 侧 gate 批E 差异化 policy). 审计绑 operator 身份 (不记 secret 值; M0c-3 接正式审计表).
import { checkAdminSecretTier } from '../lib/admin-secret-tier.mjs';
import { sendCommandAsync } from '../services/relay-manager.js';

// 档一: covenant/结算语义明确 + 只读辅助, ADMIN_SECRET_OPERATOR_SETTLE tier 放行.
const LANE1_COVENANT = new Set([
  'sign_input_for_settle', 'bshard_close_attest', 'bshard_payout_claim',
  'sweep_per_bet', 'consolidate_utxo', 'get_per_bet_address',
  // 只读 (零链上副作用, 结算流程辅助查询):
  'check_utxo_landed', 'get_pubkey',
  'chain_get_current_daa_score', 'chain_get_block_at_daa', 'chain_get_blocks_from_daa_score',
]);
// 档二: generic 最强原语, 最高危 — 需额外 ADMIN_SECRET_OPERATOR_TRANSFER tier (实更严=两把 secret, 未设 fail-closed 拒).
//   保留理由: operator 事故恢复移资 (孤儿/卡住资金手动转出) 有兜底需求 (设计 §2.2 档二).
const LANE2_HIGH_GATE = new Set(['transfer']);
// 剔除 (NWT note-1): ecdsa_sign — operator 手动结算不用 generic 签名 (结算签名走专用 sign_input_for_settle);
//   grep operator scratch (非归档) 零 generic ecdsa_sign 用法坐实. 不在任何档 → 白名单外 fail-closed 拒.

export function registerOperatorSettleRoutes(fastify) {
  // POST /api/operator/settle-command { relayId, command }
  // operator 手动结算专道 — money-path 命令离开 relay.js:1726 零鉴权裸透传端点后的合法出口.
  fastify.post('/api/operator/settle-command', async (request, reply) => {
    // ① env 开关 (默认 off, 镜像 zk-close-v2)
    if (process.env.ADMIN_OPERATOR_SETTLE_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'operator settle lane disabled (ADMIN_OPERATOR_SETTLE_ENABLED != 1)' });
    }
    // ② auth tier — 独立 operator 密钥 (非共享 ingest secret, 排除场景A; 未设=503 fail-closed 不 fallback)
    const auth = checkAdminSecretTier(request, 'ADMIN_SECRET_OPERATOR_SETTLE');
    if (!auth.ok) return reply.code(auth.code).send({ ok: false, error: auth.error });
    // ③ IP allowlist (默认 localhost)
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `operator settle lane: source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST` });
    }
    // body
    const { relayId, command } = request.body || {};
    if (!relayId || !command?.type) {
      return reply.code(400).send({ ok: false, error: 'relayId, command.type 必需' });
    }
    const cmdType = command.type;
    // 命令白名单两档 (fail-closed: 白名单外拒)
    if (LANE2_HIGH_GATE.has(cmdType)) {
      // 档二 transfer: 额外 ADMIN_SECRET_OPERATOR_TRANSFER tier 走**独立 header** (M0c-1 批B MUST-FIX·NWT):
      // 实更严=两把不同 secret 各带各自 header (x-kanet-admin-secret=OPERATOR_SETTLE + x-kanet-admin-secret-transfer=OPERATOR_TRANSFER);
      // 同 header 双 tier 会退化成"两 secret 需相同=假更严"或"永不匹配=transfer 废=违红线". 未设/不匹配 fail-closed 拒.
      const transferAuth = checkAdminSecretTier(request, 'ADMIN_SECRET_OPERATOR_TRANSFER', 'x-kanet-admin-secret-transfer');
      if (!transferAuth.ok) {
        return reply.code(transferAuth.code).send({ ok: false, error: `operator settle lane 档二 transfer 需额外 tier (独立 header): ${transferAuth.error}` });
      }
    } else if (!LANE1_COVENANT.has(cmdType)) {
      // 白名单外 (含剔除的 ecdsa_sign) → fail-closed 拒
      return reply.code(403).send({ ok: false, error: `operator settle lane: command '${cmdType}' 不在白名单 (fail-closed)` });
    }
    // 审计 — 绑 operator 身份, 不记 secret 值; origin=operator; M0c-3 接正式审计表.
    const auditTs = new Date().toISOString();
    const lane = LANE2_HIGH_GATE.has(cmdType) ? '2-high-gate' : '1-covenant';
    console.log(`[operator-settle AUDIT] ts=${auditTs} origin=operator relay=${relayId.slice(0, 8)} cmd=${cmdType} lane=${lane}`);
    // 发命令 — origin='operator' (第四类, 供 relay 侧 gate 批E 差异化 policy). NO TX NO STATE: 结果原样回传, 不乐观写本地状态.
    try {
      const result = await sendCommandAsync(relayId, command, 90000, 'operator');
      return reply.send({ ok: true, result });
    } catch (e) {
      return reply.code(502).send({ ok: false, error: e.message || 'relay command failed' });
    }
  });
}
