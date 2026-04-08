/**
 * Base class for all protocol detectors.
 * Each protocol (kasia, kchat, kanet, ...) extends this class.
 */
export class ProtocolDetector {
  /** Protocol name identifier */
  get name() { return 'unknown'; }

  /** Protocol version string */
  get version() { return '1.0'; }

  /**
   * Detect whether a transaction belongs to this protocol.
   * @param {object} tx — raw transaction data
   * @returns {boolean}
   */
  detect(tx) { return false; }

  /**
   * Analyze a detected transaction and extract structured intelligence.
   * Only called if detect() returned true.
   * @param {object} tx — raw transaction data
   * @returns {object|null} — structured intel or null
   */
  analyze(tx) { return null; }

  /**
   * Scan for new protocol activity. Called each scan cycle.
   * Detectors that use external APIs (like the Kasia Indexer) override this
   * instead of detect/analyze, returning an array of discoveries.
   * @param {object} context — { state, seedAddresses }
   * @returns {Promise<{ discoveries: Array, interactions: Array }>}
   */
  async scan(context) {
    return { discoveries: [], interactions: [] };
  }
}
