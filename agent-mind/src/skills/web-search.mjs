/**
 * Skill: Web Search — 联网搜索
 *
 * Searches the web via DuckDuckGo Instant Answer API.
 * Gives the Agent ability to look up real-time information.
 *
 * Data source: DuckDuckGo API (free, no key)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const DDG_API = 'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=';

export class WebSearchSkill extends Skill {
  constructor() {
    super('web_search', 'Search the web for real-time information via DuckDuckGo');
    this.lastResults = [];
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return true;
    if (taskType === 'reactive') {
      // Only when message asks a question or mentions search-worthy topics
      const msg = context?._inputMessage || '';
      return /\?|search|look up|find|what is|how|news|latest|最新|搜|查|新闻|怎么/i.test(msg);
    }
    // For reflect: search for self-relevant info
    if (taskType === 'reflect') return true;
    return false;
  }

  async gatherContext(kernels, config) {
    // Proactive: search for latest Kaspa news/updates
    const queries = ['Kaspa KAS crypto latest', 'Kaspa blockchain update 2026'];
    const results = [];

    for (const query of queries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(DDG_API + encodeURIComponent(query), {
          signal: controller.signal,
          headers: { 'User-Agent': 'KANet-Agent/1.0' },
        });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const data = await res.json();

        // Abstract (main answer)
        if (data.Abstract) {
          results.push({
            type: 'abstract',
            query,
            title: data.Heading || query,
            text: data.Abstract,
            source: data.AbstractSource,
            url: data.AbstractURL,
          });
        }

        // Related topics
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 3)) {
            if (topic.Text) {
              results.push({
                type: 'related',
                query,
                text: topic.Text,
                url: topic.FirstURL,
              });
            }
          }
        }

        // Infobox
        if (data.Infobox?.content) {
          const facts = data.Infobox.content
            .filter(c => c.label && c.value)
            .slice(0, 5)
            .map(c => `${c.label}: ${c.value}`);
          if (facts.length > 0) {
            results.push({
              type: 'infobox',
              query,
              facts,
            });
          }
        }
      } catch {
        // Search failed, skip
      }
    }

    this.lastResults = results;

    return {
      results,
      queriesRun: queries.length,
      resultsFound: results.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  formatForBrain(gathered) {
    if (gathered.resultsFound === 0) {
      return { name: this.name, description: this.description, data: gathered, instructions: 'Web search returned no results this cycle.' };
    }

    const lines = [];
    lines.push(`Web search: ${gathered.resultsFound} result(s) from ${gathered.queriesRun} queries`);

    for (const r of gathered.results.slice(0, 5)) {
      if (r.type === 'abstract') {
        lines.push(`[${r.source}] ${r.title}: ${r.text.slice(0, 150)}...`);
      } else if (r.type === 'related') {
        lines.push(`  - ${r.text.slice(0, 120)}`);
      } else if (r.type === 'infobox') {
        lines.push(`  Facts: ${r.facts.join(' | ')}`);
      }
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'WEB SEARCH RESULTS:',
        ...lines,
        '',
        'Use these facts to stay informed and answer questions accurately.',
        'Always attribute information to its source when sharing.',
      ].join('\n'),
    };
  }
}
