/**
 * Skill: Whale Tracker — Kaspa 大额交易监控
 *
 * Monitors Kaspa blockchain for large transactions via Kaspa REST API.
 * Alerts the Agent Mind when whales move significant amounts of KAS.
 *
 * Data source: Kaspa Explorer API (free, no key)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const KASPA_API = 'https://api.kaspa.org';
const SOMPI_PER_KAS = 1e8;
const WHALE_THRESHOLD_KAS = 100_000; // 100K KAS = whale

export class WhaleTrackerSkill extends Skill {
  constructor() {
    super('whale_tracker', 'Monitor large Kaspa transactions and whale movements');
    this.lastCheck = null;
    this.recentWhales = [];
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Get recent blocks to find large transactions
      const res = await fetch(`${KASPA_API}/blocks?limit=20`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return { error: `Kaspa API returned ${res.status}` };

      const blocks = await res.json();
      const whaleTransactions = [];
      let totalVolume = 0;
      let txCount = 0;

      for (const block of blocks) {
        if (!block.transactions) continue;
        for (const tx of block.transactions) {
          if (!tx.outputs) continue;
          let txTotal = 0;
          for (const out of tx.outputs) {
            txTotal += out.amount || 0;
          }
          const kasAmount = txTotal / SOMPI_PER_KAS;
          totalVolume += kasAmount;
          txCount++;

          if (kasAmount >= WHALE_THRESHOLD_KAS) {
            whaleTransactions.push({
              txId: tx.transaction_id?.slice(0, 16),
              amount: Math.round(kasAmount),
              outputs: tx.outputs.length,
              blockHash: block.blockHash?.slice(0, 16),
            });
          }
        }
      }

      // Track trend
      const prevWhaleCount = this.recentWhales.length;
      this.recentWhales = whaleTransactions;

      return {
        whaleTransactions: whaleTransactions.slice(0, 5),
        whaleCount: whaleTransactions.length,
        prevWhaleCount,
        totalVolume: Math.round(totalVolume),
        txCount,
        avgTxKas: txCount > 0 ? Math.round(totalVolume / txCount) : 0,
        blocksScanned: blocks.length,
        thresholdKas: WHALE_THRESHOLD_KAS,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return {
        name: this.name,
        description: this.description,
        data: gathered,
        instructions: `Whale tracking unavailable: ${gathered.error}`,
      };
    }

    const lines = [];
    lines.push(`Scanned ${gathered.blocksScanned} blocks: ${gathered.txCount} txs, ${gathered.totalVolume.toLocaleString()} KAS volume`);
    lines.push(`Average tx: ${gathered.avgTxKas.toLocaleString()} KAS`);

    if (gathered.whaleCount > 0) {
      lines.push(`WHALE ALERT: ${gathered.whaleCount} transaction(s) over ${gathered.thresholdKas.toLocaleString()} KAS!`);
      for (const w of gathered.whaleTransactions) {
        lines.push(`  ${w.amount.toLocaleString()} KAS (tx: ${w.txId}...)`);
      }
    } else {
      lines.push('No whale activity detected in recent blocks.');
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'WHALE TRACKER REPORT:',
        ...lines,
        '',
        'Large movements may indicate accumulation, sell pressure, or exchange flows.',
        'Mention whale activity if someone asks about market dynamics.',
      ].join('\n'),
    };
  }
}
