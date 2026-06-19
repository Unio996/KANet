// gateE-wire-test.mjs — J2-tn wave1 wire 集成测 (Owner 核心 wire 接通验证)。
// 验 deriveKanetNativeVote 检测 resolution_predicate → 路由到 judgeLine (非 LLM)。
// 真 ESPN 赛 + spec with resolution_predicate → 期望 extractor_kind_used='judgeline-deterministic'。
import { deriveKanetNativeVote } from '../src/services/bettor-prediction-voter.js';
import { normalizeAbbr } from '../src/lib/oracle-evidence-extractors.mjs';

const sb = await (await fetch('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20250615')).json();
const ev = (sb.events || []).find(e => e.competitions?.[0]?.status?.type?.completed && e.competitions[0].competitors.find(c => c.winner));
if (!ev) { console.log('no completed game found'); process.exit(1); }
const comp = ev.competitions[0];
const winnerAbbr = normalizeAbbr(comp.competitors.find(c => c.winner).team.abbreviation);
const loserAbbr = normalizeAbbr(comp.competitors.find(c => !c.winner).team.abbreviation);
const hs = Number(comp.competitors.find(c => c.homeAway === 'home').score);
const as = Number(comp.competitors.find(c => c.homeAway === 'away').score);
const margin = Math.abs(hs - as), total = hs + as;
const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${ev.id}`;
console.log(`测试赛: ${winnerAbbr} won ${hs}-${as} (margin ${margin}/total ${total})\n`);

let pass = 0, n = 0;
async function t(name, predicate, expect) {
  n++;
  const spec = { title: 'test', resolution_criteria: 'test', data_source_canonical: url, resolution_predicate: predicate };
  const r = await deriveKanetNativeVote({ id: 'wire-test', outcome_oracle_relay_id: null }, spec);
  const routed = r.extractor_kind_used === 'judgeline-deterministic';
  const ok = routed && r.outcome === expect;
  console.log(`${ok ? '✅' : '❌'} ${name}: outcome=${r.outcome} kind=${r.extractor_kind_used} (expect ${expect}/judgeline-deterministic)`);
  if (ok) pass++;
}

await t('moneyline winner', { metric: 'winner', op: '==', operand: winnerAbbr }, 'YES');
await t('moneyline loser', { metric: 'winner', op: '==', operand: loserAbbr }, 'NO');
await t('spread margin>=M', { metric: 'margin', op: '>=', operand: margin, subject: winnerAbbr }, 'YES');
await t('spread margin>=M+1', { metric: 'margin', op: '>=', operand: margin + 1, subject: winnerAbbr }, 'NO');
await t('total>=T', { metric: 'total', op: '>=', operand: total }, 'YES');
await t('total>=T+1', { metric: 'total', op: '>=', operand: total + 1 }, 'NO');

console.log(`\n${pass}/${n} wire 路由 PASS (deriveKanetNativeVote 有 predicate → judgeLine, 非 LLM)`);
process.exit(pass === n ? 0 : 1);
