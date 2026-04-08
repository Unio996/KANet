/**
 * Skill: Address Profiler — 地址画像分析
 *
 * Analyzes Kaspa addresses from Console's discovery data to build behavioral profiles.
 * Helps the Agent understand WHO it's dealing with based on on-chain behavior.
 *
 * Data source: Console /api/discovery/activity (local)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class AddressProfilerSkill extends Skill {
  constructor() {
    super('address_profiler', 'Analyze addresses by on-chain behavior to understand who they are');
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl;

    const activity = await fetchJson(`${consoleUrl}/api/discovery/activity?limit=200`).catch(() => null);
    if (!activity) return { error: 'Console unreachable' };

    const profiles = activity.profiles || [];
    const handshakes = activity.handshakes || [];

    const analyzed = [];
    for (const p of profiles.slice(0, 20)) {
      // Behavioral classification
      let role = 'observer';
      if (p.card_entity_type) role = p.card_entity_type;
      else if (p.handshake > 5) role = 'social_hub';
      else if (p.comm > 20) role = 'active_communicator';
      else if (p.self_stash > 3) role = 'data_hoarder';
      else if (p.bcast > 5) role = 'broadcaster';
      else if (p.total >= 10) role = 'regular';

      // Activity pattern
      const hoursActive = p.hours_active || 0;
      let pattern = 'sporadic';
      if (hoursActive > 24) pattern = 'persistent';
      else if (hoursActive > 4) pattern = 'multi_session';
      else if (p.freq_per_hour > 50) pattern = 'burst';

      // Social connectivity
      const peerHandshakes = handshakes.filter(
        h => h.from_addr === p.address || h.to_addr === p.address
      );
      const uniquePeers = new Set();
      for (const h of peerHandshakes) {
        uniquePeers.add(h.from_addr === p.address ? h.to_addr : h.from_addr);
      }

      analyzed.push({
        address: p.address,
        name: p.display_name,
        role,
        pattern,
        totalActivity: p.total,
        breakdown: { comm: p.comm || 0, handshake: p.handshake || 0, bcast: p.bcast || 0, stash: p.self_stash || 0 },
        socialConnections: uniquePeers.size,
        hasCard: !!p.card_mode,
        cardType: p.card_entity_type,
        firstActive: p.first_active,
        lastActive: p.last_active,
      });
    }

    // Network-level insights
    const roleCounts = {};
    for (const a of analyzed) {
      roleCounts[a.role] = (roleCounts[a.role] || 0) + 1;
    }

    return {
      profiledAddresses: analyzed.length,
      profiles: analyzed.slice(0, 10),
      roleDistribution: roleCounts,
      totalNetworkPeers: profiles.length,
    };
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return { name: this.name, description: this.description, data: gathered, instructions: `Profiling unavailable: ${gathered.error}` };
    }

    const lines = [];
    lines.push(`Profiled ${gathered.profiledAddresses} addresses from ${gathered.totalNetworkPeers} known peers.`);

    // Role distribution
    const roles = Object.entries(gathered.roleDistribution)
      .map(([r, c]) => `${r}(${c})`)
      .join(', ');
    lines.push(`Roles: ${roles}`);

    // Highlight notable profiles
    const notable = gathered.profiles.filter(p => p.socialConnections >= 2 || p.hasCard || p.totalActivity >= 20);
    if (notable.length > 0) {
      lines.push('Notable addresses:');
      for (const p of notable.slice(0, 3)) {
        const label = p.name || p.address.slice(0, 18) + '...';
        lines.push(`  ${label}: ${p.role}, ${p.totalActivity} actions, ${p.socialConnections} connections, pattern=${p.pattern}`);
      }
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'ADDRESS PROFILER REPORT:',
        ...lines,
        '',
        'Use profiles to personalize interactions.',
        'Social hubs are good for introductions. Broadcasters spread information.',
        'Data hoarders value privacy. Adjust approach per role.',
      ].join('\n'),
    };
  }
}
