#!/usr/bin/env node
// scripts/test.mjs — test-framework cli runner
// Usage: node scripts/test.mjs --case=cases/broker/foo.test.mjs
//        node scripts/test.mjs --domain=broker  (run all in domain)
//        node scripts/test.mjs --all

// DoD-E env 单源 (J1 Bettor r739 Option A): 必须排在 runner.mjs import 之前 —— 派生
// KANET_CONSOLE_URL + PORT from kanet.env PORT, 让 runner.mjs:19 顶层 const + case TN12_CONSOLE
// 都跟随跑测节点 (测试节点无关). 见 test-framework/lib/env-bootstrap.mjs 头注.
import '../test-framework/lib/env-bootstrap.mjs';
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
  const casesDir = path.join(FRAMEWORK_ROOT, 'cases');
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
  if (!caseFile && !domain && !tag && !allFlag && adversarial === null) {
    console.log('Usage: node scripts/test.mjs --case=<path> | --domain=<broker|seeker|...> | --tag=<critical|security|...> | --all');
    console.log('       --adversarial[=<category>]  load probes.mjs adversarial probes (phase 7a, --adversarial=race for race only)');
    console.log('       --quiet  仅输出 summary');
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
  // Build unified case list: file-loaded + adapter-loaded adversarial probes
  const casesToRun = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    if (mod.default?.id) casesToRun.push(mod.default);
    else if (!quietFlag) console.log(`SKIP (no default export): ${file}`);
  }
  for (const adv of adversarialCases) casesToRun.push(adv);
  for (const testCase of casesToRun) {
    // tag filter (case 必含此 tag)
    if (tag && !(testCase.tags || []).includes(tag)) continue;
    if (isBatch && testCase.skip_in_batch) {
      if (!quietFlag) console.log(`SKIP (manual-only): ${testCase.id}`);
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
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(2);
});
