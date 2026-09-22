// r-single-judge-lint.test.mjs — D-032 §2.5/§2.7 lint 规则 R-SINGLE-JUDGE 的负向测试(四个禁复发标识符各一条红)
// + 正向对照(合法用法不误报, 范围外文件不检查)。规则本身内联在 lint-kanet.mjs(未拆共享 lib), 这里直接
// spawn CLI 喂临时夹具文件(同 scripts/m0a-lint.test.mjs 的重量级夹具风格, 这里更轻——不需要 git repo)。
// 跑: node scripts/r-single-judge-lint.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => { if (cond) { passed++; console.log(`  ok ${name}`); } else { failed++; console.error(`  FAIL ${name} ${detail}`); } };

/** 在范围内(kasia-console/src/lib/proto-*.mjs)写一个临时夹具, 跑 lint-kanet 只对这一个文件, 返回 {status, out}。用完必删(finally)。 */
function lintFixture(content, { relPath = `kasia-console/src/lib/proto-_lint_fixture_${process.pid}_${Date.now()}.mjs` } = {}) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  try {
    const r = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-kanet.mjs'), relPath], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, out: r };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  } finally {
    try { fs.unlinkSync(abs); } catch {}
  }
}

console.log('[test] R-SINGLE-JUDGE 负向(四个标识符各一条红):');
{
  const r1 = lintFixture(`export function x() { return derivePolymarketVote(1); }\n`);
  ok('derivePolymarketVote 活代码复发 ⇒ 非零退出 + R-SINGLE-JUDGE', r1.status !== 0 && /R-SINGLE-JUDGE/.test(r1.out) && /derivePolymarketVote/.test(r1.out), r1.out.slice(0, 300));

  const r2 = lintFixture(`export const W = UMA_FINALIZATION_WINDOW_MS;\n`);
  ok('UMA_FINALIZATION_WINDOW_MS 复发 ⇒ 非零退出 + R-SINGLE-JUDGE', r2.status !== 0 && /R-SINGLE-JUDGE/.test(r2.out) && /UMA_FINALIZATION_WINDOW_MS/.test(r2.out), r2.out.slice(0, 300));

  const r3 = lintFixture(`export const KEYS = ['side_map', 'polymarket_outcome_side'];\n`);
  ok('polymarket_outcome_side 复发(哪怕带引号, 白名单数组形态)⇒ 非零退出 + R-SINGLE-JUDGE', r3.status !== 0 && /R-SINGLE-JUDGE/.test(r3.out) && /polymarket_outcome_side/.test(r3.out), r3.out.slice(0, 300));

  const r4 = lintFixture(`export function h(body) { return body.outcomeConditionId; }\n`);
  ok('outcomeConditionId 裸标识符(属性访问)复发 ⇒ 非零退出 + R-SINGLE-JUDGE', r4.status !== 0 && /R-SINGLE-JUDGE/.test(r4.out) && /outcomeConditionId/.test(r4.out), r4.out.slice(0, 300));

  const r5 = lintFixture(`export function h(body) { const { outcomeConditionId } = body; return outcomeConditionId; }\n`);
  ok('outcomeConditionId 解构复发 ⇒ 非零退出 + R-SINGLE-JUDGE', r5.status !== 0 && /R-SINGLE-JUDGE/.test(r5.out), r5.out.slice(0, 300));
}

console.log('[test] R-SINGLE-JUDGE 正向对照(合法用法 / 范围外 ⇒ 干净退出):');
{
  // 与真实 findDualJudgeKeyInBody 同写法: outcomeConditionId 只作字符串字面量比较(拒绝它, 不是复用它)
  const r6 = lintFixture(`export function findDualJudgeKeyInBody(body) { for (const k of Object.keys(body)) { if (k === 'outcomeConditionId') return k; } return null; }\n`);
  ok('outcomeConditionId 作字符串字面量比较(findDualJudgeKeyInBody 拒绝写法)⇒ 不命中', r6.status === 0, r6.out.slice(0, 300));

  // 含字母 'n' 的带引号字符串(regression: 这是本规则旁注释记录的共用 stripStringsAndTrailingComment 既存 bug 的具体触发向量——本规则用局部正确版本, 不应受影响)
  const r7 = lintFixture(`export const X = 'a string containing the letter n and outcomeConditionId inside quotes';\n`);
  ok('outcomeConditionId 整个出现在带引号字符串内(含字母 n 触发共用函数 bug 的形状)⇒ 本规则用局部正确 stripper, 仍不命中', r7.status === 0, r7.out.slice(0, 300));

  // 整行注释提及不算复发(规则自己的说明注释也这样写, 若这条不成立, 规则会红自己)
  const r8 = lintFixture(`// 这行提到 derivePolymarketVote / UMA_FINALIZATION_WINDOW_MS / polymarket_outcome_side / outcomeConditionId 只是注释说明\nexport const Y = 1;\n`);
  ok('整行注释提及四个标识符 ⇒ 不命中(规则自身注释同款写法, 自检)', r8.status === 0, r8.out.slice(0, 300));

  // 范围外文件(非 proto-*.mjs): 同样的违规内容不该被这条规则管——用真实老系统命名放在 lib 下
  const r9 = lintFixture(`export function x() { return derivePolymarketVote(1); }\n`, { relPath: `kasia-console/src/lib/_lint_fixture_outofscope_${process.pid}.mjs` });
  ok('范围外文件名(不是 proto-*.mjs)⇒ R-SINGLE-JUDGE 不检查(可能仍因其它规则非零, 只看不含 R-SINGLE-JUDGE)', !/R-SINGLE-JUDGE/.test(r9.out), r9.out.slice(0, 300));

  // 自检: lint-kanet.mjs 自身(定义这条规则的源文件, 含全部四个标识符的裸字面量提及)必须能通过自己的规则(否则 pre-commit 会卡死在自己身上)
  const self = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-kanet.mjs'), 'scripts/lint-kanet.mjs'], { cwd: ROOT, encoding: 'utf8' });
  ok('lint-kanet.mjs 自身跑 lint ⇒ 0 error(R-SINGLE-JUDGE 的定义处不在 kasia-console/src/, 天然出规则自己的检查范围)', !/R-SINGLE-JUDGE/.test(self) && /0 errors/.test(self), self.slice(-300));
}

console.log(failed ? `\n❌ ${failed} 项失败(${passed} 项通过)` : `\n✅✅ ALL PASS(${passed} 项) — R-SINGLE-JUDGE 四标识符负向红 + 合法写法/范围外正向绿`);
process.exit(failed ? 1 : 0);
