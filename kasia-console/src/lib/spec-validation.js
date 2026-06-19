// Single source of truth for "is this market spec usable" (structured + judgeable).
//
// 真单一源 (was the L44 follow-up flagged in api/pool.js): a market's resolution_rule_spec is USABLE
// iff it is JSON with non-empty title + resolution_criteria + data_source_canonical. This is the
// contract three places MUST agree on (drift = c06178c-class regression):
//   • create-time gate   — api/pool.js (reject bad specs at the source)
//   • display-time gates  — tg-bot/prediction-menu.mjs specIsUsable (Telegram) AND
//                           broker-llm-agent.js list_broker_prediction_markets (Kasia broker-DM)
//   • judge dependency    — bettor-prediction-voter.js deriveVote (kanet_native needs data_source_canonical URL)
// Pure leaf module (no deps) so any of these can import it without pulling heavy graph / side-effects.
// (tg-bot can't cross-dir import; its specIsUsable stays a contract-synced mirror of this — keep in step.)
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
