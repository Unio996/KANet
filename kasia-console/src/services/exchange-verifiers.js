/**
 * Exchange Verifiers — pluggable verification for /exchange protocol market.
 *
 * Design doc: exchange-state-machine-v1.0.md
 *
 * Each verifier implements: start(), checkProgress(), isCompleted(), isTimedOut()
 * State machine only sees five return values: pending / completed / failed / timed_out / disputed
 * State machine does NOT know what asset is being traded or how verification works internally.
 */

// ── BaseVerifier ─────────────────────────────────────────────

class BaseVerifier {
  /** Called when offer transitions to matched. Returns initial sub-status. */
  async start(matchContext) { return { status: 'pending' }; }

  /** Called to check progress. Returns { status, message? } */
  async checkProgress(matchContext) { return { status: 'pending' }; }

  /** Returns true when verification is complete. */
  async isCompleted(matchContext) { return false; }

  /** Returns true when verification has timed out. */
  async isTimedOut(matchContext) {
    if (!matchContext.timeout_at) return false;
    return new Date() > new Date(matchContext.timeout_at);
  }
}

// ── ManualVerifier ───────────────────────────────────────────

class ManualVerifier extends BaseVerifier {
  async start(matchContext) {
    return { status: 'pending', message: 'Awaiting manual confirmation from both parties' };
  }

  async checkProgress(matchContext) {
    const { offer } = matchContext;
    const makerOk = !!offer.maker_confirmed_at;
    const takerOk = !!offer.taker_confirmed_at;

    if (makerOk && takerOk) return { status: 'completed' };
    if (makerOk) return { status: 'pending', message: 'Maker confirmed, awaiting taker' };
    if (takerOk) return { status: 'pending', message: 'Taker confirmed, awaiting maker' };
    return { status: 'pending', message: 'Awaiting both confirmations' };
  }

  async isCompleted(matchContext) {
    const { offer } = matchContext;
    return !!offer.maker_confirmed_at && !!offer.taker_confirmed_at;
  }
}

// ── CrossChainTxVerifier ─────────────────────────────────────

class CrossChainTxVerifier extends BaseVerifier {
  async start(matchContext) {
    return { status: 'pending', message: 'Awaiting cross-chain TX proof' };
  }

  async checkProgress(matchContext) {
    const meta = JSON.parse(matchContext.offer.verification_meta || '{}');
    // If verification_meta has a confirmed tx, it's done
    if (meta.verified_tx) return { status: 'completed' };
    return { status: 'pending', message: `Awaiting TX on ${meta.chain || 'unknown'} chain` };
  }

  async isCompleted(matchContext) {
    const meta = JSON.parse(matchContext.offer.verification_meta || '{}');
    return !!meta.verified_tx;
  }
}

// ── KaspaTxVerifier ──────────────────────────────────────────

class KaspaTxVerifier extends BaseVerifier {
  async start(matchContext) {
    return { status: 'pending', message: 'Awaiting Kaspa TX confirmation' };
  }

  async checkProgress(matchContext) {
    const meta = JSON.parse(matchContext.offer.verification_meta || '{}');
    if (meta.verified_tx) return { status: 'completed' };
    return { status: 'pending', message: 'Awaiting Kaspa TX' };
  }

  async isCompleted(matchContext) {
    const meta = JSON.parse(matchContext.offer.verification_meta || '{}');
    return !!meta.verified_tx;
  }
}

// ── Registry ─────────────────────────────────────────────────

const _verifiers = {
  manual:          new ManualVerifier(),
  cross_chain_tx:  new CrossChainTxVerifier(),
  kaspa_tx:        new KaspaTxVerifier(),
  // btc_tx:       new BtcTxVerifier(),    // 待建
  // oracle:       new OracleVerifier(),    // 未来
};

/**
 * Get verifier by name. Falls back to ManualVerifier for unknown types.
 * @param {string} verificationType
 * @returns {BaseVerifier}
 */
export function getVerifier(verificationType) {
  return _verifiers[verificationType] || _verifiers.manual;
}

/**
 * Register a new verifier (extensibility).
 * @param {string} name
 * @param {BaseVerifier} instance
 */
export function registerVerifier(name, instance) {
  _verifiers[name] = instance;
}

/**
 * List available verifier types.
 * @returns {string[]}
 */
export function listVerifiers() {
  return Object.keys(_verifiers);
}
