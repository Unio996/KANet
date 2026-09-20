// oracle 批 A(v212)触发器——变异对照。用法(仓库根): node docs/provenance/2026-09-20-j2-oracle-batchA-db-defense/mutate-triggers.mjs > mutation-raw.txt
// 每个变异 = 在迁移后的临时库里就地 DROP / 改写某触发器(测试文件的 MUT_* 钩子), 再跑全套; 全套必须变红(exit≠0)。SURVIVED = 测试缺口; ERROR = 片段没命中(脚本错)。
import { spawnSync } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TEST = 'src/db/proto-winning-side-triggers-v212.test.mjs';
const run = (env = {}) => { const r = spawnSync(process.execPath, [TEST], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26, env: { ...process.env, ...env } }); const out = (r.stdout || '') + (r.stderr || ''); return { status: r.status, last: out.match(/\d+ passed, \d+ failed/)?.[0] || '?', err: /MUTATION ERROR/.test(out) ? out.match(/MUTATION ERROR[^\n]*/)[0] : null }; };
const DROP = '__DROP__';
const TR = ['trg_pmv_append_only_update', 'trg_pmv_append_only_delete', 'trg_pm_ws_r1_insert_existing_id', 'trg_pm_ws_r1_insert_null', 'trg_pm_ws_r1_write_once', 'trg_pm_ws_r1_value_domain', 'trg_pm_ws_r1_status_sealed', 'trg_pm_ws_r1_source_required', 'trg_pm_ws_r1_set_at_required', 'trg_pm_ws_r1_operator_no_judged', 'trg_pm_ws_r1_operator_no_verdict', 'trg_pm_ws_r1_verdict_ref', 'trg_pm_ws_r1_audit_needs_value', 'trg_pm_ws_r1_audit_immutable', 'trg_pm_ws_r1_delete_guard', 'trg_pm_r4_question_immutable'];
const M = TR.map((n, i) => [`D${i + 1}`, n, null, DROP, `删掉整个触发器 ${n}`]);
const F = (id, trig, from, to, why) => M.push([id, trig, from, to, why]);
F('F1', 'trg_pm_ws_r1_insert_existing_id', 'id = NEW.id)', 'id = NEW.id AND winning_side IS NULL)', '只拦"已存在且无值"的重插(REPLACE 一个已有判定的市场可绕过)');
for (const [k, c] of [['a', 'NEW.winning_side IS NOT NULL OR '], ['b', 'NEW.winning_side_source IS NOT NULL OR '], ['c', 'NEW.winning_side_set_at IS NOT NULL OR '], ['d', ' OR NEW.winning_side_verdict_id IS NOT NULL']]) F(`F2${k}`, 'trg_pm_ws_r1_insert_null', c, '', `INSERT 检查少一列: ${c.trim()}`);
F('F3', 'trg_pm_ws_r1_write_once', 'OLD.winning_side IS NOT NULL', 'OLD.winning_side IS NOT NULL AND NEW.winning_side IS NOT OLD.winning_side', '允许同值重写');
F('F4', 'trg_pm_ws_r1_value_domain', 'NOT IN (0,1)', 'NOT IN (0,1,2)', '值域放宽到 {0,1,2}');
F('F5a', 'trg_pm_ws_r1_status_sealed', "OLD.status <> 'sealed' OR ", '', '只查 NEW.status(betting→sealed 一并写值可绕过)');
F('F5b', 'trg_pm_ws_r1_status_sealed', " OR NEW.status <> 'sealed'", '', '只查 OLD.status(sealed→resolved 一并写值可绕过)');
F('F6', 'trg_pm_ws_r1_source_required', 'NEW.winning_side_source IS NULL OR ', '', 'source 为 NULL 不再拒');
F('F7a', 'trg_pm_ws_r1_set_at_required', 'NEW.winning_side_set_at IS NULL OR ', '', 'set_at 为 NULL 不再拒');
F('F7b', 'trg_pm_ws_r1_set_at_required', ' OR length(trim(NEW.winning_side_set_at)) = 0', '', 'set_at 空白不再拒');
for (const [k, c] of [['a', 'NEW.resolution_rule_spec IS NOT NULL OR '], ['b', 'NEW.outcome_market_source IS NOT NULL OR '], ['c', 'NEW.outcome_condition_id IS NOT NULL OR '], ['d', ' OR NEW.outcome_oracle_relay_ids IS NOT NULL']]) F(`F8${k}`, 'trg_pm_ws_r1_operator_no_judged', c, '', `"有判定题"判据少一列: ${c.trim()}`);
F('F8e', 'trg_pm_ws_r1_operator_no_judged', "NEW.winning_side_source = 'operator'", "NEW.winning_side_source = 'human'", 'operator 禁写守卫挂在错误的 source 上');
F('F9', 'trg_pm_ws_r1_operator_no_verdict', 'NEW.winning_side_verdict_id IS NOT NULL', 'NEW.winning_side_verdict_id IS NOT NULL AND 0', 'operator 可携带 verdict 引用');
F('F10a', 'trg_pm_ws_r1_verdict_ref', 'v.market_id = NEW.id AND ', '', 'verdict 不必属于同一市场');
F('F10b', 'trg_pm_ws_r1_verdict_ref', 'v.outcome = NEW.winning_side AND ', '', 'verdict 的 outcome 不必等于写入值');
F('F10c', 'trg_pm_ws_r1_verdict_ref', ' AND v.source_kind = NEW.winning_side_source', '', 'verdict 的 source_kind 不必与 source 一致(llm 判定可提升)');
F('F10d', 'trg_pm_ws_r1_verdict_ref', "IN ('extractor','uma','human')", "IN ('extractor','uma')", 'human 来源免 verdict 引用');
F('F10e', 'trg_pm_ws_r1_verdict_ref', "IN ('extractor','uma','human')", "IN ('extractor','human')", 'uma 来源免 verdict 引用');
F('F10f', 'trg_pm_ws_r1_verdict_ref', "IN ('extractor','uma','human')", "IN ('uma','human')", 'extractor 来源免 verdict 引用');
for (const [k, c] of [['a', 'NEW.winning_side_source IS NOT NULL OR '], ['b', 'NEW.winning_side_set_at IS NOT NULL OR '], ['c', ' OR NEW.winning_side_verdict_id IS NOT NULL']]) F(`F11${k}`, 'trg_pm_ws_r1_audit_needs_value', c, '', `无值时审计列检查少一列: ${c.trim()}`);
for (const [k, c] of [['a', 'NEW.winning_side_source IS NOT OLD.winning_side_source OR '], ['b', 'NEW.winning_side_set_at IS NOT OLD.winning_side_set_at OR '], ['c', ' OR NEW.winning_side_verdict_id IS NOT OLD.winning_side_verdict_id']]) F(`F12${k}`, 'trg_pm_ws_r1_audit_immutable', c, '', `审计列不可改检查少一列: ${c.trim()}`);
for (const [k, c] of [['a', 'OLD.winning_side IS NOT NULL OR '], ['b', 'OLD.shardleaf_txid IS NOT NULL OR '], ['c', 'OLD.genesis_submitted_txid IS NOT NULL OR '], ['d', 'EXISTS (SELECT 1 FROM proto_bets WHERE market_id = OLD.id) OR '], ['e', 'EXISTS (SELECT 1 FROM proto_claims WHERE market_id = OLD.id) OR '],
  ['f', "EXISTS (SELECT 1 FROM proto_settlement_intents WHERE subject_type = 'market' AND subject_id = OLD.id) OR "], ['g', 'EXISTS (SELECT 1 FROM proto_market_verdicts WHERE market_id = OLD.id) OR '], ['h', " OR EXISTS (SELECT 1 FROM submit_intents WHERE intent_key = 'genesis:' || OLD.id)"]]) F(`F13${k}`, 'trg_pm_ws_r1_delete_guard', c, '', `DELETE 守卫少一条: ${c.trim().slice(0, 60)}`);
for (const [k, c] of [['a', 'NEW.question IS NOT OLD.question OR '], ['b', 'NEW.outcome_oracle_relay_ids IS NOT OLD.outcome_oracle_relay_ids OR '], ['c', 'NEW.resolution_rule_spec IS NOT OLD.resolution_rule_spec OR '], ['d', 'NEW.outcome_market_source IS NOT OLD.outcome_market_source OR '], ['e', 'NEW.outcome_condition_id IS NOT OLD.outcome_condition_id OR '], ['f', ' OR NEW.outcome_end_ms IS NOT OLD.outcome_end_ms']]) F(`F14${k}`, 'trg_pm_r4_question_immutable', c, '', `题面不可改少一列: ${c.trim().slice(0, 50)}`);
F('F15a', 'trg_pm_r4_question_immutable', "OLD.status NOT IN ('genesis_pending','genesis_prepared') OR ", '', '锁因少一条: status 出了 pending/prepared');
F('F15b', 'trg_pm_r4_question_immutable', 'OLD.genesis_submitted_txid IS NOT NULL OR ', '', '锁因少一条: genesis_submitted_txid');
F('F15c', 'trg_pm_r4_question_immutable', 'OLD.shardleaf_txid IS NOT NULL OR ', '', '锁因少一条: shardleaf_txid');
F('F15d', 'trg_pm_r4_question_immutable', ' OR EXISTS (SELECT 1 FROM proto_bets WHERE market_id = OLD.id)', '', '锁因少一条: 已有下注');
F('F15e', 'trg_pm_r4_question_immutable', "'genesis_pending','genesis_prepared'", "'genesis_pending','genesis_prepared','genesis_submitted'", '锁得太晚: genesis 已广播(submitted)仍可改题面');

console.log('BASELINE'); const b = run(); console.log(`  exit=${b.status} ${b.last}`); if (b.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); }
let surv = 0, err = 0, killed = 0;
for (const [id, trig, from, to, why] of M) {
  const r = run({ MUT_TRIGGER: trig, MUT_FROM: from ?? '', MUT_TO: to });
  if (r.err) { err++; console.log(`${id}: ERROR ${r.err} :: ${why}`); continue; }
  if (r.status === 0) { surv++; console.log(`${id}: SURVIVED exit=0 ${r.last} :: ${why}`); } else { killed++; console.log(`${id}: KILLED exit=${r.status} ${r.last} :: ${why}`); }
}
console.log(`SUMMARY mutants=${M.length} killed=${killed} survivors=${surv} errors=${err}`); process.exitCode = surv || err ? 1 : 0;
