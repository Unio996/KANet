/**
 * Skill: Bettor — Prediction Market Analyst
 *
 * Phase 2 设计:
 *   - Skill 阶段: parseRule + 预算 infoGapMonths 注入 Brain context
 *   - Brain 阶段: 估 pMid/sigma + 输出 [ACTION:BET_PREDICT ...]
 *   - action-executor 阶段: 跑 recommendBet (确定性) + 格式化 Bet Card + sendReply
 *
 * 不让 LLM 算 Kelly 数学 — GLM4.7 实测会偷懒/拍脑袋. 数学交给 Phase 1 lib.
 */

import { Skill } from './base.mjs';
import { parseRule, latestEmbeddedDate } from './bettor/rule-parser.mjs';

const TRAINING_CUTOFF = '2026-01-31';

const KEYWORDS = [
  'polymarket', 'kalshi', 'manifold',
  'prediction market', 'prediction', '预测市场', '预测',
  'bet', 'betting', '押注', '下注', '赌注',
  'kelly', 'edge', '赔率',
  'yes price', 'no price', '报价',
  'odds', 'probability', '概率',
];

const BETTOR_INSTRUCTIONS = `
You are Bettor — a calibrated forecaster for binary prediction markets.

WORKFLOW:
1. EXTRACT from Owner's message:
   - market title (one short phrase)
   - YES price (decimal, e.g. 0.07)
   - bankroll (default 1000 if not given)
2. ESTIMATE pMid (your central probability estimate, 0-1) and sigma (std dev).
   - Use heuristic rule parse below if available
   - When ambiguous, shave toward NO (conservative)
3. EMIT EXACTLY ONE ACTION line, lowercase keys, this format:

   [ACTION:BET_PREDICT market="<short title>" pMid=<0-1> sigma=<0-1> yesPrice=<0-1> bankroll=<number> infoGapMonths=<from context, default 0> kellyFraction=0.25]

CRITICAL — kellyFraction must ALWAYS be exactly 0.25 (1/4 Kelly base).
DO NOT change kellyFraction based on info gap or sigma — the code handles those adjustments.
If you pass 0.125 thinking it's "more conservative", you cause double-halving and wrong position size.

DO NOT compute Kelly yourself. DO NOT write a Bet Card.
After you emit BET_PREDICT, an ACTION_RESULT will come back with a "betCard" string field.
Your final reply MUST be exactly the value of result.betCard, verbatim, no commentary, no extra lines.

If the message is NOT a prediction market query, defer to other skills or reply normally (no ACTION).
`.trim();

function computeInfoGapMonths(parsed) {
  if (!parsed) return 0;
  const latest = latestEmbeddedDate(parsed);
  if (!latest) return 0;
  const cutoff = new Date(TRAINING_CUTOFF);
  const gapMs = latest.getTime() - cutoff.getTime();
  return Math.max(0, gapMs / (1000 * 60 * 60 * 24 * 30.44));
}

export class BettorSkill extends Skill {
  constructor() {
    super(
      'bettor',
      'Prediction market analyst — Kelly-disciplined sizing for Polymarket/Kalshi/Manifold'
    );
    this.keywords = KEYWORDS;
    this._inputMessage = '';
  }

  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    this._inputMessage = context?._inputMessage || '';
    return this._keywordsMatch(taskType, context);
  }

  async gatherContext(_kernels, _config) {
    const msg = this._inputMessage || '';

    let parsed = null;
    if (msg.length > 200 && /resolve to/i.test(msg)) {
      try { parsed = parseRule(msg); } catch (_) {}
    }

    const infoGapMonths = computeInfoGapMonths(parsed);
    return { parsed, infoGapMonths };
  }

  formatForBrain(gathered) {
    const sections = [BETTOR_INSTRUCTIONS];

    if (gathered?.parsed) {
      const p = gathered.parsed;
      sections.push('');
      sections.push('--- HEURISTIC RULE PARSE (use as facts, do not recompute) ---');
      sections.push(`Disqualifier sentences: ${p.disqualifiers.length}`);
      if (p.disqualifiers.length) {
        for (const d of p.disqualifiers) sections.push(`  • ${d}`);
      }
      if (p.embeddedFacts.length) {
        sections.push(`Embedded facts (e.g. clauses): ${p.embeddedFacts.join(' | ')}`);
      }
      sections.push(`Time window: ${p.timeWindow || 'not detected'}`);
      sections.push(`Resolution sources: ${p.resolutionSources.join(', ') || 'not detected'}`);
      sections.push('');
      sections.push(`PRE-COMPUTED infoGapMonths = ${gathered.infoGapMonths.toFixed(2)} (latest fact in rule vs training cutoff ${TRAINING_CUTOFF})`);
      sections.push(`MUST pass this exact value into the ACTION's infoGapMonths field.`);
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: sections.join('\n'),
    };
  }
}
