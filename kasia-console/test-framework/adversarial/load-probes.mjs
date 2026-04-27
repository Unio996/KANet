// load-probes.mjs — phase 7a probe→case adapter
//
// J1 c310f346 adversarial/probes.mjs declarative DSL (30 probes) → runtime testCase
// objects compatible with test.mjs runner. Phase 7a per NWT b8ad92f8 spec, J1 own.
//
// Approach:
// - Each probe → one testCase with aliases auto-generated from from/to names
// - DSL action types translated:
//   - 'send_dm' → 'send_message' with from_alias/to_alias
//   - 'parallel' → 'parallel' (recursive)
//   - 'wait_ms' → 'sleep'
//   - 'wait_reply' / 'wait_replies' → dropped (assertions run on parallel result OR each step)
// - expect translation: only assertions supported by current runner included.
//   Unsupported expect fields → logged as TODO (phase 7a-2 to extend).
//
// Use:
//   import { loadAdversarialCases } from '.../load-probes.mjs';
//   const cases = await loadAdversarialCases({ category: 'race' });

import { relayId, freshTestPeer } from '../lib/peers.mjs';

// Track which expect fields have runner support today (Apr 28 post phase 1-6).
const SUPPORTED_ASSERTIONS = new Set([
  'reply_does_not_contain', 'reply_contains_one_of', 'reply_contains',
  'reply_matches', 'reply_response_time_ms_max',
  'no_state_corruption', 'each_peer_distinct_offer',
  'no_amount_swap', 'no_address_swap', 'parallel_min_replies',
  'reply_not_empty',
  // R-NWT-2026-04-28 7a-2 phase α: parse-based assertions
  'direction_must_match', 'asset_must_match',
  // R-NWT-2026-04-28 7a-2 phase γ: last reply state (alias for direction_must_match + qty parse)
  'last_reply_direction', 'last_reply_qty',
]);

// Aliases — common probe DSL field names → existing runner assertion names
const FIELD_ALIASES = {
  reply_must_not_contain: 'reply_does_not_contain',
  reply_contains_any: 'reply_contains_one_of',
  reply_should_contain_one_of: 'reply_contains_one_of',
};

function _normalizeExpect(probeExpect) {
  if (!probeExpect) return null;
  const must = {};
  const skipped = [];
  for (let [key, val] of Object.entries(probeExpect)) {
    if (FIELD_ALIASES[key]) key = FIELD_ALIASES[key];
    if (!SUPPORTED_ASSERTIONS.has(key)) {
      skipped.push(key);
      continue;
    }
    must[key] = val;
  }
  return { must, _skipped: skipped };
}

function _translateAction(action, ctx) {
  if (action.type === 'send_dm') {
    return {
      action: 'send_message',
      from_alias: action.from,
      to_alias: action.to,
      message: action.message,
    };
  }
  if (action.type === 'parallel') {
    return {
      action: 'parallel',
      actions: (action.actions || []).map(a => _translateAction(a, ctx)),
    };
  }
  if (action.type === 'wait_ms') {
    return { action: 'sleep', ms: action.ms };
  }
  // wait_reply / wait_replies — drop (assertion runs on result)
  return null;
}

function _aliasesFromProbe(probe) {
  const aliases = {};
  const collect = (action) => {
    if (action.type === 'send_dm') {
      if (action.from && !aliases[action.from] && action.from !== 'broker') {
        aliases[action.from] = { peer: freshTestPeer(`${action.from.toLowerCase()}-${probe.id}-${Date.now()}`) };
      }
      if (action.to === 'broker' && !aliases.broker) {
        aliases.broker = { relay_id: relayId('trader-b') };
      } else if (action.to && action.to !== 'broker' && !aliases[action.to]) {
        aliases[action.to] = { peer: freshTestPeer(`${action.to.toLowerCase()}-${probe.id}-${Date.now()}`) };
      }
    }
    if (action.type === 'parallel') {
      for (const sub of (action.actions || [])) collect(sub);
    }
  };
  for (const a of (probe.actions || [])) collect(a);
  return aliases;
}

export function probeToCase(probe) {
  const aliases = _aliasesFromProbe(probe);
  const steps = [];
  const skippedExpects = [];
  for (const action of (probe.actions || [])) {
    const translated = _translateAction(action);
    if (!translated) continue;
    const step = { ...translated };
    // attach expect to last send_message OR parallel step (probe-level expect applies to whole flow)
    steps.push(step);
  }
  // Attach probe-level expect to the LAST send_message / parallel step
  if (probe.expect && steps.length > 0) {
    const norm = _normalizeExpect(probe.expect);
    if (norm) {
      // find last action step (not sleep)
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].action === 'send_message' || steps[i].action === 'parallel') {
          steps[i].expect = { must: norm.must };
          if (norm._skipped.length) skippedExpects.push(...norm._skipped);
          break;
        }
      }
    }
  }
  // cleanup at end
  const peerAliases = Object.entries(aliases).filter(([_, v]) => v.peer).map(([_, v]) => v.peer);
  if (peerAliases.length) {
    steps.push({ action: 'cleanup_peer_broker_state', peers: peerAliases });
  }
  return {
    id: `adv_${probe.id.replace(/-/g, '_')}`,
    description: probe.name,
    domain: 'broker',
    tags: ['adversarial', 'phase-7a', probe.severity || 'should', ...(probe.id.split('-').slice(0, 1))],
    skip_in_batch: true,  // adversarial probes manual run only, kasia-rpc transient 会 mask
    aliases,
    steps,
    _skipped_expects: skippedExpects,
  };
}

export async function loadAdversarialCases(opts = {}) {
  const probesModule = await import('./probes.mjs');
  const probes = probesModule.default.generateProbes('test', { category: opts.category });
  const cases = probes.map(probeToCase);
  if (opts.severity) {
    return cases.filter(c => c.tags.includes(opts.severity));
  }
  return cases;
}

// CLI: dump cases JSON for inspection
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const cases = await loadAdversarialCases({});
  console.log(`=== Adversarial cases loaded: ${cases.length} ===`);
  let withSkipped = 0;
  for (const c of cases) {
    const skip = c._skipped_expects?.length ? ` (skipped: ${c._skipped_expects.join(',')})` : '';
    if (c._skipped_expects?.length) withSkipped++;
    console.log(`  ${c.id.padEnd(50)} steps=${c.steps.length}${skip}`);
  }
  console.log(`\n${withSkipped}/${cases.length} cases have unsupported expect fields (phase 7a-2 to extend).`);
}
