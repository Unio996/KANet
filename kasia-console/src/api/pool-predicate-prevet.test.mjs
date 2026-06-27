// SEAM fix 回归 (NWT FINDING-1·J2 第1层 create-time chokepoint, 2026-06-27).
// 跑: node kasia-console/src/api/pool-predicate-prevet.test.mjs
// 守: create/v06/v07 建市前 assertSpecPredicateValid 拦截 caller 提交的脏 resolution_predicate
//     (整数线/畸形=un-settleable stranded), 单源走 judgeline validateResolutionPredicate, 不另实现。
import { assertSpecPredicateValid } from '../lib/spec-validation.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.error(`✘ ${n}`); } };

const spec = (predicate) => JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'https://site.api.espn.com/x/summary?event=1', resolution_predicate: predicate });

// ── 整数线必拒 (核心 SEAM: raw caller 绕 buildSportsCard) ──
ok(!assertSpecPredicateValid(spec({ metric: 'margin', op: '>', operand: 20, scale: 1, subject: 'BRA' })).valid, '整数线 margin 2.0 拒');
ok(!assertSpecPredicateValid(spec({ metric: 'total', op: '>', operand: 3, scale: 0 })).valid, '整数线 total 3 拒');
ok(!assertSpecPredicateValid(spec({ metric: 'total', op: '>', operand: 200, scale: 1 })).valid, '整数线 total 20.0 拒');

// ── 半线放行 ──
ok(assertSpecPredicateValid(spec({ metric: 'margin', op: '>', operand: 5, scale: 1, subject: 'BRA' })).valid, '半线 margin 0.5 放行');
ok(assertSpecPredicateValid(spec({ metric: 'total', op: '>', operand: 25, scale: 1 })).valid, '半线 total 2.5 放行');
ok(assertSpecPredicateValid(spec({ metric: 'winner', op: '==', operand: 'BRA' })).valid, 'winner 放行 (无线)');

// ── 畸形 predicate 拒 ──
ok(!assertSpecPredicateValid(spec({ metric: 'foo', op: '==', operand: 1 })).valid, '未知 metric 拒');
ok(!assertSpecPredicateValid(spec({ metric: 'margin', op: '~', operand: 5, scale: 1, subject: 'BRA' })).valid, '非法 op 拒');
ok(!assertSpecPredicateValid(spec({ metric: 'margin', op: '>', operand: 5, scale: 1 })).valid, 'margin 缺 subject 拒');

// ── 无 predicate = LLM 判路, 放行 (additive 不破非结构化市场) ──
ok(assertSpecPredicateValid(JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'x' })).valid, '无 predicate 放行 (LLM 路)');
ok(assertSpecPredicateValid('not json at all').valid, '非 JSON 放行 (isStructuredSpec 另兜)');

console.log(`\npool-predicate-prevet.test: ${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
