// harness-lib-d032.mjs — D-032 单口径 simnet e2e harness 库(改自 2026-09-21 四臂 harness 的 harness-lib.mjs, D-031 复用)。
// createJudgedMarket 改为真走 §2.6 命题身份绑定(bindCanonicalEventIdentity 两步回签), 不再传 outcomeConditionId/umaWindowMs(D-032 已删)。
// 用前须已设好 DB_PATH / CONSOLE_ENCRYPTION_KEY / E2E_REPO_SRC(kasia-console/src 绝对路径); import 全动态, 保证 env 先于 DB 客户端加载。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

export const SRC = process.env.E2E_REPO_SRC;
if (!SRC) throw new Error('harness-lib-d032: E2E_REPO_SRC 未设(kasia-console/src 绝对路径)');
const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href);
export const H = 3_600_000;

/** 预算配置: simnet e2e 的环境参数(默认读 process.env, 与起 console 的 kanet.simnet.env 同口径——缩窗方便真跑不用等主网默认 30/5min)。 */
export async function e2eBudgetCfg(env = process.env, tickMs = 20_000) {
  const { resolveBudgetConfig } = await imp('lib/proto-settlement-budget.mjs');
  const r = resolveBudgetConfig(env, { tickMs }); if (r.warnings.length) throw new Error('e2e 预算配置有 warning(应为 0): ' + r.warnings.join(' | '));
  return r.config;
}

/**
 * D-032 单口径判定题市场创建(§2.1 校验 + §2.6 命题身份绑定, 真走 fetch——调用方须已装 upstream-mock)。
 * @param {{tokenId:string, title:string, deadlineMs:number, outcomeEndMs:number, spec:object, minBet?:number}} o  spec 不含 outcomeConditionId/polymarket_outcome_side
 * @returns {Promise<{id:string, normalized:object, canonical_event:object, resolution_statement:string}>}
 */
export async function createJudgedMarket({ tokenId, title, deadlineMs, outcomeEndMs, spec, minBet = 1, nowMs = Date.now() }) {
  const { validateJudgedMarketInput } = await imp('lib/proto-oracle-spec.mjs');
  const adapterTickMs = Number(process.env.PROTO_ORACLE_ADAPTER_INTERVAL_MS) || 300_000;
  const cfg = await e2eBudgetCfg(process.env, Number(process.env.PROTO_SETTLEMENT_DRIVER_INTERVAL_MS) || 20_000);
  const v = validateJudgedMarketInput({ title, deadlineMs, resolutionRuleSpec: spec, outcomeEndMs, budgetCfg: cfg, adapterTickMs, nowMs });
  if (!v.ok) throw new Error(`harness: 判定题输入校验失败 ${v.code}: ${v.error}`);
  const { bindCanonicalEventIdentity } = await imp('lib/proto-oracle-identity.mjs');
  const { normalizeSideMap } = await imp('lib/proto-oracle-verdict.mjs');
  const parsedSpec = JSON.parse(v.normalized.resolution_rule_spec);
  const first = await bindCanonicalEventIdentity({ url: parsedSpec.data_source_canonical, predicate: parsedSpec.resolution_predicate, sideMap: normalizeSideMap(parsedSpec.side_map), outcomeEndMs: v.normalized.outcome_end_ms });
  if (!(first.ok === false && first.code === 'attest_required')) throw new Error(`harness: §2.6 第一步预期 attest_required, 实得 ${JSON.stringify(first)}`);
  const second = await bindCanonicalEventIdentity({ url: parsedSpec.data_source_canonical, predicate: parsedSpec.resolution_predicate, sideMap: normalizeSideMap(parsedSpec.side_map), outcomeEndMs: v.normalized.outcome_end_ms, attestStatement: first.statement });
  if (!second.ok) throw new Error(`harness: §2.6 第二步(原样回签)预期成功, 实得 ${JSON.stringify(second)}`);
  parsedSpec.canonical_event = second.canonical_event; parsedSpec.resolution_statement = second.resolution_statement;

  const { computeMarketGenesisArtifacts } = await imp('lib/proto-covenant-builder.mjs');
  const { ensureMarketPending } = await imp('lib/proto-market-intent.mjs');
  const id = randomBytes(32).toString('hex');
  const artifacts = await computeMarketGenesisArtifacts({ marketId: id, minBet, deadlineMs });
  ensureMarketPending({
    id, token_def_id: tokenId, question: title.trim(), deadline_ms: deadlineMs, min_bet: minBet, seal_count: 2,
    committee_pubkeys_json: JSON.stringify([artifacts.committeePubkeyHex]), committee_privkey_enc: artifacts.committeePrivkeyEnvelope,
    rootclose_tmpl_hash: artifacts.rootCloseTmplHash, shardleaf_own_redeem_len: artifacts.shardLeafOwnRedeemLen,
    resolution_rule_spec: JSON.stringify(parsedSpec), outcome_market_source: v.normalized.outcome_market_source, outcome_condition_id: v.normalized.outcome_condition_id,
    outcome_oracle_relay_ids: v.normalized.outcome_oracle_relay_ids, outcome_end_ms: v.normalized.outcome_end_ms,
  });
  return { id, normalized: v.normalized, canonical_event: second.canonical_event, resolution_statement: second.resolution_statement };
}

/** 标准 spec(D-032 单口径: 去 polymarket_outcome_side, 不再需要极性字段)。event/homeId/awayId 须与 upstream-mock 场景文件的 registryTeamIds 对得上(已定)。 */
export function mkSpec({ event, predicate = { metric: 'winner', op: '==', operand: 'LAL' }, sideMap = { yes: 1, no: 0 } }) {
  return { data_source_canonical: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event}`, secondary_sources: [], ambiguity_handler: 'abstain', dispute_keywords: [], edge_case_examples: [], resolution_predicate: predicate, side_map: sideMap, title: 'D-032 e2e market' };
}
