// M0a 差分门负向测试(设计 v0.2 §9, 13 条 DoD 缺一不收)。跑: node scripts/m0a-lint.test.mjs
// 夹具字符串全部运行时拼接, 防测试源码自身被真仓 git grep 扫成 occurrence(自指污染)。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  snapshotEntries, runAllM0aChecks, diffAgainstBaseline, baselineEditGuard,
  manifestChecks, shadowModuleCheck, BASELINE_PATH, MANIFEST_PATH,
} from './m0a-lib.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 夹具行(拼接, 见文件头注) ──
const SQLITE = 'better-' + 'sqlite3';
const RELAY = 'relay-' + 'manager.js';
const Q = String.fromCharCode(39); // single quote
const sqliteImport = 'import Database from ' + Q + SQLITE + Q + ';';
const sqliteRequire = 'const Database = require(' + Q + SQLITE + Q + ');';
const relayDynamic = 'const { sendCommandAsync } = await import(' + Q + '../lib/' + RELAY + Q + ');';
const newDbReadonly = 'const db = new Database(' + Q + 'x.db' + Q + ', { readonly: true });';
const newDbPlain = 'const db = new Database(' + Q + 'x.db' + Q + ');';
const newDbComputed = 'const db = new Database(dbPath, opts);';

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
};

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function freshRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm0a-test-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@test']);
  git(dir, ['config', 'user.name', 'm0a-test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  for (const [rel, content] of Object.entries(files)) writeFile(dir, rel, content);
  git(dir, ['add', '-A']);
  // baseline 从 index 快照生成(与生成器同源函数)
  const entries = snapshotEntries(dir);
  writeFile(dir, BASELINE_PATH, JSON.stringify({ generated_at_head: 'fixture', entries }, null, 1));
  writeFile(dir, MANIFEST_PATH, JSON.stringify({ entries: [] }, null, 1));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture baseline']);
  return dir;
}
function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function loadBaseline(root) { return JSON.parse(fs.readFileSync(path.join(root, BASELINE_PATH), 'utf8')); }
function saveBaseline(root, b) { writeFile(root, BASELINE_PATH, JSON.stringify(b, null, 1)); }
const BASE_FILES = () => ({
  'app/a.mjs': sqliteImport + '\nexport const x = 1;\n',
  'app/b.mjs': relayDynamic + '\nexport const y = 2;\n',
});
const hasRule = (vs, rule, substr) => vs.some((v) => v.rule === rule && (!substr || v.msg.includes(substr)));

// 1. 新文件加裸 import(逐字节抄现有行) → ERROR
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'app/new1.mjs', sqliteImport + '\n');
  git(r, ['add', 'app/new1.mjs']);
  ok('#1 新文件同form裸import → ERROR', hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', 'app/new1.mjs'));
}
// 2. 既有文件加第二处 occurrence → ERROR
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'app/a.mjs', sqliteImport + '\n' + sqliteRequire + '\nexport const x = 1;\n');
  git(r, ['add', 'app/a.mjs']);
  ok('#2 既有文件count+1 → ERROR', hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', 'app/a.mjs'));
}
// 3. 纯移动 + 同 commit refresh baseline → PASS 零报
{
  const r = freshRepo(BASE_FILES());
  git(r, ['mv', 'app/a.mjs', 'app/moved-a.mjs']);
  const b = loadBaseline(r);
  for (const e of b.entries) if (e.path === 'app/a.mjs') e.path = 'app/moved-a.mjs';
  saveBaseline(r, b);
  git(r, ['add', '-A']);
  const vs = runAllM0aChecks(r);
  ok('#3 纯移动+refresh → 零报', vs.length === 0, JSON.stringify(vs.map((v) => v.rule)));
}
// 4. 纯移动不带 refresh → ERROR(提示 --refresh-paths)
{
  const r = freshRepo(BASE_FILES());
  git(r, ['mv', 'app/a.mjs', 'app/moved-a.mjs']);
  ok('#4 纯移动无refresh → ERROR+提示', hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', '--refresh-paths'));
}
// 5. 删一处旧 + 加一处新文件, 净 count 不变 → ERROR(NWT MUST-FIX 对偶 case)
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'app/a.mjs', 'export const x = 1;\n'); // 删 import
  writeFile(r, 'app/sneak.mjs', sqliteImport + '\n');  // 加同 form 新文件
  git(r, ['add', '-A']);
  const vs = diffAgainstBaseline(r);
  ok('#5 删真加假净count不变 → 新文件仍ERROR', hasRule(vs, 'R-M0A-BARE-IMPORT-DIFF', 'app/sneak.mjs'));
}
// 6. 删 occurrence 不 prune → ERROR; 删+prune 同 commit → PASS
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'app/a.mjs', 'export const x = 1;\n');
  git(r, ['add', 'app/a.mjs']);
  ok('#6a 燃尽未落账 → ERROR(提示 --prune)', hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', '--prune'));
  const b = loadBaseline(r);
  b.entries = b.entries.filter((e) => e.path !== 'app/a.mjs');
  saveBaseline(r, b);
  git(r, ['add', '-A']);
  const vs = runAllM0aChecks(r);
  ok('#6b 燃尽+prune同commit → 零报', vs.length === 0, JSON.stringify(vs.map((v) => v.rule)));
}
// 7. 移动+大改逃过 -M 阈值 → 降级 D+A 撞新增即败(有意 fail-closed)
{
  const r = freshRepo(BASE_FILES());
  fs.rmSync(path.join(r, 'app/a.mjs'));
  let big = sqliteImport + '\n';
  for (let i = 0; i < 80; i++) big += `export function totallyDifferent${i}() { return ${i} * Math.PI; }\n`;
  writeFile(r, 'app/rewritten.mjs', big);
  git(r, ['add', '-A']);
  ok('#7 大改移动降级D+A → ERROR', hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', 'app/rewritten.mjs'));
}
// 8. baseline 篡改: count+1 / 伪造 path 改写 → EDIT-GUARD ERROR
{
  const r = freshRepo(BASE_FILES());
  const b = loadBaseline(r);
  b.entries.find((e) => e.path === 'app/a.mjs').count = 2;
  saveBaseline(r, b);
  git(r, ['add', BASELINE_PATH]);
  ok('#8a baseline count+1 → EDIT-GUARD ERROR', hasRule(baselineEditGuard(r), 'R-M0A-BASELINE-EDIT-GUARD', '增加'));
  git(r, ['checkout', '-q', '--', BASELINE_PATH]);
  git(r, ['add', BASELINE_PATH]);
  const b2 = loadBaseline(r);
  b2.entries.find((e) => e.path === 'app/a.mjs').path = 'app/fake.mjs';
  saveBaseline(r, b2);
  git(r, ['add', BASELINE_PATH]);
  ok('#8b 伪造path改写(无rename对) → EDIT-GUARD ERROR', hasRule(baselineEditGuard(r), 'R-M0A-BASELINE-EDIT-GUARD'));
}
// 9. manifest db-readonly: readonly:true → PASS; 缺 readonly → ERROR; 带 relay import → ERROR
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'tools/diag.mjs', sqliteImport + '\n' + newDbReadonly + '\n');
  const entry = {
    id: 'OPS-1', family: 'sqlite', form: 'import Database from ' + SQLITE, path: 'tools/diag.mjs',
    capability: 'db-readonly', justification: 'test diag', review_ref: 'ledger:test',
  };
  writeFile(r, MANIFEST_PATH, JSON.stringify({ entries: [entry] }, null, 1));
  git(r, ['add', '-A']);
  let vs = runAllM0aChecks(r);
  ok('#9a manifest只读诊断(readonly:true) → 零报', vs.length === 0, JSON.stringify(vs.map((v) => v.msg.slice(0, 80))));
  writeFile(r, 'tools/diag.mjs', sqliteImport + '\n' + newDbPlain + '\n');
  git(r, ['add', 'tools/diag.mjs']);
  ok('#9b 缺readonly:true → ERROR', hasRule(runAllM0aChecks(r), 'R-M0A-OPS-NOT-READONLY'));
  writeFile(r, 'tools/diag.mjs', sqliteImport + '\n' + newDbReadonly + '\n' + relayDynamic + '\n');
  git(r, ['add', 'tools/diag.mjs']);
  ok('#9c 只读例外带relay import → ERROR', hasRule(runAllM0aChecks(r), 'R-M0A-OPS-NOT-READONLY', 'relay'));
}
// 10. self-serve:readonly-test 自助道: 测试路径+readonly → PASS; 非测试路径 → ERROR
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'app/regress.test.mjs', sqliteImport + '\n' + newDbReadonly + '\n');
  const entry = {
    id: 'TF-1', family: 'sqlite', form: 'import Database from ' + SQLITE, path: 'app/regress.test.mjs',
    capability: 'test-fixture', justification: 'regression fixture', review_ref: 'self-serve:readonly-test',
  };
  writeFile(r, MANIFEST_PATH, JSON.stringify({ entries: [entry] }, null, 1));
  git(r, ['add', '-A']);
  let vs = runAllM0aChecks(r);
  ok('#10a 自助只读测试道 → 零报', vs.length === 0, JSON.stringify(vs.map((v) => v.msg.slice(0, 80))));
  const entry2 = { ...entry, id: 'TF-2', path: 'tools/notatest.mjs' };
  writeFile(r, 'tools/notatest.mjs', sqliteImport + '\n' + newDbReadonly + '\n');
  writeFile(r, MANIFEST_PATH, JSON.stringify({ entries: [entry, entry2] }, null, 1));
  git(r, ['add', '-A']);
  ok('#10b 自助道文件不在测试路径 → ERROR', hasRule(runAllM0aChecks(r), 'R-M0A-OPS-NOT-READONLY', '测试路径'));
}
// 11. 新建守门模块同 basename 文件 → SHADOW-MODULE ERROR
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'lib/' + RELAY, 'export const fake = 1;\n');
  git(r, ['add', '-A']);
  ok('#11 shadow-module → ERROR', hasRule(shadowModuleCheck(r), 'R-M0A-SHADOW-MODULE', RELAY));
}
// 12. 计算 opts 无法静态核 readonly → fail-closed 拒(NWT 实现批注记)
{
  const r = freshRepo(BASE_FILES());
  writeFile(r, 'tools/diag2.mjs', sqliteImport + '\nconst opts = { readonly: cfgFlag };\n' + newDbComputed + '\n');
  const entry = {
    id: 'OPS-2', family: 'sqlite', form: 'import Database from ' + SQLITE, path: 'tools/diag2.mjs',
    capability: 'db-readonly', justification: 'computed opts case', review_ref: 'ledger:test',
  };
  writeFile(r, MANIFEST_PATH, JSON.stringify({ entries: [entry] }, null, 1));
  git(r, ['add', '-A']);
  ok('#12 计算opts → fail-closed ERROR', hasRule(manifestChecks(r), 'R-M0A-OPS-NOT-READONLY', '计算'));
}
// 14. 空白变体绕过(NWT 实现批 diff 审 MUST-FIX 7d079ed5): 双空格/括号后空格/tab 必须照抓
{
  const TAB = String.fromCharCode(9);
  const variants = [
    ['#14a from双空格', 'import Database from  ' + Q + SQLITE + Q + ';'],
    ['#14b require括号后空格', 'const Database = require( ' + Q + SQLITE + Q + ');'],
    ['#14c from后tab', 'import Database from' + TAB + Q + SQLITE + Q + ';'],
    ['#14d relay动态import括号后空格', 'const m = await import( ' + Q + '../lib/' + RELAY + Q + ');'],
  ];
  for (const [name, line] of variants) {
    const r = freshRepo(BASE_FILES());
    writeFile(r, 'app/ws-variant.mjs', line + '\n');
    git(r, ['add', 'app/ws-variant.mjs']);
    ok(`${name} → ERROR`, hasRule(diffAgainstBaseline(r), 'R-M0A-BARE-IMPORT-DIFF', 'app/ws-variant.mjs'));
  }
}
// 13. 真仓全量计时 < 3s
{
  const t0 = Date.now();
  const vs = runAllM0aChecks(REAL_ROOT);
  const ms = Date.now() - t0;
  ok(`#13 真仓全量 ${ms}ms < 3000ms`, ms < 3000);
  ok('#13b 真仓当前镜像零违规', vs.length === 0, JSON.stringify(vs.slice(0, 3).map((v) => v.msg.slice(0, 100))));
}

console.log(`\n[m0a-lint.test] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
