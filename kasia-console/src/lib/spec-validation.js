// Single source of truth for "is this market spec usable" (structured + judgeable).
//
// 真单一源 (was the L44 follow-up flagged in api/pool.js): a market's resolution_rule_spec is USABLE
// iff it is JSON with non-empty title + resolution_criteria + data_source_canonical. This is the
// contract three places MUST agree on (drift = c06178c-class regression):
//   • create-time gate   — api/pool.js (reject bad specs at the source)
//   • display-time gates  — tg-bot/prediction-menu.mjs specIsUsable (Telegram) AND
//                           broker-llm-agent.js list_broker_prediction_markets (Kasia broker-DM)
//   • judge dependency    — bettor-prediction-voter.js deriveVote (kanet_native needs data_source_canonical URL)
// Pure leaf module (judgeline.mjs is also pure/no-I/O, so importing it keeps this light) so any of these
// can import it without pulling heavy graph / side-effects.
// (tg-bot can't cross-dir import; its specIsUsable stays a contract-synced mirror of this — keep in step.)
import { validateResolutionPredicate } from './judgeline.mjs';

export function isStructuredSpec(spec) {
  if (!spec) return false;
  const s = String(spec).trim();
  if (!s.startsWith('{')) return false;
  try {
    const obj = JSON.parse(s);
    return (
      typeof obj.title === 'string' && obj.title.trim().length > 0 &&
      typeof obj.resolution_criteria === 'string' && obj.resolution_criteria.trim().length > 0 &&
      typeof obj.data_source_canonical === 'string' && obj.data_source_canonical.trim().length > 0
    );
  } catch { return false; }
}

// SEAM fix (NWT FINDING-1, Bettor 裁决 2026-06-27): 建市 chokepoint 校验 caller 提交的 resolution_predicate。
// 真洞: create-v07 原只调 isStructuredSpec(title/criteria/source), spec 里的 resolution_predicate 原样落库零校验
// → raw caller POST 带整数线/畸形 predicate 绕过 buildSportsCard 烤上链 = judgeLine 无法判 = un-settleable stranded。
// 单源铁律 (线8 机制哲学): 校验语义全归 judgeline.mjs validateResolutionPredicate(含护栏6 半线·J1 owner 拍定折入),
//   此处仅 wire 调用, 绝不另实现一份(两处=必漂移)。create/v06/v07 三端共用此 chokepoint, 任何路径整数线必 400。
// 无 resolution_predicate = 走 LLM 判路(非结构化算术市场)→ 放行, additive 不破现有市场。
export function assertSpecPredicateValid(specStr) {
  let spec;
  try { spec = JSON.parse(specStr || '{}'); } catch { return { valid: true }; } // 非 JSON 由 isStructuredSpec 兜; 此处只管 predicate
  const p = spec && spec.resolution_predicate;
  if (!p) return { valid: true };
  return validateResolutionPredicate(p);
}
