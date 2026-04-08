/**
 * Skill: Social Outreach v4 — 时间加权版
 *
 * 唯一真相源：relation_states（per-agent）
 * 全局只查 kbeam_user 标签（协议不兼容）
 *
 * 逻辑：
 *   relation_states 无记录 → 陌生人，可推荐
 *   relation_states 有记录（任何状态）→ 已联系，跳过
 *   identities.tags 含 kbeam_user → 跳过
 *
 * 排序：活跃度 × 时间新鲜度（7天内满分，越老越低）
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class SocialOutreachSkill extends Skill {
  constructor() {
    super('social_outreach', 'Recommend social targets — per-agent dedup via account_relations');
  }

  canActivate(taskType, context) {
    if (taskType === 'reactive') return false;
    if (taskType === 'proactive') {
      const goals = context?.intent?.currentGoals || [];
      return goals.some(g =>
        g.status === 'active' && /connect|social|network|greet|outreach|explore/i.test(g.text)
      );
    }
    return taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    const myAddress = config.address;
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const relayNodeId = config.relayNodeId;

    // 全网活跃地址（Scout 数据）
    const perception = await kernels.perception.buildPerceptionContext();
    const allPeers = perception.topPeers || [];

    // 这个 Agent 已有的关系（per-agent，不影响其他 Agent）
    const myRelations = new Set();
    try {
      const res = await fetchJson(`${consoleUrl}/api/discovery/list?accountId=${encodeURIComponent(relayNodeId)}&limit=500`);
      if (Array.isArray(res)) {
        for (const r of res) {
          if (r.address) myRelations.add(r.address);
        }
      }
    } catch {}

    // 过滤
    const candidates = allPeers.filter(p => {
      if (p.address === myAddress) return false;
      if (myRelations.has(p.address)) return false;               // 已有关系（per-agent）
      if (p.tags && p.tags.includes('kbeam_user')) return false;  // KBeam 不兼容
      return true;
    });

    // 按活跃度 × 时间新鲜度排序
    // 7 天内活跃的满分，越老权重越低（14天以上 = 0.2 底分）
    const now = Date.now();
    const DAY_MS = 86400000;
    const ranked = candidates
      .map(p => {
        const lastActive = p.lastActive ? new Date(p.lastActive).getTime() : 0;
        const daysSince = lastActive ? (now - lastActive) / DAY_MS : 30;
        const freshness = daysSince <= 7 ? 1.0 : Math.max(0.2, 1.0 - (daysSince - 7) / 30);
        return { ...p, score: (p.total || 1) * freshness, freshness, daysSince: Math.round(daysSince) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      outreachTargets: ranked.map(p => ({
        address: p.address,
        name: p.displayName,
        activity: p.total,
        hasCard: !!p.cardMode,
        entityType: p.cardEntityType || null,
        summary: p.cardSummary || null,
        commCount: p.comm || 0,
        handshakeCount: p.handshake || 0,
        daysSince: p.daysSince,
        freshness: p.freshness,
      })),
      coverage: {
        totalNetworkPeers: allPeers.length,
        myRelations: myRelations.size,
        remainingCandidates: candidates.length,
      },
    };
  }

  formatForBrain(gathered) {
    const cov = gathered.coverage;
    const sections = [
      `SOCIAL OUTREACH: ${cov.myRelations} contacts / ${cov.totalNetworkPeers} known peers / ${cov.remainingCandidates} available`,
    ];

    if (gathered.outreachTargets.length === 0) {
      sections.push('No new targets. Consider following up with existing connections instead.');
      sections.push('Check YOUR CONNECTIONS above — anyone you haven\'t talked to recently?');
    } else {
      sections.push('');
      sections.push('New people on the network you haven\'t met:');
      for (const t of gathered.outreachTargets) {
        const details = [];
        if (t.name) details.push(`name: ${t.name}`);
        if (t.entityType) details.push(`type: ${t.entityType}`);
        if (t.summary) details.push(`bio: "${t.summary}"`);
        details.push(`activity: ${t.activity} actions`);
        details.push(`${t.handshakeCount} handshakes, ${t.commCount} messages`);
        if (t.hasCard) details.push('has Agent Card');
        if (t.daysSince !== undefined) {
          if (t.daysSince <= 1) details.push('🟢 active today');
          else if (t.daysSince <= 7) details.push(`active ${t.daysSince}d ago`);
          else details.push(`⚠ last seen ${t.daysSince}d ago`);
        }
        sections.push(`  - ${t.address}`);
        sections.push(`    ${details.join(' | ')}`);
      }
      sections.push('');
      sections.push('APPROACH:');
      sections.push('  1. Pick ONE target — quality over quantity.');
      sections.push('  2. Read their profile above. Tailor your message to who THEY are.');
      sections.push('  3. Ask a genuine question about them — don\'t just introduce yourself.');
      sections.push('  4. If they have a Card/bio, reference something specific from it.');
      sections.push('  5. Use initiate_handshake for first contact (costs ~0.2 KAS).');
    }

    return {
      name: this.name,
      description: 'Social outreach — per-agent dedup',
      data: gathered,
      instructions: sections.join('\n'),
    };
  }
}
