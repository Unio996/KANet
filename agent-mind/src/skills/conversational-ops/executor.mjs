/**
 * Intent Executors — one function per intent, each calls Console API.
 * Returns structured data ready for Brain summarization via buildQueryTask().
 *
 * Data contract: every executor returns a plain object.
 * Brain receives it as JSON in the task prompt.
 * formatHint (from intent-parser) tells Brain how to present it.
 */

import { fetchJson } from '../../utils.mjs';

/**
 * Execute a matched intent by fetching real data from Console API.
 * @param {string} intent - intent name from INTENTS registry
 * @param {object} params - extracted params (from regex)
 * @param {object} config - agent config (consoleUrl, relayNodeId, address)
 * @returns {Promise<object>} structured data for Brain
 */
export async function executeQuery(intent, params, config) {
  const base = config.consoleUrl || 'http://localhost:3100';
  const id = config.relayNodeId;

  const executors = {
    async query_balance() {
      const [bal, wallets] = await Promise.all([
        fetchJson(`${base}/api/relay/${id}/balance`).catch(() => ({ balance: null })),
        fetchJson(`${base}/api/relay/${id}/wallets`).catch(() => ({ kaspa: null, chains: [] })),
      ]);
      return {
        kaspa: { balance: bal.balance, address: config.address },
        chains: (wallets.chains || []).map(w => ({
          chain: w.chain,
          address: w.address,
          usdtBalance: w.usdtBalance,
          nativeBalance: w.nativeBalance,
          label: w.label,
          isDefault: w.isDefault,
        })),
      };
    },

    async query_price() {
      try {
        const data = await fetchJson(
          'https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true'
        );
        const kas = data.kaspa || {};
        return {
          price: kas.usd,
          change24h: kas.usd_24h_change,
          volume24h: kas.usd_24h_vol,
          marketCap: kas.usd_market_cap,
        };
      } catch (err) {
        return { error: `Price fetch failed: ${err.message}` };
      }
    },

    async query_orders() {
      try {
        const orders = await fetchJson(`${base}/api/trade/open-orders`);
        return {
          orders: Array.isArray(orders) ? orders : [],
          count: Array.isArray(orders) ? orders.length : 0,
        };
      } catch (err) {
        return { orders: [], count: 0, note: 'Exchange not connected or no credentials' };
      }
    },

    async query_goals() {
      try {
        const goals = await fetchJson(`${base}/api/relay/${id}/goals`);
        return {
          active: goals.filter(g => g.status === 'active').sort((a, b) => b.priority - a.priority),
          retired: goals.filter(g => g.status === 'retired').slice(0, 3),
          total: goals.length,
        };
      } catch {
        return { active: [], retired: [], total: 0 };
      }
    },

    async query_system() {
      try {
        // Aggregate from multiple sources
        const [agents, events] = await Promise.all([
          fetchJson(`${base}/api/agent/profile`).catch(() => []),
          fetchJson(`${base}/api/agent/mind-events?limit=5`).catch(() => []),
        ]);
        return {
          agentCount: agents.length,
          agents: agents.map(a => ({ name: a.name, contacts: a.stats?.contactCount, interactions: a.stats?.interactionCount })),
          recentEvents: events.slice(0, 5).map(e => ({ type: e.event_type, summary: e.summary, time: e.created_at })),
        };
      } catch (err) {
        return { error: `System status unavailable: ${err.message}` };
      }
    },

    async query_tx_history() {
      const limit = parseInt(params.limit) || 10;
      try {
        const txs = await fetchJson(`${base}/api/agent/tx-history?relay_node_id=${id}&limit=${limit}`);
        return { transactions: txs, count: txs.length };
      } catch {
        return { transactions: [], count: 0 };
      }
    },

    async query_contacts() {
      try {
        const list = await fetchJson(`${base}/api/discovery/list?accountId=${id}&limit=20`);
        const sorted = list.sort((a, b) =>
          new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0)
        );
        return {
          contacts: sorted.slice(0, 15).map(c => ({
            name: c.display_name || c.address?.slice(-8),
            address: c.address,
            status: c.status,
            interactionCount: c.interaction_count,
            lastSeen: c.last_seen_at,
          })),
          total: list.length,
        };
      } catch {
        return { contacts: [], total: 0 };
      }
    },

    async query_network() {
      try {
        const data = await fetchJson(`${base}/api/discovery/activity?limit=50`);
        return {
          totalAddresses: data.stats?.totalAddresses || 0,
          active24h: data.stats?.activeThis24h || 0,
          profiles: (data.profiles || []).slice(0, 10).map(p => ({
            address: p.address,
            name: p.display_name || p.address?.slice(-8),
            activity: p.total,
            type: p.card_entity_type || 'unknown',
          })),
        };
      } catch {
        return { totalAddresses: 0, active24h: 0, profiles: [] };
      }
    },

    async query_reputation() {
      const addr = params.address;
      if (!addr) return { error: '需要提供 kaspa 地址' };
      try {
        const relations = await fetchJson(`${base}/api/discovery/list?accountId=${id}&limit=200`);
        const match = relations.find(r => r.address === addr);
        const interactions = await fetchJson(
          `${base}/api/discovery/interaction?addressA=${config.address}&addressB=${addr}`
        ).catch(() => ({ count: 0 }));
        return {
          address: addr,
          known: !!match,
          status: match?.status || 'unknown',
          name: match?.display_name || null,
          interactionCount: interactions?.count || 0,
          hasCard: !!(match?.card_entity_type),
          entityType: match?.card_entity_type || null,
          lastSeen: match?.last_seen_at || null,
        };
      } catch {
        return { address: addr, known: false, error: 'Could not query reputation' };
      }
    },

    async diagnose_system() {
      // 1. 诊断
      const diag = await fetchJson(`${base}/api/system/diagnose`).catch(() => null);
      if (!diag) return { error: '无法连接诊断 API' };

      // 2. 如果 owner 指定了 fixId，执行修复
      if (params.fixId) {
        const result = await fetchJson(`${base}/api/system/repair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixId: params.fixId }),
        }).catch(e => ({ ok: false, message: e.message }));
        return { diagnosis: diag, repairAttempted: params.fixId, repairResult: result };
      }

      // 3. 只诊断，不修复
      return {
        systemStatus: diag.status,
        issues: diag.issues.map(i => ({
          component: i.component,
          severity: i.severity,
          message: i.message,
          canFix: !!i.fix,
          fixId: i.fix || null,
          fixLabel: i.fixLabel || null,
        })),
        hint: diag.issues.some(i => i.fix)
          ? '发现可修复的问题。告诉 Owner 具体问题和修复方案，得到确认后执行 "修复 {fixId}"'
          : null,
      };
    },
  };

  const executor = executors[intent];
  if (!executor) return { error: `No executor for intent: ${intent}` };

  try {
    return await executor();
  } catch (err) {
    return { error: `Query failed: ${err.message}` };
  }
}
