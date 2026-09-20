// mutations.mjs — oracle 整合批 B 变异验证: 对源码做【一处精确替换】(锚点必须恰命中 1 次), 跑相关测试, 期望至少一个测试红; 每个变异后原样还原并校验 sha256。
// Run(仓库根): node docs/provenance/2026-09-20-j2-oracle-batchB/mutations.mjs [--only=<id-prefix>]   输出末尾 SUMMARY: killed / survived / anchor_errors。
// 🟡 诚实边界: 变异集是我按设计 B1–B7 / C1–C2 边界列的, 不是穷举; 存活变异逐条列在 SUMMARY 里(应为 0)。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KC = path.join(REPO, 'kasia-console');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const T = {
  V: 'src/lib/proto-oracle-verdict.test.mjs', C: 'src/lib/proto-oracle-adapter-core.test.mjs', S: 'src/lib/proto-oracle-spec.test.mjs', P: 'src/lib/proto-oracle-policy.test.mjs',
  I: 'src/lib/proto-bet-intake.test.mjs', B: 'src/lib/proto-settlement-budget.test.mjs', SV: 'src/services/proto-oracle-adapter.test.mjs',
  R1: 'src/api/proto-bet-intake-route.test.mjs', R2: 'src/api/proto-oracle-create-route.test.mjs',
};
const F = { verdict: 'src/lib/proto-oracle-verdict.mjs', core: 'src/lib/proto-oracle-adapter-core.mjs', budget: 'src/lib/proto-settlement-budget.mjs', spec: 'src/lib/proto-oracle-spec.mjs', intake: 'src/lib/proto-bet-intake.mjs', policy: 'src/lib/proto-oracle-policy.mjs', svc: 'src/services/proto-oracle-adapter.mjs', route: 'src/api/proto.js' };

// [id, file, from, to, tests[], 说明(哪条设计边界)]
const M = [
  ['mv1', 'verdict', "const kind = r.extractor_kind_used === 'judgeline-deterministic' ? 'extractor' : 'llm';", "const kind = 'extractor';", ['V', 'C'], 'B1 贴标: llm 类结果被贴成 extractor(进赞成集)'],
  ['mv2', 'verdict', "return { cls: 'transient', kind: null, reason: `derive_failed:", "return { cls: 'substantive_abstain', kind: 'llm', reason: `derive_failed:", ['V', 'C'], 'B2 暂态被当实质(取数失败即写 NULL 冻结)'],
  ['mv3', 'verdict', "if (!pmtOk) { skipped.push({ branch: it.branch, why: 'approval_deferred_pmt_invalid' }); continue; }", '', ['V', 'C'], 'B4 赞成在 pmt 无效时也写(pmt_at=NULL 的赞成行)'],
  ['mv4', 'verdict', "if (it.cls === 'substantive_abstain') { writes.push(", "if (it.cls === 'substantive_abstain') { if (!pmtOk) { skipped.push({ branch: it.branch, why: 'x' }); continue; } writes.push(", ['V', 'C'], 'B4 实质 ABSTAIN 在 pmt 无效时被跳过(fail-open)'],
  ['mv5', 'verdict', 'if (conflict) { writes.push(', 'if (false) { writes.push(', ['V', 'C'], 'B2 冲突不写异议(冻结集漏一方)'],
  ['mv6', 'verdict', "if (polymarketOutcomeSide === 'NO') eff = flip(label);", '', ['V', 'C'], 'B3 UMA 极性不反转'],
  ['mv7', 'verdict', 'if (!((y === 0 && n === 1) || (y === 1 && n === 0))) return null;', 'if (!((y === 0 || y === 1) && (n === 0 || n === 1))) return null;', ['V', 'S', 'C'], 'B3 side_map 接受非双射(yes/no 同值)'],
  ['mv8', 'verdict', "if (typeof windowMs !== 'number' || !Number.isFinite(windowMs)) return", "if (typeof windowMs !== 'number') return", ['V', 'C', 'SV', 'S'], 'SHOULD① UMA 窗 NaN 不被识别'],
  ['mv9', 'verdict', 'if (windowMs < UMA_MIN_FINALIZATION_WINDOW_MS)', 'if (windowMs < 0)', ['V', 'C', 'SV', 'S'], 'B1 UMA 窗 <24h 不被拒'],
  ['mc1', 'core', "if (!allowed.allowed) { skip(`not_allowed_here:${allowed.reason.split('(')[0]}`, m.id); continue; }", '', ['C'], 'B5 站点③(扫描)谓词结果被忽略'],
  ['mc2', 'core', 'const again = judgedMarketAllowedHere({ network, tokenDefId: m.token_def_id, env });', 'const again = { allowed: true };', ['P'], 'B5 站点③(promote 前)谓词调用被删(源码钉)'],
  // mc3(结果未知也扫描)已移除: M2 把该判定下推到候选 SQL 后循环内检查成死代码(round5 存活即证), 等价覆盖由 md3 承担
  ['mc4', 'core', "if (!ent || ent.kind !== 'espn') {", 'if (false) {', ['C'], 'B6(a) adapter 不复核数据源注册表(SSRF 二道闸)'],
  ['mc5', 'core', "const doExtractor = !kinds.has('extractor') && !kinds.has('llm');", "const doExtractor = !kinds.has('extractor');", ['C'], 'B2 LLM 每 tick 重复询问'],
  ['mc6', 'core', 'if (dup.get(m.id, w.source_kind, w.evidence_ref)) continue;', '', ['C'], 'B2/B4 同证据重复写行'],
  ['mc7', 'core', "} else if (decision.action === 'freeze') {", '} else if (false) {', ['C'], '门判冻结时 adapter 不执行冻结'],
  ['mb1', 'budget', '(v.outcome IS NULL OR v.outcome <> ?)', '(v.outcome <> ?)', ['C', 'B'], 'B7 UPDATE 的 NOT EXISTS 漏掉 NULL 弃权异议'],
  ['mb3', 'budget', "const AUTO_KINDS = Object.freeze(['extractor', 'uma']);", "const AUTO_KINDS = Object.freeze(['extractor', 'uma', 'human']);", ['B', 'C'], '批 D 留尾: 赞成集含 human(human 一致即凑够第二源)'],
  ['mb2', 'budget', "if (!Number.isFinite(wallMs)) return { accept: false, code: 'wall_clock_unavailable_fail_closed'", "if (false) return { accept: false, code: 'wall_clock_unavailable_fail_closed'", ['B', 'I'], '批 D 留尾: 非有限 wallMs 不 fail-closed'],
  ['ms1', 'spec', "if (!ent) return reject('data_source_not_whitelisted'", "if (false) return reject('data_source_not_whitelisted'", ['S', 'R2'], 'B6(a) 数据源不查白名单'],
  ['ms2', 'spec', "if (ent.kind !== 'espn') return reject(", 'if (false) return reject(', ['S', 'R2'], 'C2/B6 非 ESPN(无确定性路)的源可建判定题'],
  ['ms3', 'spec', "if (!isPlainObject(spec.resolution_predicate)) return reject('predicate_missing'", "if (false) return reject('predicate_missing'", ['S', 'R2'], 'C2 缺 resolution_predicate 可建'],
  ['ms4', 'spec', 'if (!dry.ok) return reject(', 'if (false) return reject(', ['S'], 'C2 predicate 干跑全 ABSTAIN 仍可建'],
  ['ms5', 'spec', 'const minDeadlineMs = oe + umaWindowMs + budgetCfg.graceMs', 'const minDeadlineMs = oe + budgetCfg.graceMs', ['S', 'R2'], 'B6(c) deadline 预算漏 UMA 定稿窗'],
  ['ms6', 'spec', "if (outcomeConditionId === undefined || outcomeConditionId === null || outcomeConditionId === '') return reject('judged_input_incomplete'", "if (false) return reject('judged_input_incomplete'", ['S', 'R2'], 'C2 缺 UMA 条件可建(无出口)'],
  ['ms7', 'spec', "if (direction !== expected) return { ok: false, code: 'side_label_mismatch'", "if (false) return { ok: false, code: 'side_label_mismatch'", ['S', 'I', 'R2'], 'C1 side_label 与 direction 不一致不拦'],
  ['ms8', 'spec', 'for (const c of JUDGED_COLUMNS) delete out[c];', '', ['S', 'R2'], 'C1 内部判定题列外露 / 旧响应形状变'],
  ['ms9', 'spec', 'export function hasJudgedInput(body) { return !!isPlainObject(body) && JUDGED_BODY_KEYS.some((k) => body[k] !== undefined); }', 'export function hasJudgedInput(body) { return false; }', ['S', 'R2'], '判定题字段被静默当旧流程'],
  ['ms10', 'spec', "if (spec.polymarket_outcome_side !== 'YES' && spec.polymarket_outcome_side !== 'NO') return reject(", 'if (false) return reject(', ['S', 'R2'], 'B3 极性缺失被静默接受'],
  ['ms11', 'spec', 'if (/relay/i.test(k)) return k;', '', ['S'], '请求体 relay 字段不拒'],
  ['mi1', 'intake', "if (!allowed.allowed) return { accept: false, code: 'judged_market_not_allowed_here'", "if (false) return { accept: false, code: 'judged_market_not_allowed_here'", ['I', 'R2'], 'B5 站点②(受理门)谓词被忽略'],
  ['mi2', 'intake', 'if (!sl.ok) return { accept: false, code: sl.code', 'if (!sl.ok && betRequest) return { accept: false, code: sl.code', ['I'], 'C1 未传 betRequest 即绕过 side_label 校验'],
  ['mp1', 'policy', "if (network.trim().toLowerCase() !== 'mainnet') return", "if (network !== 'mainnet') return", ['P'], 'B5 网络名大小写变体绕过主网限制'],
  ['mp2', 'policy', 'return ids.includes(tokenDefId)', 'return true || ids.includes(tokenDefId)', ['P', 'I', 'R2', 'C'], 'B5 主网白名单形同虚设'],
  ['mp3', 'policy', "adapterEnabled: env[ENV_ADAPTER_ENABLED] === '1'", "adapterEnabled: env[ENV_ADAPTER_ENABLED] !== '0'", ['P'], 'B5 开关默认开(策略解析)'],
  ['mp4', 'policy', "if (typeof network !== 'string' || !network.trim()) return { allowed: false", "if (typeof network !== 'string' || !network.trim()) return { allowed: true", ['P', 'C', 'R2'], 'B5 网络未知不 fail-closed'],
  ['msv1', 'svc', "return env[ENV_ADAPTER_ENABLED] === '1' && !!relayId", "return env[ENV_ADAPTER_ENABLED] !== '0' && !!relayId", ['SV'], 'B5 adapter 默认开启'],
  ['msv2', 'svc', "if (!uma.ok) { log.error(`[proto-oracle-adapter] REFUSED to start: ${uma.reason}`); return; }", '', ['SV'], 'SHOULD① UMA 窗不安全仍启动'],
  ['msv3', 'svc', 'if (_inFlight) {', 'if (false) {', ['SV'], '单飞失效(tick 重入)'],
  ['mr1', 'route', "if (!allowed.allowed) return reply.code(403).send({ ok: false, error: 'judged_market_not_allowed_here'", "if (false) return reply.code(403).send({ ok: false, error: 'judged_market_not_allowed_here'", ['R2'], 'B5 站点①(创建入口)谓词被忽略'],
  ['mr2', 'route', 'betRequest: { direction, sideLabel: request.body?.side_label },', "betRequest: { direction, sideLabel: (direction === 1 ? 'yes' : 'no') },", ['R2'], 'C1 路由替客户端合成 side_label(校验被架空)'],
  ['mr3', 'route', '...(judgedCols ? { resolution_rule_spec:', '...(false ? { resolution_rule_spec:', ['R2'], 'B6 判定题列没写进 INSERT'],
  ['md1', 'verdict', 'if (pmtAt < outcomeEndMs) { skipped.push(', 'if (false) { skipped.push(', ['V', 'C'], 'M1 批准票在 pmt<outcome_end 时也写(pmt_at<oe 永久失格 ⇒ 必冻结退款)'],
  ['md2', 'verdict', "if (it.cls === 'substantive_abstain') { writes.push(", "if (it.cls === 'substantive_abstain') { if (!(pmtAt >= outcomeEndMs)) { skipped.push({ branch: it.branch, why: 'x' }); continue; } writes.push(", ['V', 'C'], 'M1 越界: 实质 ABSTAIN 也被 outcome_end 限制(B4 要求任何时候都写)'],
  ['md3', 'core', 'AND m.outcome_end_ms IS NOT NULL AND m.outcome_end_ms <= ?', 'AND m.outcome_end_ms IS NOT NULL AND ? IS NOT NULL', ['C'], 'M2 候选不按到期过滤(远期旧市场占满 LIMIT 饿死可判市场)'],
  ['md4', 'core', 'ORDER BY m.outcome_end_ms ASC, m.created_at ASC LIMIT ?', 'ORDER BY m.created_at ASC LIMIT ?', ['C'], 'M2 候选不按 outcome_end 升序'],
  ['md5', 'core', "permanentFreeze('spec_invalid', m); continue;", "summary.errors++; skip('spec_invalid', m.id); continue;", ['C'], 'M2 spec 坏的市场不冻结(永远占名额)'],
  ['md6', 'core', "permanentFreeze('source_not_registered', m); continue;", "summary.errors++; skip('source_not_registered', m.id); continue;", ['C'], 'M2 数据源未登记的市场不冻结(永远占名额)'],
  ['md7', 'svc', "`); return; }\n  const uma = assertUmaWindowSafe(voter &&", "`); throw e; }\n  const uma = assertUmaWindowSafe(voter &&", ['SV'], 'SHOULD① voter 导入失败抛出(拖垮 console 顶层启动)'],
  ['md8', 'spec', 'if (/^(resolution|outcome)/i.test(k) && !RECOGNIZED_RESOLUTION_OUTCOME_KEYS.includes(k)) return k;', 'if (false) return k;', ['S', 'R2'], 'SHOULD② 未识别的判定题形键被静默丢弃'],
  ['md9', 'route', 'if (strayKey) return reply.code(400)', 'if (false) return reply.code(400)', ['R2'], 'SHOULD② 路由不拒未识别键'],
  ['md10', 'spec', "'outcomeConditionId', 'resolutionNote'])", "'outcomeConditionId'])", ['S', 'R2'], 'SHOULD② 误伤既有 resolutionNote 字段(旧流程被破坏)'],
];

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const run = (rel) => { const r = spawnSync(process.execPath, [rel], { cwd: KC, encoding: 'utf8', timeout: 280_000, env: { ...process.env } }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const summ = (o) => { const m = o.match(/(\d+) passed, (\d+) failed/); return m ? `${m[1]}p/${m[2]}f` : (/ALL PASS/.test(o) ? 'ALL PASS' : (/项失败/.test(o) ? (o.match(/❌ \d+ 项失败/) || ['fail'])[0] : 'no-summary')); };

// 基线: 所有涉及的测试必须先全绿(否则变异结果无意义)
const need = [...new Set(M.filter(([id]) => !only || id.startsWith(only)).flatMap((m) => m[4]))];
console.log(`BASELINE (${need.length} test files)`);
for (const k of need) { const r = run(T[k]); console.log(`  ${r.code === 0 ? 'green' : 'RED  '} ${k} ${T[k]} ${summ(r.out)}`); if (r.code !== 0) { console.log('BASELINE NOT GREEN — abort'); process.exit(3); } }

const results = [];
for (const [id, fk, from, to, tests, why] of M) {
  if (only && !id.startsWith(only)) continue;
  const file = path.join(KC, F[fk]); const orig = fs.readFileSync(file); const s = orig.toString('utf8');
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log(`${id} ANCHOR_ERROR: 命中 ${n} 次(应恰 1): ${from.slice(0, 80)}`); results.push({ id, status: 'anchor_error' }); continue; }
  fs.writeFileSync(file, Buffer.from(s.replace(from, () => to), 'utf8'));
  let killedBy = [], detail = [];
  try {
    for (const k of tests) { const r = run(T[k]); detail.push(`${k}:${r.code === 0 ? 'green' : 'RED'}(${summ(r.out)})`); if (r.code !== 0) killedBy.push(k); }
  } finally { fs.writeFileSync(file, orig); if (sha(fs.readFileSync(file)) !== sha(orig)) { console.log('RESTORE HASH MISMATCH — abort'); process.exit(4); } }
  const status = killedBy.length ? 'killed' : 'SURVIVED';
  console.log(`${id} ${status} [${detail.join(' ')}] — ${why}`); results.push({ id, status, killedBy, why });
}
const k = results.filter((r) => r.status === 'killed').length, sv = results.filter((r) => r.status === 'SURVIVED'), ae = results.filter((r) => r.status === 'anchor_error');
console.log(`\nSUMMARY: total=${results.length} killed=${k} survived=${sv.length} anchor_errors=${ae.length}`);
if (sv.length) console.log('SURVIVED: ' + sv.map((r) => `${r.id}(${r.why})`).join('; '));
if (ae.length) console.log('ANCHOR_ERRORS: ' + ae.map((r) => r.id).join(', '));
process.exit(sv.length || ae.length ? 1 : 0);
