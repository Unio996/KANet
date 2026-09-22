// harness-lib.mjs — simnet e2e 的 harness 库(本地演练与真 simnet 共用)。不入生产树。
// createJudgedMarket: 建判定题市场——调【同一批库函数】: validateJudgedMarketInput(用足够远的 deadline 过校验, 真跑白名单 / 谓词 / side_map / condition id 校验并拿规范化列)
//   → computeMarketGenesisArtifacts + ensureMarketPending(judged 列同一条 INSERT), 用【真实的短 deadline】。等于创建路由去掉"deadline 预算"这一条(该条由 spec / 路由测试覆盖)。
// 使用前须已设好 DB_PATH / CONSOLE_ENCRYPTION_KEY(只按变量名从 env 读, 不打印值); 本文件所有 import 都是动态的, 保证 env 先于 DB 客户端加载。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

export const SRC = process.env.E2E_REPO_SRC || (process.env.E2E_REPO_KC ? process.env.E2E_REPO_KC + '/src' : 'D:/kanet-tn12/scratch/_j2_wt_pointers_shape/kasia-console/src');
const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
export const H = 3_600_000;

/** 预算配置: simnet e2e 的环境参数(方案 §3)。 */
export async function e2eBudgetCfg(env = { PROTO_GRACE_MS: '120000', PROTO_GRACE_MIN_MS: '60000', PROTO_PROMOTION_SAFETY_MS: '3600000' }, tickMs = 20_000) {
  const { resolveBudgetConfig } = await imp('lib/proto-settlement-budget.mjs');
  const r = resolveBudgetConfig(env, { tickMs }); if (r.warnings.length) throw new Error('e2e 预算配置有 warning(应为 0): ' + r.warnings.join(' | '));
  return r.config;
}

/**
 * @param {{tokenId:string, title:string, deadlineMs:number, outcomeEndMs:number, spec:object, conditionId:string, minBet?:number}} o
 * @returns {Promise<{id:string, normalized:object}>}
 */
export async function createJudgedMarket({ tokenId, title, deadlineMs, outcomeEndMs, spec, conditionId, minBet = 1, nowMs = Date.now() }) {
  const { validateJudgedMarketInput } = await imp('lib/proto-oracle-spec.mjs');
  const { UMA_FINALIZATION_WINDOW_MS } = await imp('services/bettor-prediction-voter.js');
  const cfg = await e2eBudgetCfg();
  // 用足够远的 deadline 过创建路由的同一份校验(deadline 预算一条对 e2e 无意义), 拿规范化列
  const v = validateJudgedMarketInput({ title, deadlineMs: outcomeEndMs + 200 * H, resolutionRuleSpec: spec, outcomeEndMs, outcomeConditionId: conditionId, budgetCfg: cfg, umaWindowMs: UMA_FINALIZATION_WINDOW_MS, nowMs });
  if (!v.ok) throw new Error(`harness: 判定题输入校验失败 ${v.code}: ${v.error}`);
  const { computeMarketGenesisArtifacts } = await imp('lib/proto-covenant-builder.mjs');
  const { ensureMarketPending } = await imp('lib/proto-market-intent.mjs');
  const id = randomBytes(32).toString('hex');
  const artifacts = await computeMarketGenesisArtifacts({ marketId: id, minBet, deadlineMs });
  ensureMarketPending({
    id, token_def_id: tokenId, question: title.trim(), deadline_ms: deadlineMs, min_bet: minBet, seal_count: 2,
    committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
    rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
    resolution_rule_spec: v.normalized.resolution_rule_spec, outcome_market_source: v.normalized.outcome_market_source, outcome_condition_id: v.normalized.outcome_condition_id,
    outcome_oracle_relay_ids: v.normalized.outcome_oracle_relay_ids, outcome_end_ms: v.normalized.outcome_end_ms,
  });
  return { id, normalized: v.normalized };
}

/** 标准 spec(ESPN 事件 id + 谓词 + side_map + 极性)。 */
export function mkSpec({ event, predicate = { metric: 'winner', op: '==', operand: 'LAL' }, sideMap = { yes: 1, no: 0 }, polarity = 'YES' }) {
  return { data_source_canonical: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event}`, secondary_sources: [], ambiguity_handler: 'abstain', dispute_keywords: [], edge_case_examples: [], resolution_predicate: predicate, side_map: sideMap, polymarket_outcome_side: polarity, title: 'e2e market' };
}
export const condOf = (n) => '0x' + n.toString(16).padStart(64, '0');
