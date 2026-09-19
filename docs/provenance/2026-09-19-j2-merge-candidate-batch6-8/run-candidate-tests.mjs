// run-candidate-tests.mjs — 批 6–8 + C1/C2/C3 合入候选上的测试顺序运行器(J2 2026-09-19)。
// 每个测试文件在它自己惯用的 cwd 下(kasia-console / kasia-relay / 仓库根)以 `node <file>` 直跑(本仓无统一 test 脚本, 各文件自带引导),
// 完整 stdout+stderr 原样存为 <name>.txt(仅把本机 OS 账户名所在的临时目录前缀替换为 %TEMP%, D-021), 并逐文件打印退出码与末行。
// 运行: node docs/provenance/2026-09-19-j2-merge-candidate-batch6-8/run-candidate-tests.mjs
// 不做 npm install / 构建; 单文件超时 15 分钟。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'test-outputs');
fs.mkdirSync(OUT, { recursive: true });

const list = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => ({ cwd: dir.split('/src')[0], file: `${dir.slice(dir.indexOf('src'))}/${f}`.replace(/^\//, '') }));
const items = [
  ...list('kasia-console/src/lib', /^(proto-.*|settle-safe-json|broadcaster-utxo)\.test\.mjs$/),
  ...list('kasia-console/src/services', /^proto-driver\.test\.mjs$/),
  ...list('kasia-relay/src/lib', /\.test\.mjs$/),
  { cwd: 'kasia-relay', file: 'src/drain-finality-safe-blocks.test.mjs' },
  { cwd: 'kasia-relay', file: 'test/getblockatdaa-boundary.test.mjs' },
  { cwd: '.', file: 'scripts/m0a-lint.test.mjs' },
];

// 个别测试要求特定调用方式(各自头注/源码写明), 第一轮运行器没带导致两个"假异常":
//   broadcaster-utxo.test.mjs  —— node:test + mock.module, 必须 `node --experimental-test-module-mocks --test <file>`
//   drain-finality-safe-blocks —— rpc-listener 顶层读 KASPA_NETWORK, 未设即 throw; 用 simnet(只 import 纯函数, 不连接)
const SPECIAL = {
  'broadcaster-utxo.test.mjs': { args: ['--experimental-test-module-mocks', '--test'] },
  'drain-finality-safe-blocks.test.mjs': { env: { KASPA_NETWORK: 'simnet' } },
};
const TMP = ['C:\\Users\\ADMIN\\AppData\\Local\\Temp'];
const redact = (s) => TMP.reduce((acc, t) => acc.split(t).join('%TEMP%'), s);
const summary = [];
for (const it of items) {
  const name = `${it.cwd.replace(/[\\/]/g, '_')}__${path.basename(it.file)}`.replace(/^\._+/, '');
  const t0 = Date.now();
  const sp = SPECIAL[path.basename(it.file)] || {};
  const r = spawnSync(process.execPath, [...(sp.args || []), it.file], { cwd: path.join(ROOT, it.cwd), env: { ...process.env, ...(sp.env || {}) }, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const text = redact(`${r.stdout || ''}${r.stderr ? '\n[stderr]\n' + r.stderr : ''}`);
  fs.writeFileSync(path.join(OUT, `${name}.txt`), text);
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const last = [...lines].reverse().find((l) => /passed|failed|PASS|FAIL|ok|✓|✗|ℹ (pass|fail)/i.test(l)) || lines[lines.length - 1] || '(无输出)';
  const failLines = lines.filter((l) => /^\[FAIL\]|✗ FAIL|^FAIL/.test(l)).length;
  const row = { file: `${it.cwd}/${it.file}`.replace(/^\.\//, ''), exit: r.status, signal: r.signal || null, ms: Date.now() - t0, fail_lines: failLines, last: last.slice(0, 160) };
  summary.push(row);
  console.log(`${row.exit === 0 && failLines === 0 ? 'OK  ' : 'BAD '} exit=${row.exit}${row.signal ? ' signal=' + row.signal : ''} fail_lines=${failLines} ${(row.ms / 1000).toFixed(1)}s  ${row.file}\n       末行: ${row.last}`);
}
fs.writeFileSync(path.join(HERE, 'test-summary.json'), JSON.stringify(summary, null, 2));
const bad = summary.filter((s) => s.exit !== 0 || s.fail_lines > 0);
console.log(`\n共 ${summary.length} 个文件, 异常 ${bad.length} 个${bad.length ? ': ' + bad.map((b) => b.file).join(', ') : ''}`);
process.exit(bad.length ? 1 : 0);
