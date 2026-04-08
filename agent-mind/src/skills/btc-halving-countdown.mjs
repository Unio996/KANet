/**
 * Skill: BTC Halving Countdown — 比特币减半倒计时
 *
 * Tracks the next Bitcoin halving event using real-time block height data.
 * Useful context for crypto market discussions.
 *
 * Data source: Blockchain.info API (free, no key)
 * Install: upload this file via KANet Console /skills page.
 */

import { Skill } from './base.mjs';

const BLOCK_HEIGHT_API = 'https://blockchain.info/q/getblockcount';
const HALVING_INTERVAL = 210_000;
const AVG_BLOCK_MINUTES = 10;

export class BtcHalvingCountdownSkill extends Skill {
  constructor() {
    super('btc_halving_countdown', 'Track countdown to next Bitcoin halving with real-time block data');
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(BLOCK_HEIGHT_API, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return { error: `Blockchain API returned ${res.status}` };

      const currentBlock = parseInt(await res.text());
      const nextHalving = Math.ceil(currentBlock / HALVING_INTERVAL) * HALVING_INTERVAL;
      const blocksRemaining = nextHalving - currentBlock;
      const minutesRemaining = blocksRemaining * AVG_BLOCK_MINUTES;
      const daysRemaining = Math.round(minutesRemaining / 60 / 24);
      const halvingNumber = nextHalving / HALVING_INTERVAL;

      // Current reward
      const currentReward = 50 / Math.pow(2, halvingNumber - 1);
      const nextReward = currentReward / 2;

      return {
        currentBlock,
        nextHalvingBlock: nextHalving,
        blocksRemaining,
        daysRemaining,
        halvingNumber,
        currentReward,
        nextReward,
        estimatedDate: new Date(Date.now() + minutesRemaining * 60000).toISOString().slice(0, 10),
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return { name: this.name, description: this.description, data: gathered, instructions: `BTC halving data unavailable: ${gathered.error}` };
    }

    const lines = [
      `BTC block height: ${gathered.currentBlock.toLocaleString()}`,
      `Next halving (#${gathered.halvingNumber}): block ${gathered.nextHalvingBlock.toLocaleString()}`,
      `Blocks remaining: ${gathered.blocksRemaining.toLocaleString()} (~${gathered.daysRemaining} days)`,
      `Estimated date: ${gathered.estimatedDate}`,
      `Reward: ${gathered.currentReward} BTC → ${gathered.nextReward} BTC`,
    ];

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'BTC HALVING COUNTDOWN:',
        ...lines,
        '',
        'Halvings historically precede major bull runs.',
        'Share this context when discussing crypto market cycles.',
      ].join('\n'),
    };
  }
}
