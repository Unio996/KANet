/**
 * Kaspa Network Health — external test skill
 *
 * Fetches Kaspa network stats from public API and reports
 * hashrate trend, block rate, and network health status.
 */

import { Skill } from './base.mjs';

export class KaspaNetworkHealth extends Skill {
  constructor() {
    super('kaspa_network_health', 'Monitor Kaspa network health — hashrate, block rate, DAA score');
  }

  canActivate(taskType, context) {
    // Active in proactive and reactive modes
    return taskType === 'proactive' || taskType === 'reactive';
  }

  async gatherContext(kernels, config) {
    try {
      const res = await fetch(`${config.consoleUrl}/api/chain/fundamentals`);
      const data = await res.json();
      if (!data.available) return { available: false };

      return {
        available: true,
        hashrate: data.latest?.hashrate || null,
        blockCount: data.latest?.block_count || null,
        daaScore: data.latest?.daa_score || null,
        tipsCount: data.latest?.tips_count || null,
        timestamp: data.latest?.created_at || null,
      };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (!gathered.available) {
      return {
        name: this.name,
        description: this.description,
        data: gathered,
        instructions: 'Kaspa network data unavailable.',
      };
    }

    const hashrateTH = gathered.hashrate ? (gathered.hashrate / 1e12).toFixed(2) : '?';

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        `=== KASPA NETWORK HEALTH ===`,
        `Hashrate: ${hashrateTH} TH/s`,
        `Block count: ${gathered.blockCount?.toLocaleString() || '?'}`,
        `DAA score: ${gathered.daaScore?.toLocaleString() || '?'}`,
        `Tips: ${gathered.tipsCount || '?'}`,
        `Last updated: ${gathered.timestamp || '?'}`,
        `Use this data to inform conversations about Kaspa network status.`,
      ].join('\n'),
    };
  }
}
