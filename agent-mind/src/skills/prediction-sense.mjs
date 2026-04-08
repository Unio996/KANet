/**
 * Skill: Prediction Sense — 预测市场情绪 + 宏观风向标
 *
 * 读取 Polymarket 热门事件，提炼为：
 *   - 政治/经济/crypto/科技分类
 *   - 概率变化 = 市场共识方向
 *   - 高成交量事件 = 真金白银的判断
 *   - 与交易决策的关联解读
 *
 * 预测市场是"聪明钱的投票"——比新闻标题更可靠的信号。
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const KEYWORDS = [
  'prediction', 'predict', '预测', '预测市场', 'polymarket',
  'probability', '概率', 'odds', '赔率',
  'election', '选举', 'recession', '衰退',
  'event', '事件', 'will', '会不会',
];

export class PredictionSenseSkill extends Skill {
  constructor() {
    super('prediction_sense', 'Track prediction markets (Polymarket) — event probabilities as macro sentiment signals');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return true;
    if (taskType === 'reflect') return true;
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    return KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const { consoleUrl } = config;
    const predictions = await fetchJson(`${consoleUrl}/api/predictions/markets`).catch(() => null);

    if (!predictions?.ok) return { error: 'prediction data unavailable', data: [] };

    return {
      markets: predictions.data || [],
      count: (predictions.data || []).length,
    };
  }

  formatForBrain(gathered) {
    if (gathered.error) return { name: this.name, description: this.description, data: {}, instructions: 'Prediction market data unavailable.' };

    const sections = ['--- PREDICTION MARKETS (Polymarket, live) ---'];
    sections.push(`Top ${gathered.count} markets by volume:\n`);

    for (const m of gathered.markets) {
      const vol = m.volume ? `$${(m.volume / 1000).toFixed(0)}K vol` : '';
      sections.push(`  Q: ${m.question}`);
      if (m.outcome) sections.push(`     → ${m.outcome}`);
      if (vol) sections.push(`     ${vol}`);
      sections.push('');
    }

    sections.push(
      'Prediction markets = smart money consensus:',
      '- High probability (>80%) events are near-certain — plan accordingly',
      '- Rapid probability shifts signal breaking developments',
      '- Crypto-related predictions directly inform trading strategy',
      '- Political/economic events affect risk appetite globally',
    );

    return {
      name: this.name,
      description: this.description,
      data: { marketCount: gathered.count },
      instructions: sections.join('\n'),
    };
  }
}

export default PredictionSenseSkill;
