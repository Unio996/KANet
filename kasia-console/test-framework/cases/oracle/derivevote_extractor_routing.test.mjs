// GAP-1 regression — deriveVote routes by KNOWN_EXTRACTORS registry, not per-source enum.
//
// scope: open-testnet DoD 门A item④ "实源 ESPN 裁". Before fix, deriveVote
//   (bettor-prediction-voter.js) dispatched by outcome_market_source enum
//   (polymarket / kanet_* / coingecko) and had NO 'espn' branch, so espn markets
//   hit `unsupported outcome_market_source: espn` → 0 vote → 0 settle. Voter log
//   实证 360× deriveVote-fail. The extractor (extractEspnEvidence) + valid ESPN
//   canonical URL already existed; only the routing was missing.
// fix: route ANY source whose data_source_canonical hits findExtractor(url) through
//   deriveKanetNativeVote (= registry single source of truth — covers espn/coingecko/
//   future BBC/Reuters/AP, kills "add extractor but forget deriveVote enum" divergence).
// guard: any回归 to per-source enum hardcoding → espn (and future sources) re-break.

export default {
  id: 'oracle_derivevote_extractor_routing',
  description: 'GAP-1 — deriveVote routes espn/known-extractor sources past L728 unsupported (registry-driven, not enum)',
  domain: 'oracle',
  tags: ['regression', 'p0', 'gap-1', 'derivevote', 'espn', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const { deriveVote } = await import('../../../src/services/bettor-prediction-voter.js');
    const { findExtractor } = await import('../../../src/lib/oracle-evidence-extractors.mjs');

    const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401815661';
    const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

    // I1: routing predicate — ESPN canonical hits a known extractor
    if (findExtractor(ESPN) === null) failures.push('I1: findExtractor(ESPN) returned null — extractor registry missing espn');

    // I2: espn source routes PAST L728 unsupported (= reaches deriveKanetNativeVote).
    // Downstream may ABSTAIN / fail on adapter LLM config in a bare test env — that is
    // NOT a routing failure. The regression we guard is the "unsupported outcome_market_source"
    // verdict re-appearing for a source whose canonical has a known extractor.
    const espnRes = await deriveVote({
      id: 'reg-espn', outcome_market_source: 'espn',
      resolution_rule_spec: JSON.stringify({ data_source_canonical: ESPN }),
    });
    if ((espnRes.reason || '').includes('unsupported outcome_market_source')) {
      failures.push(`I2: espn source still 'unsupported' — routing regressed: ${espnRes.reason}`);
    }

    // I3: coingecko (the other known extractor) also routes past unsupported.
    const cgRes = await deriveVote({
      id: 'reg-cg', outcome_market_source: 'coingecko',
      resolution_rule_spec: JSON.stringify({ data_source_canonical: COINGECKO }),
    });
    if ((cgRes.reason || '').includes('unsupported outcome_market_source')) {
      failures.push(`I3: coingecko source still 'unsupported' — routing regressed: ${cgRes.reason}`);
    }

    // I4: genuinely unknown source (no extractor match) MUST still be rejected — no over-routing.
    const unkRes = await deriveVote({
      id: 'reg-unk', outcome_market_source: 'weatherchannel',
      resolution_rule_spec: JSON.stringify({ data_source_canonical: 'https://example.com/no-extractor' }),
    });
    if (unkRes.ok || !(unkRes.reason || '').includes('unsupported')) {
      failures.push(`I4: unknown source NOT rejected — over-routing: ${JSON.stringify(unkRes)}`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
