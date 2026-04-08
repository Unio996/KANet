/**
 * Skill: News Digest — 加密货币新闻聚合
 *
 * Fetches latest crypto and Kaspa news from public RSS/Atom feeds.
 * Gives the Agent current events to discuss and reference in conversations.
 *
 * Data source: CoinDesk RSS + Kaspa Medium (free, no key)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
];

export class NewsDigestSkill extends Skill {
  constructor() {
    super('news_digest', 'Aggregate latest crypto news headlines for informed conversations');
    this.lastHeadlines = [];
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    const allItems = [];

    for (const feed of FEEDS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(feed.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'KANet-Agent/1.0' },
        });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const xml = await res.text();

        // Simple RSS/XML parsing without dependencies
        const items = this._parseRss(xml, feed.name);
        allItems.push(...items);
      } catch {
        // Feed unavailable, skip silently
      }
    }

    // Sort by date, take latest 10
    allItems.sort((a, b) => (b.date || 0) - (a.date || 0));
    const headlines = allItems.slice(0, 10);

    // Detect new headlines since last check
    const prevTitles = new Set(this.lastHeadlines.map(h => h.title));
    const newCount = headlines.filter(h => !prevTitles.has(h.title)).length;
    this.lastHeadlines = headlines;

    // Detect Kaspa mentions
    const kaspaRelated = headlines.filter(h =>
      /kaspa|kas\b|blockdag|dag\b/i.test(h.title)
    );

    return {
      headlines,
      totalFetched: allItems.length,
      newSinceLastCheck: newCount,
      kaspaRelated,
      feedsQueried: FEEDS.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  _parseRss(xml, source) {
    const items = [];
    // Match <item> or <entry> blocks
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1] || match[2];
      const title = this._extractTag(block, 'title');
      const pubDate = this._extractTag(block, 'pubDate') || this._extractTag(block, 'published') || this._extractTag(block, 'updated');
      if (title) {
        items.push({
          title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
          source,
          date: pubDate ? new Date(pubDate).getTime() : null,
          dateStr: pubDate || null,
        });
      }
      if (items.length >= 10) break;
    }
    return items;
  }

  _extractTag(block, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(re);
    return m ? m[1].trim() : null;
  }

  formatForBrain(gathered) {
    if (gathered.headlines.length === 0) {
      return { name: this.name, description: this.description, data: gathered, instructions: 'No news available this cycle.' };
    }

    const lines = [];
    lines.push(`${gathered.headlines.length} headlines from ${gathered.feedsQueried} sources (${gathered.newSinceLastCheck} new)`);

    if (gathered.kaspaRelated.length > 0) {
      lines.push(`KASPA MENTIONS: ${gathered.kaspaRelated.length} headline(s)!`);
      for (const h of gathered.kaspaRelated) {
        lines.push(`  [${h.source}] ${h.title}`);
      }
      lines.push('');
    }

    lines.push('Latest headlines:');
    for (const h of gathered.headlines.slice(0, 6)) {
      lines.push(`  [${h.source}] ${h.title}`);
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'NEWS DIGEST:',
        ...lines,
        '',
        'Reference current events in conversations when relevant.',
        'Kaspa-related news is especially valuable to share with peers.',
      ].join('\n'),
    };
  }
}
