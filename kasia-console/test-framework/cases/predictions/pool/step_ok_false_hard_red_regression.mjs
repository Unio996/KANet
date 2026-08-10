// Regression: 「handler 返回 ok:false 且该步无 expect ⇒ 用例必须 FAIL」(② MUST-FIX 的堵洞证明)
// (J2, 2026-08-09 · Bettor 17:21 解锁翻硬红 · NWT 审)
//
// 🔴 它证的洞(2026-08-09 实测): runner 主循环**从不检查 handler 的返回值**, 只按 step 自己声明的
//    expect 判红绿。而 `exec_sql` 这类纯种数据步骤通常不带 expect ⇒ 它 {ok:false} 抛错时
//    **这一步照样显示 ✓、用例照样 PASS** ⇒ "✓" 的真实含义只是「没有断言反驳它」。
//    实历: 两处列型写错 + 一处外键失败, 六个 exec_sql 全绿, 失败只在下游以一个
//    **看起来完全合法的裁决**显形(见 p2_committee_abstain_refund 文件头)。
//
// 🔴 为什么必须是【元测试】而不是一条普通用例:
//    一条用例**不能断言自己的判定** —— 它若判红, 它自己就是红的, 没人能从它嘴里听到"我该红"。
//    ⇒ 本文件起一个**子进程**跑 runner, 拿它对 fixture 的判定当被断言物。
//
// 🔴 同 zk_autonomy_ticks_regression.mjs 惯例: 文件名【不是】 *.test.mjs, 直接 `node <file>` 跑,
//    不进 runner 的 --all/--domain(它要 spawn runner, 放进批量跑会自嵌套)。
//
// 跑法:
//   cd kasia-console
//   set DB_PATH / KANET_DB_PATH 指向 test-framework/data 下的库; set KASPA_RPC_URL=ws://127.0.0.1:9
//   node test-framework/cases/predictions/pool/step_ok_false_hard_red_regression.mjs

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_ROOT = path.resolve(HERE, '../../../../');           // → kasia-console
const FIXTURE = 'test-framework/cases/predictions/pool/fixture_step_ok_false_no_expect.mjs';

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`✅ ${name}`); }
  else { console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); failures++; }
};

function runFixture() {
  try {
    const out = execFileSync(process.execPath, ['scripts/test.mjs', `--case=${FIXTURE}`], {
      cwd: CONSOLE_ROOT, encoding: 'utf8', timeout: 120000,
      env: { ...process.env },
    });
    return { out, exitCode: 0 };
  } catch (e) {
    // 判红时 test.mjs 以非零退出 ⇒ execFileSync 抛, 输出仍在 e.stdout
    return { out: String(e.stdout || ''), exitCode: e.status ?? -1 };
  }
}

const { out, exitCode } = runFixture();

// ── 阳性对照先行: 先证明 fixture 真的被跑到了, 否则下面的"判红"可能只是它压根没跑 ──
check('对照: fixture 确实被 runner 跑到(输出里有它的 id)',
  out.includes('fixture_step_ok_false_no_expect'),
  `输出前 200 字: ${out.slice(0, 200).replace(/\n/g, ' ')}`);

// ── 主断言 ──
check('🔴 无 expect 的失败步骤 ⇒ 用例判 FAIL(不是 PASS)',
  /✗\s+FAIL\s+\|\s+fixture_step_ok_false_no_expect/.test(out),
  '判定行未出现 FAIL —— 洞没堵住(从前它会 PASS)');

check('失败原因点名 __STEP_OK_FALSE_NO_EXPECT__',
  out.includes('__STEP_OK_FALSE_NO_EXPECT__'),
  '判红了但没说清是哪一类失败, 下一个人查不到根因');

check('runner 以非零退出(调用方能感知)', exitCode !== 0, `exitCode=${exitCode}`);

// ── 反向: 那条必过的断言仍然过 ⇒ 判红是因为坏步骤, 不是因为整个跑不起来 ──
check('对照: 同一跑里那条 sanity 断言仍通过(判红不是"整个跑挂了")',
  out.includes('rows_min'),
  'sanity 步骤的断言没出现 ⇒ 可能是 runner 整个崩了而非按预期判红');

console.log('');
if (failures) { console.log(`❌ ${failures} 项未通过`); process.exit(1); }
console.log('✅ ALL PASS (0 failures)');
