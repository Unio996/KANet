// M0c-1 Path B pilot — 共享 access_mode 策略 helper（Codex MSG-126 P1 item 5）
//
// 背景：`tg_custodial_wallets.access_mode` 是 durable 隔离判据（migrate.js v193），legacy
// `/send` 和 `GET /:tg_user_id/diagnose` 两条路由各自都要按这一列做 fail-closed 判定——
// Codex 明确要求"两路由共用一条规则，非各自 drift"（同时闭合更早那次"两个 parser 各自
// parse 同一 env"的同类问题，这次是"两处各自比较 access_mode 字面量"的同类风险，根治法
// 一样：抽一个唯一真相源）。
//
// 规则（唯一定义处）：
//   legacy /send 只放行 access_mode==='normal'（unknown/null/capability_only 全拒——
//     不是"排除 capability_only"这种黑名单式思路，是"只认 normal"这种白名单式思路，
//     未来出现第三种 access_mode 值时默认最严，不会意外放行）。
//   diagnose 只放行 access_mode==='capability_only'（normal/unknown/null 全拒——
//     诊断端点的解密动作只该对 pilot 专属钱包生效，不该变成"任意托管钱包的
//     decrypt-and-derive 触发器"）。

/** legacy `/send` 路径是否允许对这个 access_mode 值放行。 */
export function isLegacySendAllowed(accessMode) {
  return accessMode === 'normal';
}

/** `GET /:tg_user_id/diagnose` 是否允许对这个 access_mode 值解密。 */
export function isDiagnoseAllowed(accessMode) {
  return accessMode === 'capability_only';
}
