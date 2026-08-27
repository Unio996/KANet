// run-all · 按 L8→L1→L4→L6→L2→L3→L5→L7 串跑八臂(负测先于正向), 任一 FAIL 即停并打印 C4 那三行回滚 SQL(operator 不用翻文档)。
// 🔴 --execute 只是透传给写臂; 打印"须 Owner D-005 GO"。无 --execute = 全 dry-run(只读臂照跑, 写臂只打印计划)。
// 用法: node scripts/u1-live-arms/run-all.mjs --submission <B.json> --submission-mainnet <B-mainnet.json> --submission-x <X→C.json> --submission-c <C.json> --relay <relay_id for L7> [--execute] [--db] [--console-url] [--out-dir]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const EXECUTE = argv.includes('--execute');
const passthrough = ['--db', '--console-url', '--out-dir'].flatMap((k) => (arg(k) ? [k, arg(k)] : []));
const ex = EXECUTE ? ['--execute'] : [];
const SEQ = [
  ['L8', []], ['L1', []],
  ['L4', ['--submission', arg('--submission'), ...ex]],
  ['L6', ['--submission', arg('--submission-mainnet')]],
  ['L2', ['--submission', arg('--submission'), ...ex]],
  ['L3', ['--submission', arg('--submission'), ...ex]],
  ['L5', ['--submission-x', arg('--submission-x'), '--submission-c', arg('--submission-c'), ...ex]],
  ['L7', ['--relay', arg('--relay')]],
];
console.error(EXECUTE
  ? '🔴 run-all --execute: 写臂将真 POST 到 live console —— 须 Owner D-005 GO(v197/v198 迁移 + console 重启)之后由 operator 跑。本脚本不授权部署。'
  : '🔵 run-all dry-run: 只读臂照跑, 写臂只打印计划, 零 POST 零写入。');
const results = [];
for (const [arm, args] of SEQ) {
  if (args.some((a) => a === undefined)) { console.error(`⚠ ${arm} 缺参数, 跳过(SKIP)`); results.push({ arm, verdict: 'SKIP' }); continue; }
  const r = spawnSync(process.execPath, [join(HERE, `${arm}.mjs`), ...args, ...passthrough], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
  let o = null; try { o = JSON.parse(last); } catch { o = { arm, verdict: 'FAIL', evidence: { raw_stdout: (r.stdout || '').slice(-400), stderr: (r.stderr || '').slice(-400) } }; }
  results.push(o);
  console.error(`${o.verdict === 'PASS' ? '✅' : o.verdict === 'DRY' ? '🔵' : '🔴'} ${arm} ${o.verdict}${o.sha256 ? ' sha256=' + o.sha256.slice(0, 12) : ''}`);
  if (o.verdict === 'FAIL') {
    console.error(`\n🔴 ${arm} FAIL ⇒ 停。若 L2/L5 已写入, 三方复核【之后】由 operator 执行回滚(runbook §6):`);
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
    break;
  }
}
console.log(JSON.stringify({ arm: 'run-all', execute: EXECUTE, utc: new Date().toISOString(), results: results.map((r) => ({ arm: r.arm, verdict: r.verdict, sha256: r.sha256 || null })) }));
process.exit(results.some((r) => r.verdict === 'FAIL') ? 1 : 0);
