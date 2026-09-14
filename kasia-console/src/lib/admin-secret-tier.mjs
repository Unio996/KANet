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

// ── T-KEY-EXPORT (2026-09-14, 设计 docs/2026-09-14-kanetui-relay-key-export-route-lockdown-design-v0.1.md,
//    NWT GREEN 80d0d62a, ledger 1244/1252)：主网密钥导出路由(GET /relays/:id/mnemonic、
//    GET /api/relay/:id/wallets/:walletId/privkey) 专属锁——两把锁叠加缺一不可，不与任何现有 tier 共用：
//    ① RELAY_KEY_EXPORT_ENABLED_UNTIL(unix 秒时间戳) 未设或已过期 = 拒绝（**自动超时**天然实现，
//       不需要额外定时器/cron 清理——判断本身就是"现在几点"跟这个数字比大小）；
//    ② ADMIN_SECRET_KEY_EXPORT tier 密钥（未设 = checkAdminSecretTier 自身已 503）。
//    NWT GREEN 采纳默认：不加一次性口令语义（时间窗本身已经很短，"一次性"会让合法的连续导出场景
//    反复找 Owner 要新窗口，体验代价换来的安全增量不确定划算——设计页 §2.3 原话）。
/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {{ok: true} | {ok: false, code: number, error: string}}
 */
export function checkKeyExportWindow(request) {
  const untilRaw = process.env.RELAY_KEY_EXPORT_ENABLED_UNTIL;
  if (!untilRaw) {
    return { ok: false, code: 503, error: 'key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL env 未设)' };
  }
  const until = Number(untilRaw);
  if (!Number.isFinite(until)) {
    return { ok: false, code: 503, error: `key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL 不是合法 unix 时间戳: ${JSON.stringify(untilRaw)})` };
  }
  if (Date.now() / 1000 > until) {
    return { ok: false, code: 503, error: `key export disabled (RELAY_KEY_EXPORT_ENABLED_UNTIL 已过期: ${new Date(until * 1000).toISOString()})` };
  }
  // 时间窗有效，还需要独立的 tier 密钥——两把锁缺一不可，不能只靠时间窗（时间窗内任意能连到
  // 这台机器的进程都能读，等于没锁）。
  return checkAdminSecretTier(request, 'ADMIN_SECRET_KEY_EXPORT');
}
