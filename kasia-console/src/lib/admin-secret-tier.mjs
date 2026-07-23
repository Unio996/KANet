// ADMIN_SECRET 能力级权限拆分(2026-07-16, 件⑥, 设计
// docs/2026-07-16-admin-secret-capability-tiering-design.md v0.2, NWT红队GREEN)。
//
// 不再有单一 ADMIN_SECRET 兜底所有端点——每个端点认自己的 tier 密钥, 拿低风险 tier
// 的钥匙去打高风险端点必须 403。T-BREAK-GLASS(confirm-by-address)已整体移除
// (Owner"系统不需要人工"原则), 不在本文件覆盖范围内。
//
// 密钥变量(§2.2):
//   ADMIN_SECRET_ZK_CLOSE_BROADCAST  T-BROADCAST(zk-close-v2 真广播分支)
//   ADMIN_SECRET_STATUS_SIGN         T-SIGN(coord-status/sign, 触碰relay私钥签名)
//   ADMIN_SECRET_ZK_STATE_PREP       T-STATE-PREP(propose-close-v2 + zk-handoff-v2 共用一把,
//                                    同一操作连续两步, 拆开无额外防线价值——但绝不与广播共用)
//   ADMIN_SECRET_READONLY            T-READONLY(visibility 翻转 + zk-close-gate-debugger 共用,
//                                    零链上副作用)
//
// 迁移期(§2.2): 若某把新密钥未设置, 端点保持"未设=503 disabled"失败方向(fail-closed 对
// 未配置=禁用), 不自动 fallback 到旧 ADMIN_SECRET——新老不混用同一次请求校验, 避免"设了
// 新的但旧的还生效"双活漏洞。

/**
 * 校验请求携带的 X-KANet-Admin-Secret header 是否匹配指定 tier 的密钥。
 * @param {import('fastify').FastifyRequest} request
 * @param {string} envVarName - 本次调用方所属 tier 的 env var 名(如 'ADMIN_SECRET_ZK_STATE_PREP')
 * @returns {{ok: true} | {ok: false, code: number, error: string}}
 */
// headerName (2026-07-23, M0c-1 批B MUST-FIX): 默认 'x-kanet-admin-secret' (向后兼容, 现有端点不变).
// 多 tier 端点若要求"实两把不同 secret"(如 operator-settle transfer 档二), 第二 tier 必须走独立 header
// (否则一个请求只有一个 x-kanet-admin-secret 值, 双 tier 读同一 header = 两 secret 需相同 = 假更严, 或永不匹配 = 功能废).
export function checkAdminSecretTier(request, envVarName, headerName = 'x-kanet-admin-secret') {
  const secret = process.env[envVarName];
  if (!secret) {
    return { ok: false, code: 503, error: `admin endpoint disabled (${envVarName} env 未设)` };
  }
  const provided = request.headers[headerName];
  if (!provided || provided !== secret) {
    return { ok: false, code: 403, error: `admin auth fail (${headerName} 缺失/不匹配, tier=${envVarName})` };
  }
  return { ok: true };
}
