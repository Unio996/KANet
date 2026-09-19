// rerun-abnormal.mjs — 第一轮运行器(run-candidate-tests.mjs)里 5 个"异常"测试的正确调用方式重跑 + 基线对照(J2 2026-09-19)。
// 第一轮的异常成因(均与候选改动无关): broadcaster-utxo 需 `--experimental-test-module-mocks --test`(其头注写明); drain-finality-safe-blocks 需
// KASPA_NETWORK(rpc-listener 顶层读它, 未设即 throw); tx-mass-ub 的 P-src 自检禁止仓库路径含 `scratch` 段(候选 worktree 恰在 scratch/ 下);
// wallet / serialize-roundtrip 在打印全部通过之后被 Windows libuv 退出断言(async.c:76)带崩(exit 3221226505)——输出里的通过行在崩溃之前。
// 用法: node rerun-abnormal.mjs <仓库根绝对路径> <输出目录绝对路径>   (同一脚本分别对候选与基线各跑一次)
// 只读: 这些测试无文件写入(已核), rpc-listener 顶层不连接, broadcaster-utxo 自设临时 DB_PATH。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const runs = [
  { name: 'console__broadcaster-utxo', cwd: 'kasia-console', args: ['--experimental-test-module-mocks', '--test', 'src/lib/broadcaster-utxo.test.mjs'] },
  { name: 'relay__drain-finality-safe-blocks', cwd: 'kasia-relay', args: ['src/drain-finality-safe-blocks.test.mjs'], env: { KASPA_NETWORK: 'simnet' } },
  { name: 'relay__wallet', cwd: 'kasia-relay', args: ['src/lib/wallet.test.mjs'] },
  { name: 'relay__serialize-roundtrip', cwd: 'kasia-relay', args: ['src/lib/serialize-roundtrip.test.mjs'] },
  { name: 'relay__tx-mass-ub', cwd: 'kasia-relay', args: ['src/lib/tx-mass-ub.test.mjs'] },
  { name: 'relay__utxo-facts', cwd: 'kasia-relay', args: ['src/lib/utxo-facts.test.mjs'] },
];
const redact = (s) => s.split('C:\\Users\\ADMIN\\AppData\\Local\\Temp').join('%TEMP%');
const pick = (lines, res) => res.map((re) => lines.filter((l) => re.test(l)).pop()).filter(Boolean);
console.log(`ROOT=${ROOT}`);
for (const r of runs) {
  const t0 = Date.now();
  const p = spawnSync(process.execPath, r.args, { cwd: path.join(ROOT, r.cwd), env: { ...process.env, ...(r.env || {}) }, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const text = redact(`${p.stdout || ''}${p.stderr ? '\n[stderr]\n' + p.stderr : ''}`);
  fs.writeFileSync(path.join(OUT, `${r.name}.txt`), text);
  const lines = text.split('\n').map((l) => l.trimEnd());
  const key = pick(lines, [/passed, \d+ failed/, /^# (pass|fail) \d+/, /ALL PASS|all .* passed|✅ all/, /\d+ PASS \/ \d+ FAIL/, /^\[FAIL\]/, /Assertion failed/, /Error: /]);
  console.log(`${r.name}: exit=${p.status}${p.signal ? ' signal=' + p.signal : ''} ${((Date.now() - t0) / 1000).toFixed(1)}s\n    关键行: ${key.join(' | ').slice(0, 300) || '(无)'}`);
}
