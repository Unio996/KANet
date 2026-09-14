#!/usr/bin/env node
// scripts/test.mjs — test-framework cli runner
// Usage: node scripts/test.mjs --case=cases/broker/foo.test.mjs
//        node scripts/test.mjs --domain=broker  (run all in domain)
//        node scripts/test.mjs --all

// DoD-E env 单源 (J1 Bettor r739 Option A): 必须排在 runner.mjs import 之前 —— 派生
// KANET_CONSOLE_URL + PORT from kanet.env PORT, 让 runner.mjs:19 顶层 const + case TN12_CONSOLE
// 都跟随跑测节点 (测试节点无关). 见 test-framework/lib/env-bootstrap.mjs 头注.
import { checkConsoleUrlListening } from '../test-framework/lib/env-bootstrap.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runCase, formatResult } from '../test-framework/lib/runner.mjs';

const args = process.argv.slice(2);
function arg(name, def) {
  const a = args.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.join(__dirname, '..', 'test-framework');

async function findCases({ caseFile, domain, all }) {
  if (caseFile) {
    const abs = path.isAbsolute(caseFile) ? caseFile : path.resolve(process.cwd(), caseFile);
    return [abs];
  }
  // KANET_TEST_CASES_DIR: 测试自身用(discovery-resilience.test.mjs 拿它指向临时 fixture 目录,
  // 不碰真实 test-framework/cases/) — 未显式设时行为不变, 走真实目录。
  const casesDir = process.env.KANET_TEST_CASES_DIR
    ? path.resolve(process.env.KANET_TEST_CASES_DIR)
    : path.join(FRAMEWORK_ROOT, 'cases');
  const out = [];
  async function walk(dir, currentDomain) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, currentDomain || e.name);
      else if (e.name.endsWith('.test.mjs')) {
        if (!domain || currentDomain === domain) out.push(full);
      }
    }
  }
  await walk(casesDir, null);
  return out;
}

// Telegram live-smoke domain (KANet-UI, Bettor r970 — wire the orphan tg-bot tests into the auto-runner).
// The tg-bot tests (l1 getMe / l2 handler / l2b startBot-wiring) are standalone scripts that need a running
// Console + grammy (tg-bot/node_modules) + TELEGRAM_BOT_TOKEN — not the declarative case format. Run them as
// subprocesses + aggregate exit codes. Pre-check the Console; if it's down, SKIP (keeps --all CI-safe).
async function runTelegramDomain() {
  const { spawnSync } = await import('node:child_process');
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const tgTestDir = path.join(REPO_ROOT, 'tg-bot', 'test');
  let files = [];
  try { files = (await fs.readdir(tgTestDir)).filter(f => f.endsWith('.test.mjs')).sort(); } catch {}
  if (!files.length) { console.log('telegram: no tg-bot/test/*.test.mjs found'); return { pass: 0, fail: 0, skipped: 0 }; }

  const consoleUrl = process.env.KANET_CONSOLE_URL || `http://127.0.0.1:${process.env.PORT || 3200}`;
  let consoleUp = false;
  try { consoleUp = (await fetch(`${consoleUrl}/api/pool/markets?limit=1`, { signal: AbortSignal.timeout(3000) })).ok; } catch {}
  if (!consoleUp) {
    console.log(`telegram: SKIP — Console not reachable at ${consoleUrl} (live-smoke needs a running Console + grammy + token). ${files.length} test(s) skipped.`);
    return { pass: 0, fail: 0, skipped: files.length };
  }

  let pass = 0, fail = 0;
  for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(tgTestDir, f)], { cwd: REPO_ROOT, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const verdict = out.split('\n').filter(l => /\bPASS\b|\bFAIL\b/.test(l)).slice(-1)[0]?.trim() || '(no verdict)';
    // Pass/fail from the test's own "N/M PASS" tally (authoritative — it only prints after all assertions
    // ran). The exit code is a secondary signal: a known Windows libuv UV_HANDLE_CLOSING quirk on
    // process.exit (lingering keep-alive sockets) can corrupt a 5/5-passing test's exit code, so we trust
    // the printed tally and just note an exit-code discrepancy. No verdict line (early crash) → fail.
    const m = verdict.match(/(\d+)\s*\/\s*(\d+)\s+PASS/);
    const ok = m ? (Number(m[1]) === Number(m[2]) && Number(m[2]) > 0) : false;
    const note = (ok && r.status !== 0) ? '  [exit-code quirk ignored — tally authoritative]' : '';
    console.log(`${ok ? '✓' : '✗'} tg-bot/${f}  — ${verdict}${note}`);
    if (ok) pass++;
    else { fail++; console.log(out.split('\n').filter(l => l.trim()).slice(-10).map(l => '    ' + l).join('\n')); }
  }
  return { pass, fail, skipped: 0 };
}

async function main() {
  const caseFile = arg('case');
  const domain = arg('domain');
  const tag = arg('tag');  // 用于 git hook critical 优先 (--tag=critical 跑所有标 critical 的 case)
  const adversarial = arg('adversarial', args.includes('--adversarial') ? '' : null);  // J1 phase 7a: load probes.mjs probes
  const allFlag = args.includes('--all');
  const isTelegram = domain === 'tg-bot' || domain === 'telegram';  // live-smoke tg-bot tests (subprocess)
  const quietFlag = args.includes('--quiet');  // 只输出 summary, 不 dump 每 case 详情 (post-commit 用)
  // rule 82(NWT GREEN 8578050b·ledger 1233/1251, 设计 docs/2026-09-14-kanetui-test-runner-skip-gate-and-
  // console-url-safety-design-v0.1.md §1.2): --case= 显式点名单个 case 时原 isBatch 恒 false, skip_in_batch
  // 保护形同虚设——RC_01_buy_kas_real_full.test.mjs(真钱 skip_in_batch+real_chain)被遍历脚本用 --case=
  // 逐个跑到时才发现完全不受保护(手动 TaskStop 止损, 本人+Bettor 各自独立核实无真实广播)。
  // allowManualOnly 显式旗标, 默认不给 = 保护永远激活, 与"怎么选 case"(--case/--domain/--all/--tag)解耦。
  const allowManualOnly = args.includes('--allow-manual-only');
  if (!caseFile && !domain && !tag && !allFlag && adversarial === null) {
    console.log('Usage: node scripts/test.mjs --case=<path> | --domain=<broker|seeker|...> | --tag=<critical|security|...> | --all');
    console.log('       --adversarial[=<category>]  load probes.mjs adversarial probes (phase 7a, --adversarial=race for race only)');
    console.log('       --quiet  仅输出 summary');
    console.log('       --allow-manual-only  绕过 skip_in_batch/skip_in_cron 保护(含 real_chain 真花钱用例), 默认不给');
    process.exit(1);
  }

  // J1 phase 7a: load adversarial probes via adapter (probe DSL → testCase objects, not file-based)
  let adversarialCases = [];
  if (adversarial !== null) {
    const { loadAdversarialCases } = await import('../test-framework/adversarial/load-probes.mjs');
    const opts = adversarial ? { category: adversarial } : {};
    adversarialCases = await loadAdversarialCases(opts);
  }

  const files = (adversarialCases.length > 0 || isTelegram) ? [] : await findCases({ caseFile, domain, all: allFlag || !!tag });
  if (files.length === 0 && adversarialCases.length === 0 && !isTelegram) {
    console.log('No matching test cases found.');
    process.exit(1);
  }

  let totalPass = 0, totalFail = 0, totalSkipped = 0;
  const summary = [];
  // J1 phase 7a-1 polish (NWT 7c66dd00 finding): --adversarial 显式 override skip_in_batch
  // (用户明确要跑 adversarial, 不是 cron batch 默认 — adversarial 自身 manual-only 设计是为了 cron 不污染).
  const isBatch = !caseFile && adversarial === null;
  // rule 82: 保护是否激活跟"怎么选 case"完全解耦——不共用 isBatch, 默认永远激活, 只有 --allow-manual-only
  // 能关。--adversarial 走的是完全不同的 case 来源(loadAdversarialCases 产出的 probe DSL 对象, 不是文件系统
  // 里带 skip_in_batch 字段的 .test.mjs), 不受这条影响, isBatch 原变量的既有语义/既有用途不变。
  const skipGateActive = !allowManualOnly;
  // Build unified case list: file-loaded + adapter-loaded adversarial probes
  const casesToRun = [];
  // ── ② 检测哨: import 期 env 污染 trip-wire(Bettor 2026-08-09 16:47 裁 · J2 实现 · NWT 审)──
  // 🔴 它防的那件事(2026-08-09 实测): 用例文件在【模块体】改 process.env, 而本循环是
  //    **先把全部文件 import 完再开始跑** ⇒ 那次改动发生在【任何 case 开跑之前】,
  //    并留给之后每一个用例。实历: 一个文件把 DB_PATH 指向 scratch 且不还原 ⇒
  //    后面 3 个用例的隔离守卫一律拒绝 import 生产模块 ⇒ 33 次 __DB_PATH_NOT_ISOLATED__。
  // 🔵 为什么"每例前快照/还原"救不了: 污染早于第一个 case, 快照到的已经是脏值。
  //    ⇒ 唯一能抓到它的位置就是【这个 import 循环里】, 逐文件比对。
  // 🔨 它是 trip-wire 不是判官: **只报不 fail**。报出来的分两档, 由人判:
  //      档1 = bug(非 case 文件污染全局)⇒ 修
  //      档2 = 合法(用例确需在 import 前置环境, 如把假 relay 塞进模块私有状态)⇒ 认领并注释
  //    自动判红会把档2 一起打死, 而它们是过审的设计。
  const _envOffenders = [];
  // ── discovery loop 错误隔离(Bettor 1270 派工 · 主线测试基线 RED 清单 3f85d543 §1-A 根治)──
  // 🔴 被修的洞: 本循环之前没有 try/catch —— 任何一个文件在 import 期同步 throw(无论是意外
  //    bug, 还是像 p1_refund_authorization_gate.test.mjs 那样"生产结构变了故意拒绝放行"的
  //    自我保护设计), 都会直接冒穿到 main().catch() 把整个进程 exit(2), **该文件字母序之后
  //    的所有文件永远不会被 discover, 更别说跑**——包括已经在它之前被成功 import 进
  //    casesToRun 的文件, 因为执行循环排在整个 discovery 循环【之后】, discovery 没走完
  //    执行就压根没开始。predictions 域 63 个真实 case-object 因此可能从未被真正执行过一次
  //    (2026-09-14 主线测试基线调查坐实, trace 目录零命中验证)。
  // 🔵 修法: 单文件 import/containment-guard 失败 = 【该文件】的 RED(记录错误文本), 不是整个
  //    batch 的死刑 —— continue 到下一文件, 结束时汇总"N 个文件 import 失败"且非零退出码
  //    (总不能让"批里有文件连 import 都进不去"看起来跟"全部干净跑完"一个退出码)。
  const _importFailures = [];
  for (const file of files) {
    const _envPre = { ...process.env };
    try {
      const mod = await import(pathToFileURL(file).href);
      // 🔴 ⑤ blocker① (C) 的第二道:交接单陷阱一 —— 遏制靠"谁先加载"成立, 顺序一变遏制就没了,
      //    而【没有任何东西会报错】, 出站会安安静静打到真 relay。bootstrap 那一道只看得见它自己
      //    那一刻;用例在【自己的模块加载期】把 RELAY_DIR 改走, 只有这里看得见。
      //    ⇒ 在跑该用例的任何 step 之前就抛, 这才是"import 前即 fail"里的"前"。
      (await import('../test-framework/lib/containment-guard.mjs')).assertContained(`case:${path.basename(file)}`);
      // 逐文件比对 ⇒ 直接点名源头, 而不是只说"import 之后 env 变了"
      const changed = [];
      for (const k of new Set([...Object.keys(_envPre), ...Object.keys(process.env)])) {
        if (_envPre[k] !== process.env[k]) changed.push(k);
      }
      if (changed.length) _envOffenders.push({ file, keys: changed });
      if (mod.default?.id) casesToRun.push(mod.default);
      else if (!quietFlag) console.log(`SKIP (no default export): ${file}`);
    } catch (err) {
      _importFailures.push({ file, error: err?.message || String(err) });
      console.error(`✗ IMPORT FAILED: ${file}`);
      console.error(`   ${err?.message || err}`);
    }
  }
  if (_envOffenders.length) {
    console.log('');
    console.log('⚠⚠ import 期 process.env 被改动 —— 这些改动【早于任何 case 开跑】, 会留给之后所有用例:');
    for (const o of _envOffenders) {
      console.log(`   ${o.file}`);
      console.log(`      改了: ${o.keys.join(', ')}`);
    }
    const isoKeys = _envOffenders.flatMap((o) => o.keys).filter((k) => k === 'DB_PATH' || k === 'KANET_DB_PATH' || k === 'KASPA_RPC_URL');
    if (isoKeys.length) {
      console.log(`   🔴 其中 ${[...new Set(isoKeys)].join(', ')} 是【隔离守卫读的键】—— 改了它, 之后的用例会被守卫拒绝 import 生产模块。`);
    }
    console.log('   🔨 人来分档: 非 case 文件污染全局 = bug 要修; 用例确需前置环境 = 合法, 请在该文件加注释认领。');
    console.log('');
  }
  for (const adv of adversarialCases) casesToRun.push(adv);
  // rule 82 LOUD 提示：--allow-manual-only 关闭了保护, 跑之前把绕过的范围说清楚——尤其 real_chain
  // 这个真花钱的子集单独点出来, 不是所有 skip_in_batch 用例都花钱(有些只是"跑起来慢/依赖外部状态不
  // 适合 cron"), 不能笼统一句带过。
  if (allowManualOnly) {
    const manualOnlyCases = casesToRun.filter((c) => c.skip_in_batch || c.skip_in_cron);
    const realChainCases = manualOnlyCases.filter((c) => (c.tags || []).includes('real_chain'));
    if (manualOnlyCases.length) {
      console.log('');
      console.log(`⚠⚠⚠ --allow-manual-only 已绕过 skip_in_batch/skip_in_cron 保护 —— 即将真实运行 ${manualOnlyCases.length} 个标记用例：`);
      for (const c of manualOnlyCases) console.log(`   ${c.id}${(c.tags || []).includes('real_chain') ? '  🔴 real_chain(真花钱)' : ''}`);
      if (realChainCases.length) {
        console.log(`🔴🔴🔴 其中 ${realChainCases.length} 个带 real_chain tag —— 真实链上广播+真实花费, 不是模拟。确认这是你想要的。`);
      }
      console.log('');
    }
  }
  // rule 82: 端口安全检查必须晚于 case 选定(需要知道这批"实际会执行"的 case 里有没有 real_chain)——
  // "会执行"= 没被 skip 门拦下的那些(skipGateActive 时排除 skip_in_batch/skip_in_cron, --allow-manual-only
  // 时不排除, 跟下面主循环的判据是同一条, 不能各写一份互相漂移)。
  const willRunCases = casesToRun.filter((c) => !(skipGateActive && (c.skip_in_batch || c.skip_in_cron)));
  const hasRealChain = willRunCases.some((c) => (c.tags || []).includes('real_chain'));
  await checkConsoleUrlListening({ hasRealChain });
  for (const testCase of casesToRun) {
    // tag filter (case 必含此 tag)
    if (tag && !(testCase.tags || []).includes(tag)) continue;
    // rule 82: 同时读 skip_in_batch 和 skip_in_cron 两个字段——skip_in_cron 此前从未被任何 runner 代码
    // 读取过(全仓 grep 核实过, 纯装饰), 这次一并接上, 不再只认 skip_in_batch 一个。
    if (skipGateActive && (testCase.skip_in_batch || testCase.skip_in_cron)) {
      if (!quietFlag) console.log(`SKIP (manual-only, pass --allow-manual-only to run): ${testCase.id}`);
      totalSkipped++;
      continue;
    }
    const result = await runCase(testCase);
    if (!quietFlag) {
      console.log(formatResult(result));
      console.log('');
    } else {
      const traceShort = result.trace_file ? result.trace_file.replace(/\\/g, '/').split('/').slice(-1)[0] : 'no-trace';
      console.log(`${result.pass ? '✓' : '✗'} ${result.id}  [${traceShort}]`);
    }
    // T-J2-2026-05-11 ABE-close B.5 (Owner 5/11 钦定 historical tag spec):
    // historical reproducer 不计入 DoD 主统计, 单独 section 输出 divergence_reason。
    if (result.historical === true) {
      summary.push({ id: result.id, pass: result.pass, failed: result.failed_assertions, trace_file: result.trace_file, historical: true, divergence_reason: result.divergence_reason, divergence_since: result.divergence_since });
    } else {
      if (result.pass) totalPass++; else totalFail++;
      summary.push({ id: result.id, pass: result.pass, failed: result.failed_assertions, trace_file: result.trace_file });
    }
  }

  // Telegram live-smoke domain — explicit --domain=tg-bot/telegram, or folded into --all (Console-gated).
  if (isTelegram || allFlag) {
    if (!quietFlag) console.log('--- Telegram live-smoke (tg-bot/test) ---');
    const tg = await runTelegramDomain();
    totalPass += tg.pass; totalFail += tg.fail; totalSkipped += tg.skipped;
  }

  console.log('='.repeat(60));
  console.log(`Summary: ${totalPass} PASS / ${totalFail} FAIL / ${totalPass + totalFail} run`);
  if (_importFailures.length) {
    console.log(`${_importFailures.length} 个文件 import 失败(未计入上面 run 统计 — 这些文件既没 PASS 也没 FAIL, 是"连门都没进去"):`);
    for (const f of _importFailures) {
      console.log(`  IMPORT-FAIL ${f.file}`);
      console.log(`        ${f.error}`);
    }
  }
  const historicalCases = summary.filter(s => s.historical);
  if (historicalCases.length > 0) {
    console.log('');
    console.log(`Historical Reproducers (${historicalCases.length} cases — post-product-evolution expected divergence, not counted in DoD):`);
    for (const h of historicalCases) {
      console.log(`  ${h.pass ? '✓' : '✗'} ${h.id} — ${h.divergence_reason} (since ${h.divergence_since})`);
    }
  }
  if (totalFail > 0 && quietFlag) {
    // 失败时打 fail case 简要给 hook 用 + trace 路径让审计能直接看
    for (const s of summary) {
      if (s.historical || s.pass) continue;
      console.log(`  FAIL ${s.id}: ${s.failed?.map(f => f.key).join(', ')}`);
      if (s.trace_file) console.log(`        trace: ${s.trace_file}`);
    }
  }
  // Owner 钦定 'no log no pass' — trace 文件夹 path 在末尾告诉任何人去哪审计
  if (totalPass + totalFail > 0) {
    const traceFiles = summary.filter(s => s.trace_file).map(s => s.trace_file);
    if (traceFiles.length > 0) {
      console.log(`Trace files: logs/test-runs/ (${traceFiles.length} written)`);
    }
  }
  process.exit((totalFail > 0 || _importFailures.length > 0) ? 1 : 0);
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(2);
});
