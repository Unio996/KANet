// R-CTOR-ONLY-ASSIGNMENT-TRIPWIRE 负向测试（T4 v0.4 §1.3，ledger 1203/1204）。跑: node scripts/r-ctor-only-assignment-tripwire.test.mjs
//
// findCtorOnlyTripwireHits() 是纯函数（内容 in, 命中数组 out），不碰 fs/git/ROOT——不需要临时 git repo 夹具
// （对照 scripts/m0a-lint.test.mjs 那种需要 freshRepo() 的重量级夹具，本规则的检测逻辑本身跟仓库结构无关，
// 直接喂字符串就能测全部分支）。正向（全仓 0 命中）由 `node scripts/lint-kanet.mjs` 本身覆盖，见本次
// commit message 记录的实跑结果，本文件专注负向向量。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findCtorOnlyTripwireHits } from './r-ctor-only-assignment-tripwire-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
};
const hitFields = (content) => findCtorOnlyTripwireHits(content).map((h) => h.field);

// ── 正向向量：三个字段各自真赋值必报 ──
ok('predicate_commit 赋值命中',
  hitFields('predicate_commit = x;').includes('predicate_commit'));
ok('poolMerkleRoot 赋值命中',
  hitFields('poolMerkleRoot = someValue;').includes('poolMerkleRoot'));
ok('committee_hash 赋值命中',
  hitFields('committee_hash = blake2b(x);').includes('committee_hash'));
ok('无空格赋值也命中',
  hitFields('predicate_commit=x;').includes('predicate_commit'));

// ── 负向向量：比较操作符不命中 ──
ok('predicate_commit == 比较不命中',
  hitFields('require(predicate_commit == x);').length === 0);
ok('poolMerkleRoot != 比较不命中（字段在左）',
  hitFields('require(poolMerkleRoot != x);').length === 0);
ok('poolMerkleRoot != 比较不命中（字段在右，真实向量：PoolSpine_v08_agg.sil 实际写法）',
  hitFields('require(global_commit_id != poolMerkleRoot);').length === 0);

// ── 负向向量：ctor 参数声明不是赋值 ──
ok('ctor 参数声明（逗号收尾）不命中',
  hitFields('    byte[32] predicate_commit,').length === 0);
ok('ctor 参数声明（右括号收尾，末位参数）不命中',
  hitFields('    byte[32] committee_hash)').length === 0);

// ── 负向向量：注释里提到字段名+等号字面文本，不当真赋值 ──
ok('整行注释提到字段名+赋值文本不命中',
  hitFields('// oracle phase 未来会做 predicate_commit = derivedValue 这样的接线').length === 0);
ok('代码后跟行内注释提到另一字段的赋值文本不命中（真实向量：PayoutShard.sil:246 同款写法）',
  hitFields('require(blake2b(byte[](predicate_commit)) != predicate_commit);  // predicate_commit baked-use').length === 0);
ok('真赋值前面即使有普通注释，代码部分仍要命中（防止误伤：注释豁免不能连累真代码）',
  hitFields('// 说明文字\npredicate_commit = x; // 这行是真赋值').includes('predicate_commit'));

// ── 负向向量：三个字段名互不误伤（前缀/子串不应该跨字段污染彼此）──
ok('三字段互不误报——只赋值 poolMerkleRoot 时 predicate_commit/committee_hash 不应出现在命中里',
  (() => {
    const fields = hitFields('poolMerkleRoot = x;');
    return fields.includes('poolMerkleRoot') && !fields.includes('predicate_commit') && !fields.includes('committee_hash');
  })());

// ── 正向向量：不限定"当前 8 个文件"——检测逻辑本身是内容匹配，不看文件名，天然覆盖未来新文件 ──
ok('检测逻辑不依赖文件名——任意内容只要出现字段名+赋值就命中，不需要在白名单里加新文件名',
  hitFields('// 假想第9个未来市场合约文件内容\npredicate_commit = newValue;').includes('predicate_commit'));

// ── 集成向度：对全仓当前所有已跟踪 .sil 文件重放同一个纯函数，确认 0 命中（跟 lint-kanet.mjs 走的是同一份检测逻辑）──
{
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.sil'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const silFiles = out.split('\0').filter(Boolean);
  let totalHits = 0;
  const fs = await import('node:fs');
  for (const rel of silFiles) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    totalHits += findCtorOnlyTripwireHits(content).length;
  }
  ok(`全仓 ${silFiles.length} 个已跟踪 .sil 文件当前 0 命中（正向基线，非负向 fixture）`, totalHits === 0, `实际命中数=${totalHits}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
