/**
 * Skill: Chain Sense — 链上侦测
 *
 * Analyzes on-chain Kasia activity to detect patterns:
 *   - New addresses / new Agent Cards
 *   - Activity trends (who's getting active/going silent)
 *   - Handshake hotspots (social network structure)
 *   - Anomalies (sudden bursts or drops)
 *
 * Data source: Console /api/discovery/activity + /api/discovery/stats
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class ChainSenseSkill extends Skill {
  constructor() {
    super('chain_sense', 'Analyze on-chain Kasia activity patterns and detect notable events');
    this.lastSnapshot = null;  // previous cycle's data for trend comparison
  }

  canActivate(taskType, context) {
    // Proactive/reflect: always (chain is core awareness)
    if (taskType !== 'reactive') return true;
    // Reactive: only when message mentions chain/network/peer/address topics
    const msg = context?._inputMessage || '';
    return /chain|network|peer|address|node|block|tx|handshake|链|网络|节点|地址|活动|交易|握手|observation/i.test(msg);
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl;
    const myAddress = config.address;

    // Fetch current network state and stats in parallel
    const [activity, stats] = await Promise.all([
      fetchJson(`${consoleUrl}/api/discovery/activity?limit=100`).catch(() => null),
      fetchJson(`${consoleUrl}/api/discovery/stats`).catch(() => null),
    ]);

    if (!activity) return { error: 'Console unreachable' };

    const profiles = activity.profiles || [];
    const handshakes = activity.handshakes || [];
    const netStats = activity.stats || {};

    // --- Analysis 1: New & notable addresses ---
    const withCards = profiles.filter(p => p.card_mode);
    const unknownActive = profiles.filter(
      p => p.identity_type === 'unknown' && p.total >= 3
    );

    // --- Analysis 2: Activity trends (compare with last snapshot) ---
    let trends = null;
    if (this.lastSnapshot) {
      const prevMap = new Map(this.lastSnapshot.map(p => [p.address, p.total]));
      const rising = [];
      const fading = [];

      for (const p of profiles) {
        const prev = prevMap.get(p.address);
        if (prev != null) {
          const delta = p.total - prev;
          if (delta >= 5) rising.push({ address: p.address, name: p.display_name, delta });
          // Can't detect fading from this data alone — would need timestamps
        } else {
          // Brand new address since last cycle
          rising.push({ address: p.address, name: p.display_name, delta: p.total, isNew: true });
        }
      }

      if (rising.length > 0 || fading.length > 0) {
        trends = { rising: rising.slice(0, 5), fading: fading.slice(0, 5) };
      }
    }

    // Save snapshot for next cycle's trend comparison
    this.lastSnapshot = profiles.map(p => ({ address: p.address, total: p.total }));

    // --- Analysis 3: Handshake hotspots ---
    const handshakeCount = {};
    for (const h of handshakes) {
      handshakeCount[h.from_addr] = (handshakeCount[h.from_addr] || 0) + 1;
      handshakeCount[h.to_addr] = (handshakeCount[h.to_addr] || 0) + 1;
    }
    const hotspots = Object.entries(handshakeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([address, count]) => {
        const profile = profiles.find(p => p.address === address);
        return { address, name: profile?.display_name || null, handshakeCount: count };
      });

    // --- Analysis 4: My position in the network ---
    const myProfile = profiles.find(p => p.address === myAddress);
    const myHandshakes = handshakes.filter(
      h => h.from_addr === myAddress || h.to_addr === myAddress
    );
    const myRank = profiles.findIndex(p => p.address === myAddress);

    // --- Analysis 5: Discovery funnel (if stats available) ---
    const funnel = stats?.discovery || null;

    return {
      networkOverview: {
        totalPeers: profiles.length,
        totalInteractions: netStats.total_interactions || 0,
        totalHandshakes: netStats.total_handshakes || 0,
        uniqueSenders: netStats.unique_senders || 0,
      },
      agentCards: withCards.map(p => ({
        address: p.address,
        name: p.display_name,
        entityType: p.card_entity_type,
        skills: p.card_skills_json ? JSON.parse(p.card_skills_json) : [],
      })),
      unknownActiveAddresses: unknownActive.slice(0, 10).map(p => ({
        address: p.address,
        totalActivity: p.total,
        firstActive: p.first_active,
        lastActive: p.last_active,
      })),
      trends,
      handshakeHotspots: hotspots,
      myPosition: myProfile ? {
        rank: myRank + 1,
        totalActivity: myProfile.total,
        handshakes: myHandshakes.length,
      } : { rank: null, totalActivity: 0, handshakes: 0 },
      funnel,
    };
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return {
        name: this.name,
        description: this.description,
        data: gathered,
        instructions: 'Chain analysis unavailable this cycle.',
      };
    }

    const lines = [];
    lines.push(`Network: ${gathered.networkOverview.totalPeers} peers, ${gathered.networkOverview.totalInteractions} interactions, ${gathered.networkOverview.totalHandshakes} handshakes.`);

    if (gathered.agentCards.length > 0) {
      lines.push(`Known agents with Cards: ${gathered.agentCards.map(a => a.name || a.address.slice(0, 15)).join(', ')}.`);
    }

    if (gathered.unknownActiveAddresses.length > 0) {
      lines.push(`${gathered.unknownActiveAddresses.length} unknown but active addresses detected — potential new peers.`);
    }

    if (gathered.trends) {
      if (gathered.trends.rising.length > 0) {
        const names = gathered.trends.rising.map(r =>
          `${r.name || r.address.slice(0, 15)}(+${r.delta}${r.isNew ? ',NEW' : ''})`
        ).join(', ');
        lines.push(`Rising activity: ${names}.`);
      }
    }

    if (gathered.handshakeHotspots.length > 0) {
      const top = gathered.handshakeHotspots[0];
      lines.push(`Handshake hotspot: ${top.name || top.address.slice(0, 15)} (${top.handshakeCount} handshakes).`);
    }

    if (gathered.myPosition.rank) {
      lines.push(`Your rank: #${gathered.myPosition.rank} with ${gathered.myPosition.totalActivity} interactions, ${gathered.myPosition.handshakes} handshakes.`);
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'CHAIN SENSE REPORT:',
        ...lines,
        '',
        'Use this intelligence to inform your decisions.',
        'Notable unknowns may be worth investigating or greeting.',
        'Rising peers may be good collaboration targets.',
      ].join('\n'),
    };
  }
}
