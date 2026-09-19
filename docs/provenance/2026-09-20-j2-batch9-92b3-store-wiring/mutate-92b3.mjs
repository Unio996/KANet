// 批9 9-2b(iii-1) store + 接线 + 出口闸报警去重——变异对照(单文件测试逐个跑)。用法(仓库根): node docs/provenance/2026-09-20-j2-batch9-92b3-store-wiring/mutate-92b3.mjs > mutation-raw.txt
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = 'kasia-console/src/lib/proto-settlement-driver-core.mjs', STORE = 'kasia-console/src/lib/proto-settlement-store.mjs', WIRE = 'kasia-console/src/services/proto-settlement-driver.mjs', IDX = 'kasia-console/src/index.js';
const T = { core: 'src/lib/proto-settlement-driver-core.test.mjs', store: 'src/lib/proto-settlement-store.test.mjs', wire: 'src/services/proto-settlement-driver.test.mjs' };
const run = (k) => { const r = spawnSync(process.execPath, [T[k]], { cwd: path.join(ROOT, 'kasia-console'), encoding: 'utf8', timeout: 280000, maxBuffer: 1 << 26 }); return { status: r.status, last: ((r.stdout || '') + (r.stderr || '')).match(/\d+ passed, \d+ failed/)?.[0] || '?' }; };
const sub = (a, b) => (s) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`锚点命中 ${n}: ${a.slice(0, 50)}`); return s.replace(a, () => b); };
const M = [];
const mut = (id, file, f, tests, why) => M.push([id, file, f, tests, why]);
mut('G1', CORE, sub('if (gateAlerted.has(gk)) return', 'if (false) return'), ['core'], '出口闸拒绝报警不去重(每 tick 刷 events)');
mut('G2', CORE, sub('for (const gk of [...gateAlerted]) if (gk.startsWith(`${key}:`)) gateAlerted.delete(gk);', ''), ['core'], '成功不清出口闸报警去重');
mut('S1', STORE, sub("AND NOT EXISTS (SELECT 1 FROM proto_bets b WHERE b.market_id = m.id AND b.status = 'pending')", ''), ['store'], 'seal 触发不排除 pending 下注');
mut('S2', STORE, sub("AND i.step = 'append' AND i.status IN ('pending', 'prepared', 'submitted', 'ambiguous'))", "AND i.step = 'append' AND i.status IN ('ambiguous'))"), ['store'], 'seal 触发只挡 ambiguous append(在途 append 不挡)');
mut('S3', STORE, sub("WHERE b.market_id = m.id AND b.status = 'confirmed') = m.seal_count", "WHERE b.market_id = m.id AND b.status = 'confirmed') >= m.seal_count"), ['store'], '确认数 ≥ seal_count 就触发');
mut('S4', STORE, sub("UPDATE proto_markets SET status = 'sealed', updated_at = ? WHERE id = ? AND status = 'betting'", "UPDATE proto_markets SET status = 'sealed', updated_at = ? WHERE id = ?"), ['store'], 'seal landed 记账不带前态谓词');
mut('S5', STORE, sub('WHERE id = ? AND claim_txid IS NULL', 'WHERE id = ?'), ['store'], 'claim_draw 记账可覆盖已领取');
mut('S6', STORE, sub('.run(intent.submitted_txid, claimDrawClaimOutIndex,', '.run(intent.submitted_txid, 1,'), ['store'], 'claim_vout 写死 1');
mut('S7', STORE, sub("return landed('market', m.id, 'resolve') ? { ok: true } : { ok: false, reason: 'resolve_not_landed' };", 'return { ok: true };'), ['store'], 'convert_to_claim 不检查 market 的 resolve landed(跨 subject_type)');
mut('S8', STORE, sub('    for (const r of preparedRows) {\n      const step', '    for (const r of []) {\n      const step'), ['store'], 'prepared 行不进 advances(重启恢复失效)');
mut('S9', STORE, sub('const deduped = advances.filter((a) => { const k = `${a.step}:${a.subjectId}`; if (seen.has(k)) return false; seen.add(k); return true; });', 'const deduped = advances;'), ['store'], 'advances 不去重');
mut('S10', STORE, sub("export function newClaimId() { return randomBytes(32).toString('hex'); }", "export function newClaimId() { return randomBytes(16).toString('hex'); }"), ['store'], 'claim id 只有 32 位 hex(过不了出口 S9)');
mut('S11', STORE, sub("WHERE status = 'submitted' AND ${BATCH9_INTENT_PREDICATE}", "WHERE status IN ('submitted', 'prepared') AND ${BATCH9_INTENT_PREDICATE}"), ['store'], 'landedChecks 混入 prepared');
mut('S12', STORE, sub("(subject_type = 'claim' AND step IN ('convert_to_claim', 'claim_draw'))", "(subject_type = 'claim' AND step IN ('convert_to_claim', 'claim_draw', 'withdraw'))"), ['store'], '批 9 意图谓词放进 withdraw');
mut('W1', WIRE, sub("&& !!relayId;", "&& !!relayId && env.PROTO_DRIVER_ENABLED === '1';"), ['wire'], '结算开关还要求旧开关');
mut('W2', WIRE, sub("env.PROTO_SETTLEMENT_DRIVER_ENABLED === '1' && !!relayId;", "env.PROTO_SETTLEMENT_DRIVER_ENABLED === '1';"), ['wire'], '不要求 relay 已配置');
mut('W3', WIRE, sub('if (_inFlight) { _skippedOverlap++;', 'if (false) { _skippedOverlap++;'), ['wire'], '单飞失效');
mut('W4', WIRE, sub('  } finally { _inFlight = false; }', '  } finally { }'), ['wire'], '异常后单飞标志不复位');
mut('W5', WIRE, sub('if (got !== want) throw', 'if (!String(relayAddress).startsWith(want)) throw'), ['wire'], '前缀用 startsWith(kaspasim 会被当成 kaspa)');
mut('W6', WIRE, sub("if (r && r.reason === 'network_mismatch') stopProtoSettlementDriver();", ''), ['wire'], '网络不符不自停');
mut('W7', WIRE, sub("stopProtoSettlementDriver(); return { skipped: true, reason: 'ops_unavailable' };", "return { skipped: true, reason: 'ops_unavailable' };"), ['wire'], 'ops 不可用不自停');
mut('W8', WIRE, sub('Math.max(MIN_STEP_BUDGET_MS, Math.floor(intervalMs / 2))', 'Math.max(MIN_STEP_BUDGET_MS, intervalMs)'), ['wire'], '每步预算不是间隔的一半');
mut('W9', WIRE, sub('network = configuredNetwork(env);', "network = env.KASPA_NETWORK || 'mainnet';"), ['wire'], 'network 未设时回落 mainnet 默认');
mut('W10', WIRE, sub('started (tick ${intervalMs}ms, cap ${cap}/tick, network=${network})', 'started (tick ${intervalMs}ms, cap ${cap}/tick)'), ['wire'], '启动日志不带 network');
mut('W11', IDX, sub('startProtoSettlementDriver();', ''), ['wire'], 'index.js 没有接线调用');
mut('W12', WIRE, sub("log.log('[proto-settlement-driver] disabled')", "log.log('[proto-settlement-driver] off')"), ['wire'], '关闭态日志文案变了');
console.log('BASELINE'); for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) { console.log('BASELINE 不绿, 中止'); process.exit(2); } }
let surv = 0;
for (const [id, file, f, tests, why] of M) {
  const abs = path.join(ROOT, file); const orig = fs.readFileSync(abs, 'utf8'); let m;
  try { m = f(orig); } catch (e) { console.log(`${id}: 变换失败(${e.message}) :: ${why}`); surv++; continue; }
  try { fs.writeFileSync(abs, m); const res = tests.map((k) => ({ k, ...run(k) })); const red = res.some((r) => r.status !== 0); if (!red) surv++; console.log(`${id}: ${red ? 'KILLED' : 'SURVIVED'} [${res.map((r) => `${r.k}:exit=${r.status}`).join(' ')}] :: ${why}`); }
  finally { fs.writeFileSync(abs, orig); if (fs.readFileSync(abs, 'utf8') !== orig) throw new Error('还原失败 ' + file); }
}
console.log('RESTORED'); let ok = true; for (const k of Object.keys(T)) { const r = run(k); console.log(`  ${k}: exit=${r.status} ${r.last}`); if (r.status !== 0) ok = false; }
console.log(`SUMMARY mutants=${M.length} survivors=${surv} restored_green=${ok}`); process.exitCode = surv || !ok ? 1 : 0;
