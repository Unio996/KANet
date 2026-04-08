/**
 * Perception Kernel — "What do I see?"
 *
 * Loads network state from Console /api/discovery/activity API.
 * Tracks: network stats, active peers, handshake graph.
 */

import { fetchJson } from '../utils.mjs';

const CACHE_TTL = 30_000; // 30 seconds

export class PerceptionKernel {
  constructor(config) {
    this.config = config;
    this.stats = null;
    this.profiles = [];
    this.handshakes = [];
    this.lastFetch = 0;
  }

  async refresh() {
    const now = Date.now();
    if (this.stats && (now - this.lastFetch) < CACHE_TTL) return;

    try {
      const data = await fetchJson(`${this.config.consoleUrl}/api/discovery/activity?limit=50`);
      if (data) {
        this.stats = data.stats || null;
        this.profiles = data.profiles || [];
        this.handshakes = data.handshakes || [];
        this.lastFetch = now;
        console.log(`[agent-mind:perception] Refreshed: ${this.profiles.length} peers, ${this.handshakes.length} handshakes`);
      }
    } catch (err) {
      console.log(`[agent-mind:perception] Refresh failed: ${err.message}`);
    }
  }

  async buildPerceptionContext() {
    await this.refresh();

    const myAddr = this.config.address;

    return {
      networkStats: this.stats || { total_interactions: 0, unique_senders: 0, total_handshakes: 0 },
      topPeers: this.profiles.slice(0, 15).map(p => ({
        address: p.address,
        displayName: p.display_name,
        total: p.total,
        comm: p.comm,
        handshake: p.handshake,
        firstActive: p.first_active,
        lastActive: p.last_active,
        freqPerHour: p.freq_per_hour,
        cardMode: p.card_mode || null,
        cardEntityType: p.card_entity_type || null,
        cardSummary: p.card_summary || null,
        tags: p.tags || null,
      })),
      totalPeers: this.profiles.length,
      handshakeGraph: this.handshakes.slice(0, 20).map(h => ({
        from: h.from_addr,
        to: h.to_addr,
        time: h.occurred_at,
      })),
      myConnections: this.handshakes.filter(
        h => h.from_addr === myAddr || h.to_addr === myAddr
      ).map(h => {
        const peerAddr = h.from_addr === myAddr ? h.to_addr : h.from_addr;
        // Merge profile data for richer connection context
        const profile = this.profiles.find(p => p.address === peerAddr);
        return {
          peer: peerAddr,
          address: peerAddr,
          displayName: profile?.display_name || null,
          entityType: profile?.card_entity_type || null,
          comm: profile?.comm || 0,
          lastActive: profile?.last_active || null,
          direction: h.from_addr === myAddr ? 'outgoing' : 'incoming',
          time: h.occurred_at,
        };
      }),
    };
  }
}
