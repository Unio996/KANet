/**
 * Scanner engine — orchestrates protocol detectors on a timed loop.
 * Collects discoveries from all detectors and forwards them to the reporter.
 */
import { getDetectors } from './protocols/registry.mjs';
import { getState, saveState } from './lib/state.mjs';

export class Scanner {
  constructor(reporter, { intervalMs = 30000, seedAddresses = [] } = {}) {
    this.reporter = reporter;
    this.intervalMs = intervalMs;
    this.seedAddresses = seedAddresses;
    this._timer = null;
    this._running = false;
  }

  start() {
    console.log(`[scanner] starting — interval ${this.intervalMs / 1000}s, ${this.seedAddresses.length} seed addresses`);
    // Run first scan immediately, then on interval
    this._runCycle();
    this._timer = setInterval(() => this._runCycle(), this.intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[scanner] stopped');
  }

  async _runCycle() {
    if (this._running) return; // Skip if previous cycle still running
    this._running = true;

    const state = getState();
    const detectors = getDetectors();
    let totalDiscoveries = 0;
    let totalInteractions = 0;

    for (const detector of detectors) {
      try {
        const { discoveries, interactions } = await detector.scan({
          state,
          seedAddresses: this.seedAddresses,
        });

        if (discoveries.length > 0 || interactions.length > 0) {
          const result = await this.reporter.report(discoveries, interactions);
          totalDiscoveries += result.registered;
          totalInteractions += result.interactions;
        }
      } catch (err) {
        console.error(`[scanner] ${detector.name} error: ${err.message}`);
      }
    }

    // Persist state after each cycle
    saveState();

    if (totalDiscoveries > 0 || totalInteractions > 0) {
      console.log(`[scanner] cycle done — ${totalDiscoveries} new addresses, ${totalInteractions} new interactions`);
    }

    this._running = false;
  }
}
