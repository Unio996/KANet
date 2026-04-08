/**
 * Self Kernel — "Who am I?"
 *
 * Loads the agent's Card data from Console, maintains identity context:
 * agent ID, Card fields, principles, style, role boundaries.
 */

import { fetchJson } from '../utils.mjs';

export class SelfKernel {
  constructor(config) {
    this.config = config;
    this.card = null;
    this.lastCardFetch = 0;
    this.cardCacheTtl = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Fetch agent's Card from Console API.
   * Falls back to config-only identity if API unavailable.
   */
  async refreshCard() {
    const now = Date.now();
    if (this.card && (now - this.lastCardFetch) < this.cardCacheTtl) {
      return; // cache still fresh
    }

    const { consoleUrl, relayNodeId } = this.config;
    try {
      const card = await fetchJson(`${consoleUrl}/api/relay/${relayNodeId}/card`);
      if (card && !card.error) {
        this.card = card;
        this.lastCardFetch = now;
        console.log(`[agent-mind:self] Card loaded for ${this.config.name}`);
      }
    } catch (err) {
      console.log(`[agent-mind:self] Card fetch failed (using config fallback): ${err.message}`);
    }
  }

  /**
   * Build structured self-description for context injection.
   */
  async buildSelfContext() {
    await this.refreshCard();

    return {
      name: this.config.name,
      address: this.config.address,
      relayNodeId: this.config.relayNodeId,
      principles: this.config.principles || [],
      style: this.config.style || 'neutral',
      card: this.card ? {
        skills: this.card.skills || [],
        description: this.card.description || '',
        version: this.card.version || 0,
        publishedAt: this.card.publishedAt || null,
        fields: this.card.fields || {},
      } : null,
      roleBoundaries: [
        `I am ${this.config.name}, an autonomous agent on the Kasia network.`,
        'My identity is anchored to my on-chain address and history.',
        'I do not pretend to be human or claim capabilities I lack.',
      ],
    };
  }
}
