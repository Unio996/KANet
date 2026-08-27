// run-all · 按 L8→L1→L4→L6→L2→L3→L5→L7 串跑八臂(负测先于正向), 任一非预期 verdict 即停并打印 C4 那三行回滚 SQL(operator 不用翻文档)。
// 🔴 Codex 438e46e9 MUST-FIX(fail-open): 旧版缺参 ⇒ SKIP; continue ⇒ 仍 exit 0。现:
//    ① 必需 CLI 输入在【第一臂跑前】校验, 缺任一 ⇒ exit 2 零执行; ② 无 SKIP; ③ 期望映射严格: --execute ⇒ L1–L8 各恰一次全 PASS;
//    dry-run ⇒ 只读臂 L8/L1/L6/L7 = PASS, 写臂 L4/L2/L3/L5 = DRY, 无其它; ④ 任何 parse 失败 / 缺臂 / 非预期 verdict ⇒ exit 1。
//    修前的 runner 输出不得当 GREEN-at-live 证据。
// 🔴 --execute 只是透传给写臂; 打印"须 Owner D-005 GO"。无 --execute = 全 dry-run(只读臂照跑, 写臂只打印计划)。
// 用法: node scripts/u1-live-arms/run-all.mjs --submission <B.json> --submission-mainnet <B-mainnet.json> --submission-x <X→C.json> --submission-c <C.json> --relay <relay_id for L7> [--execute] [--db] [--console-url] [--out-dir]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const EXECUTE = argv.includes('--execute');
const passthrough = ['--db', '--console-url', '--out-dir'].flatMap((k) => (arg(k) ? [k, arg(k)] : []));
const ex = EXECUTE ? ['--execute'] : [];

// ① 必需输入前置校验(第一臂跑前): 五个都要, 文件须存在(--relay 是 id 串)
const REQUIRED = ['--submission', '--submission-mainnet', '--submission-x', '--submission-c', '--relay'];
const missing = REQUIRED.filter((k) => !arg(k) || arg(k).startsWith('--'));
const absent = REQUIRED.filter((k) => k !== '--relay' && arg(k) && !arg(k).startsWith('--') && !existsSync(arg(k)));
if (missing.length || absent.length) {
  console.error(`🔴 run-all 拒跑(零执行): 缺参数 ${JSON.stringify(missing)} / 文件不存在 ${JSON.stringify(absent.map((k) => `${k}=${arg(k)}`))}。八臂须齐, 不允许 SKIP(Codex 438e46e9)。`);
  console.log(JSON.stringify({ arm: 'run-all', verdict: 'FAIL', reason: 'MISSING_INPUT', missing, absent, results: [] }));
  process.exit(2);
}

const SEQ = [
  ['L8', []], ['L1', []],
  ['L4', ['--submission', arg('--submission'), ...ex]],
  ['L6', ['--submission', arg('--submission-mainnet')]],
  ['L2', ['--submission', arg('--submission'), ...ex]],
  ['L3', ['--submission', arg('--submission'), ...ex]],
  ['L5', ['--submission-x', arg('--submission-x'), '--submission-c', arg('--submission-c'), ...ex]],
  ['L7', ['--relay', arg('--relay')]],
];
// ③ 严格期望映射
const EXPECT = EXECUTE
  ? { L8: 'PASS', L1: 'PASS', L4: 'PASS', L6: 'PASS', L2: 'PASS', L3: 'PASS', L5: 'PASS', L7: 'PASS' }
  : { L8: 'PASS', L1: 'PASS', L4: 'DRY', L6: 'PASS', L2: 'DRY', L3: 'DRY', L5: 'DRY', L7: 'PASS' };

console.error(EXECUTE
  ? '🔴 run-all --execute: 写臂将真 POST 到 live console —— 须 Owner D-005 GO(v197/v198 迁移 + console 重启)之后由 operator 跑。本脚本不授权部署。'
  : '🔵 run-all dry-run: 只读臂照跑, 写臂只打印计划, 零 POST 零写入。');
const results = [];
let stoppedAt = null;
for (const [arm, args] of SEQ) {
  const r = spawnSync(process.execPath, [join(HERE, `${arm}.mjs`), ...args, ...passthrough], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let o = null; try { o = JSON.parse(last); if (o?.arm !== arm) throw new Error('arm mismatch'); } catch { o = { arm, verdict: 'PARSE_FAIL', evidence: { raw_stdout: (r.stdout || '').slice(-400), stderr: (r.stderr || '').slice(-400), status: r.status } }; }
  const expected = EXPECT[arm];
  const ok = o.verdict === expected;
  results.push({ arm, verdict: o.verdict, expected, ok, sha256: o.sha256 || null });
  console.error(`${ok ? (o.verdict === 'DRY' ? '🔵' : '✅') : '🔴'} ${arm} ${o.verdict}${ok ? '' : ` (期望 ${expected})`}${o.sha256 ? ' sha256=' + o.sha256.slice(0, 12) : ''}`);
  if (!ok) { stoppedAt = arm; break; }
}
// ④ 通过判据: 八臂各恰一次、全部 ok
const seen = results.map((r) => r.arm);
const allOk = results.length === SEQ.length && SEQ.every(([a]) => seen.filter((x) => x === a).length === 1) && results.every((r) => r.ok);
if (!allOk) {
  console.error(`\n🔴 run-all 停在 ${stoppedAt ?? '(缺臂)'} ⇒ 不是 GREEN-at-live 证据。若 L2/L5 已写入, 三方复核【之后】由 operator 执行回滚(runbook §6):`);
  try {
    const sub = JSON.parse(readFileSync(arg('--submission'), 'utf8'));
    const k = await import('kaspa-wasm');
    process.env.DB_PATH = arg('--db', 'D:/kanet-tn12/kasia-console/data/console.db');
    const { sqlite } = await import('../../src/db/client.js');
    const addr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(sub.relayId)?.address;
    const addrKey = addr ? k.XOnlyPublicKey.fromAddress(new k.Address(addr)).toString() : '<fromAddress(relay.address)>';
    for (const line of [
      `  DELETE FROM u1_identity_registration WHERE relay_id = '${sub.relayId}';`,
      `  DELETE FROM u1_relay_identity        WHERE relay_pubkey_xonly = '${addrKey}';`,
      `  DELETE FROM u1_identity_challenge   WHERE challenge = '${sub.challenge}';`,
    ]) console.error(line);
  } catch (e) { console.error(`  (回滚 SQL 生成失败: ${e?.message || e}; 见 runbook §6 三行)`); }
}
console.log(JSON.stringify({ arm: 'run-all', verdict: allOk ? 'PASS' : 'FAIL', execute: EXECUTE, utc: new Date().toISOString(), stopped_at: stoppedAt, results }));
process.exit(allOk ? 0 : 1);
