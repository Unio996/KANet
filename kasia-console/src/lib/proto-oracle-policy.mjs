// proto-oracle-policy.mjs — oracle 整合批 B / B5(N5b): "判定题市场只准在哪儿存在"的【唯一谓词】+ 开关 / 白名单解析 + LOUD 启动日志。
// 设计 docs/2026-09-20-bettor-oracle-batchB-adapter-verdict-promote-design-v0.1.md §10 B5 / §11 SHOULD③。
// 🔴 N5b: refund 执行(refund_flip 广播 + 逐票 reclaim)未接线 ⇒ 判定题的唯一出口(refund)走不通 ⇒ 主网上有价值市场不得有判定题。这不是文档约定而是代码谓词:
//    judgedMarketAllowedHere({network, tokenDefId}) 在三处被调用(创建入口 / 下注受理门 / adapter 扫描+promote), 三处同一个函数(测试钉 + lint 规则钉)。
// 🔴 PROTO_ORACLE_ADAPTER_ENABLED 默认关(与 driver 开关同级), 翻开须 Owner; PROTO_ORACLE_VALUELESS_TOKEN_IDS = 主网上【唯一】允许判定题的代币定义白名单(零价值测试币)。
// 纯函数(env 由调用方传入, 缺省取 process.env); 无 DB / 无 IO。
export const ENV_ADAPTER_ENABLED = 'PROTO_ORACLE_ADAPTER_ENABLED';
export const ENV_VALUELESS_TOKEN_IDS = 'PROTO_ORACLE_VALUELESS_TOKEN_IDS';
const TOKEN_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** 逗号分隔的代币定义 id 白名单 ⇒ { ids: string[], rejected: string[] }(非法项不进白名单, 由调用方 LOUD)。 */
export function parseValuelessTokenIds(raw) {
  const ids = [], rejected = [];
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ids, rejected };
  for (const part of String(raw).split(',')) {
    const v = part.trim(); if (!v) continue;
    if (TOKEN_ID_RE.test(v)) { if (!ids.includes(v)) ids.push(v); } else rejected.push(v);
  }
  return { ids, rejected };
}

/** 生效策略(启动 LOUD 打印这个)。adapterEnabled 只认字面 '1'。 */
export function resolveOraclePolicy({ env = process.env, network } = {}) {
  const wl = parseValuelessTokenIds(env[ENV_VALUELESS_TOKEN_IDS]);
  const warnings = wl.rejected.map((r) => `${ENV_VALUELESS_TOKEN_IDS} 含非法项 ${JSON.stringify(r)} ⇒ 已忽略(不进白名单)`);
  return { adapterEnabled: env[ENV_ADAPTER_ENABLED] === '1', network: network ?? null, valuelessTokenIds: wl.ids, warnings };
}

/**
 * 【唯一谓词】判定题市场能否存在于此(网络, 代币)。
 *  - 非主网(simnet / testnet-* / devnet …)不受限; 主网按 trim + 小写识别('Mainnet' / ' MAINNET ' 都算主网);
 *  - 主网: 仅当 tokenDefId 在 PROTO_ORACLE_VALUELESS_TOKEN_IDS 白名单内才允许(零价值币); 白名单空 ⇒ 主网一律不允许;
 *  - network 缺失 / 非字符串 ⇒ fail-closed(按不允许)。
 * @returns {{allowed: boolean, reason: string}}
 */
export function judgedMarketAllowedHere({ network, tokenDefId, env = process.env } = {}) {
  if (typeof network !== 'string' || !network.trim()) return { allowed: false, reason: 'network_unknown_fail_closed' };
  if (network.trim().toLowerCase() !== 'mainnet') return { allowed: true, reason: 'non_mainnet' };   // 大小写 / 空白不敏感识别主网: 这道闸不靠上游守规范(configuredNetwork 只产小写规范名, 但闸自己不假设)
  if (typeof tokenDefId !== 'string' || !tokenDefId) return { allowed: false, reason: 'mainnet_token_def_id_missing' };
  const { ids } = parseValuelessTokenIds(env[ENV_VALUELESS_TOKEN_IDS]);
  return ids.includes(tokenDefId)
    ? { allowed: true, reason: 'mainnet_valueless_token_whitelisted' }
    : { allowed: false, reason: 'mainnet_token_not_valueless_whitelisted(N5b: refund 执行未接线, 有价值市场不得有判定题)' };
}

/** 启动 LOUD: 打印生效值(adapter 启动 + proto 路由注册各调一次)。 */
export function logOraclePolicy(log, policy, extra = '') {
  const line = `[proto-oracle] judged-market policy: adapter=${policy.adapterEnabled ? 'ENABLED' : 'disabled(default)'} network=${policy.network} valueless_token_ids=[${policy.valuelessTokenIds.join(',')}]${extra ? ' ' + extra : ''}` + (policy.network === 'mainnet' ? ' — 主网: 仅白名单零价值币可建判定题(N5b)' : '');
  (log.warn || log.log).call(log, line);
  for (const w of policy.warnings) (log.error || log.log).call(log, `[proto-oracle] POLICY WARNING: ${w}`);
}
