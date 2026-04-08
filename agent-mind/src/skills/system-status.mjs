/**
 * Skill: System Status
 *
 * Boundary skill — Agent monitors KANet infrastructure health.
 * Provides a real-time dashboard of all services:
 *   - Console (port 3100) — health endpoint
 *   - Adapters — running status, provider info
 *   - Relays — running status, connection state
 *   - Scanner — running/stopped
 *   - Mind — recent events, skill activations
 *   - Processes — pm2/child processes
 *
 * Activates on system/health/status queries (reactive only — never on proactive).
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';
import { execSync } from 'node:child_process';

const STATUS_KEYWORDS = [
  'status', 'health', 'system', 'running', 'alive', 'up', 'down',
  'service', 'process', 'port', 'diagnostic', 'monitor',
  '状态', '健康', '系统', '运行', '服务', '进程', '诊断', '监控',
];

export class SystemStatusSkill extends Skill {
  constructor() {
    super('system_status', 'Monitor KANet infrastructure — Console, Adapters, Relays, Scanner, Mind health');
  }

  canActivate(taskType, context) {
    // SECURITY: Never activate on proactive — system diagnostics are internal-only.
    // Brain would leak ports, service names, hostnames to strangers via SEND_MESSAGE.
    // Only activate on reactive when owner asks about system health.
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    return STATUS_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const { consoleUrl } = config;

    // Parallel health checks
    const [
      health,
      profile,
      adapters,
      scannerStatus,
      mindEvents,
      chainStats,
      tradePortfolio,
      systemDiag,
    ] = await Promise.all([
      // Console health
      fetchJson(`${consoleUrl}/health`).catch(() => null),
      // Agent profile (includes relay status)
      fetchJson(`${consoleUrl}/api/agent/profile`).catch(() => null),
      // Adapter status (HTML page, but we can check reachability)
      this._checkAdapters(consoleUrl),
      // Scanner status
      fetchJson(`${consoleUrl}/api/discovery/scanner/status`).catch(() => null),
      // Recent mind events
      fetchJson(`${consoleUrl}/api/agent/mind-events?limit=10`).catch(() => null),
      // Chain stats (ecosystem health)
      fetchJson(`${consoleUrl}/api/chain/stats`).catch(() => null),
      // Trade portfolio (MEXC connectivity)
      fetchJson(`${consoleUrl}/api/trade/portfolio`).catch(() => null),
      // System self-diagnosis (node, scout, adapter, relay)
      fetchJson(`${consoleUrl}/api/system/diagnose`).catch(() => null),
    ]);

    // Process check: which ports are listening
    const ports = this._checkPorts([3100, 3010, 3011, 3012, 3013, 3014]);

    // Uptime
    const consoleUp = !!health?.ok;
    const consoleUptime = health?.ts ? this._timeSince(health.ts) : null;

    // Agent statuses
    const agents = (profile || []).map(a => ({
      name: a.name,
      id: a.id,
      address: a.address?.slice(0, 20) + '...',
      contacts: a.stats?.contactCount || 0,
      interactions: a.stats?.interactionCount || 0,
      hasAdapter: !!a.adapter_node_id,
    }));

    // Scanner
    const scannerRunning = scannerStatus?.running ?? null;

    // Mind health (recent event rate)
    const recentEvents = (mindEvents || []).slice(0, 5);
    const lastEventAge = recentEvents.length > 0
      ? this._timeSince(recentEvents[0].created_at)
      : null;

    // MEXC connectivity
    const mexcConnected = tradePortfolio && !tradePortfolio.error;

    return {
      console: { up: consoleUp, uptime: consoleUptime },
      agents,
      scanner: { running: scannerRunning },
      adapters: adapters,
      ports,
      mind: { recentEvents, lastEventAge },
      chain: chainStats ? {
        totalInteractions: chainStats.activity?.total,
        last24h: chainStats.activity?.last24h,
        agentCards: chainStats.ecosystem?.agentCards,
        activeAddresses: chainStats.addresses?.active,
      } : null,
      mexc: { connected: mexcConnected },
      diagnosis: systemDiag,
    };
  }

  formatForBrain(gathered) {
    const sections = ['--- KANET SYSTEM STATUS (live) ---'];

    // Console
    const consoleIcon = gathered.console.up ? 'UP' : 'DOWN';
    sections.push(`\nConsole: ${consoleIcon}${gathered.console.uptime ? ' (checked ' + gathered.console.uptime + ')' : ''}`);

    // Agents
    if (gathered.agents.length > 0) {
      sections.push(`\nAgents (${gathered.agents.length}):`);
      for (const a of gathered.agents) {
        sections.push(`  ${a.name} — ${a.contacts} contacts, ${a.interactions} interactions, adapter: ${a.hasAdapter ? 'yes' : 'NO'}`);
      }
    }

    // Adapters
    if (gathered.adapters) {
      sections.push(`\nAdapters:`);
      for (const a of gathered.adapters) {
        sections.push(`  ${a.name} (port ${a.port}) — ${a.reachable ? 'reachable' : 'UNREACHABLE'}`);
      }
    }

    // Scanner
    if (gathered.scanner.running !== null) {
      sections.push(`\nScanner: ${gathered.scanner.running ? 'RUNNING' : 'STOPPED'}`);
    }

    // Ports
    if (gathered.ports.length > 0) {
      const listening = gathered.ports.filter(p => p.open).map(p => p.port);
      const closed = gathered.ports.filter(p => !p.open).map(p => p.port);
      sections.push(`\nPorts listening: ${listening.join(', ') || 'none'}`);
      if (closed.length > 0) sections.push(`Ports closed: ${closed.join(', ')}`);
    }

    // Mind
    if (gathered.mind.lastEventAge) {
      sections.push(`\nMind last event: ${gathered.mind.lastEventAge}`);
    }
    if (gathered.mind.recentEvents.length > 0) {
      sections.push('Recent mind events:');
      for (const e of gathered.mind.recentEvents.slice(0, 3)) {
        sections.push(`  [${e.event_type || e.eventType}] ${e.summary || ''} (${(e.created_at || '').slice(11, 19)})`);
      }
    }

    // Chain ecosystem
    if (gathered.chain) {
      sections.push(
        `\nChain ecosystem:`,
        `  Total interactions: ${gathered.chain.totalInteractions}`,
        `  Last 24h: ${gathered.chain.last24h}`,
        `  Agent Cards: ${gathered.chain.agentCards}`,
        `  Active addresses: ${gathered.chain.activeAddresses}`,
      );
    }

    // MEXC
    sections.push(`\nMEXC API: ${gathered.mexc.connected ? 'connected' : 'NOT connected'}`);

    // System Diagnosis (auto-detected issues + available fixes)
    if (gathered.diagnosis?.issues?.length > 0) {
      sections.push(`\n--- SYSTEM ISSUES DETECTED (${gathered.diagnosis.status}) ---`);
      for (const issue of gathered.diagnosis.issues) {
        const fixNote = issue.fix ? ` [可自动修复: POST /api/system/repair {fixId:"${issue.fix}"}]` : ' [需人工处理]';
        sections.push(`  [${issue.severity}] ${issue.component}: ${issue.message}${fixNote}`);
      }
    } else if (gathered.diagnosis) {
      sections.push('\nSystem diagnosis: ALL HEALTHY — no issues detected');
    }

    // Instructions
    sections.push(
      '',
      'Report system health concisely. Flag any issues:',
      '- DOWN services need immediate attention',
      '- Missing adapters mean agents cannot think',
      '- Stopped scanner means no chain data flowing',
      '- Closed ports suggest crashed processes',
      '- If fixable issues found, tell owner what you can fix and ask permission',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        consoleUp: gathered.console.up,
        agentCount: gathered.agents.length,
        scannerRunning: gathered.scanner.running,
        mexcConnected: gathered.mexc.connected,
      },
      instructions: sections.join('\n'),
    };
  }

  // ── Helpers ──

  /** Check adapter reachability by querying Console profile */
  async _checkAdapters(consoleUrl) {
    try {
      const profile = await fetchJson(`${consoleUrl}/api/agent/profile`);
      const adapters = [];
      const seen = new Set();

      for (const agent of (profile || [])) {
        if (!agent.adapter_node_id || seen.has(agent.adapter_node_id)) continue;
        seen.add(agent.adapter_node_id);

        const port = agent.adapterPort || agent.http_port;
        let reachable = false;
        if (port) {
          try {
            const res = await fetch(`http://localhost:${port}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            reachable = res.ok;
          } catch {
            // Port not responding — try basic TCP
            reachable = false;
          }
        }

        adapters.push({
          name: agent.adapterName || `adapter-${agent.adapter_node_id}`,
          port: port || 'unknown',
          reachable,
          agentName: agent.name,
        });
      }
      return adapters;
    } catch {
      return [];
    }
  }

  /** Check which ports are listening */
  _checkPorts(ports) {
    return ports.map(port => {
      try {
        // Use netstat on Windows
        const out = execSync(
          `netstat -ano | grep ":${port} " | grep LISTENING 2>/dev/null || true`,
          { encoding: 'utf-8', timeout: 2000 }
        );
        return { port, open: out.trim().length > 0 };
      } catch {
        return { port, open: false };
      }
    });
  }

  /** Human-readable time since a timestamp */
  _timeSince(isoStr) {
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
      if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
      return `${Math.round(diff / 3600000)}h ago`;
    } catch {
      return null;
    }
  }
}
