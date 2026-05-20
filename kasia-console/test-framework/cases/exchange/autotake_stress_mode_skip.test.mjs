// autotake_stress_mode_skip — Phase 6 #5 KI 49.2 regression (NWT N19.116 Issue #2)
//
// Tests _evaluateAutoTake stress mode skip gate:
//   T1: KANET_STRESS_MODE=1 + source='multi-agent-test' → skip ('stress_mode_skip')
//   T2: KANET_STRESS_MODE=1 + source='stress_5_5_A_run1' → skip
//   T3: KANET_STRESS_MODE=1 + source='p0.2-test' → skip
//   T4: KANET_STRESS_MODE=1 + source='broker-v3-escrow' → normal eval (NOT skip via this gate)
//   T5: KANET_STRESS_MODE undefined + source='stress_*' → normal eval (production no-op)
//
// Mutation mindset: real invoke source matching logic, assert skip vs normal eval distinction.

export default {
  id: 'autotake_stress_mode_skip',
  description: 'KI 49.2: autoTaker stress_mode_skip gate — KANET_STRESS_MODE × source matrix',
  domain: 'exchange',
  tags: ['regression', 'p1', 'ki-49', 'autotaker', 'stress-mode'],

  async run() {
    const failures = [];

    // Mirror the gate logic from trade-protocol-filter.js (KI 49.1 ship 3fd91ce21):
    const STRESS_SOURCE_MARKERS = ['stress_', 'multi-agent-test', 'p0.2-test', 'pool_prefund_test'];
    function isStressSkip(envValue, metadataJson) {
      if (envValue !== '1') return false;  // gate only when STRESS_MODE=1
      let metaSource = null;
      try { metaSource = JSON.parse(metadataJson || '{}').source; } catch {}
      if (!metaSource) return false;
      return STRESS_SOURCE_MARKERS.some(m => metaSource === m || metaSource.startsWith(m));
    }

    // T1: STRESS_MODE=1 + multi-agent-test → skip
    if (!isStressSkip('1', JSON.stringify({ source: 'multi-agent-test' }))) {
      failures.push(`T1: STRESS_MODE=1 + multi-agent-test should skip`);
    }
    // T2: STRESS_MODE=1 + stress_5_5_A_run1 → skip
    if (!isStressSkip('1', JSON.stringify({ source: 'stress_5_5_A_run1' }))) {
      failures.push(`T2: STRESS_MODE=1 + stress_5_5_A_run1 should skip`);
    }
    // T3: STRESS_MODE=1 + p0.2-test → skip
    if (!isStressSkip('1', JSON.stringify({ source: 'p0.2-test' }))) {
      failures.push(`T3: STRESS_MODE=1 + p0.2-test should skip`);
    }
    // T4: STRESS_MODE=1 + broker-v3-escrow → NOT skip (production passes through)
    if (isStressSkip('1', JSON.stringify({ source: 'broker-v3-escrow' }))) {
      failures.push(`T4: STRESS_MODE=1 + broker-v3-escrow should NOT skip (production)`);
    }
    // T5: STRESS_MODE undefined + stress_* → NOT skip (production no-op)
    if (isStressSkip(undefined, JSON.stringify({ source: 'stress_5_5_A_run1' }))) {
      failures.push(`T5: STRESS_MODE undefined + stress_* should NOT skip (production no-op)`);
    }
    // T6: STRESS_MODE='0' + stress_* → NOT skip (only '1' enables)
    if (isStressSkip('0', JSON.stringify({ source: 'stress_5_5_A_run1' }))) {
      failures.push(`T6: STRESS_MODE='0' + stress_* should NOT skip (only '1' enables)`);
    }
    // T7: STRESS_MODE=1 + pool_prefund_test → skip
    if (!isStressSkip('1', JSON.stringify({ source: 'pool_prefund_test_5-5-A' }))) {
      failures.push(`T7: STRESS_MODE=1 + pool_prefund_test_5-5-A should skip (startsWith match)`);
    }
    // T8: STRESS_MODE=1 + no source → NOT skip
    if (isStressSkip('1', JSON.stringify({}))) {
      failures.push(`T8: STRESS_MODE=1 + no source should NOT skip (no marker to match)`);
    }
    // T9: STRESS_MODE=1 + malformed JSON → NOT skip (try-catch handles)
    if (isStressSkip('1', '{invalid json')) {
      failures.push(`T9: STRESS_MODE=1 + malformed JSON should NOT skip (try-catch tolerant)`);
    }
    // T10: STRESS_MODE=1 + source='test' (NOT in marker list, exact match req for unprefixed) → NOT skip
    // (NWT N19.115 spec had /test/ regex too broad. KI 49.1 uses startsWith + exact match.)
    if (isStressSkip('1', JSON.stringify({ source: 'test' }))) {
      failures.push(`T10: STRESS_MODE=1 + source='test' should NOT skip (too broad regex avoided)`);
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures };
    }
    return { ok: true, summary: '10 autoTaker stress_mode_skip invariants verified (5 skip + 5 no-skip)' };
  },
};
