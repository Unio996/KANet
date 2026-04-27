#!/usr/bin/env node
// scripts/test.mjs — test-framework cli runner
// Usage: node scripts/test.mjs --case=cases/broker/foo.test.mjs
//        node scripts/test.mjs --domain=broker  (run all in domain)
//        node scripts/test.mjs --all

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

async function main() {
  const caseFile = arg('case');
  const domain = arg('domain');
  const tag = arg('tag');  // 用于 git hook critical 优先 (--tag=critical 跑所有标 critical 的 case)
  const adversarial = arg('adversarial', args.includes('--adversarial') ? '' : null);  // J1 phase 7a: load probes.mjs probes
  const allFlag = args.includes('--all');
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

  const files = adversarialCases.length > 0 ? [] : await findCases({ caseFile, domain, all: allFlag || !!tag });
  if (files.length === 0 && adversarialCases.length === 0) {
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
    if (result.pass) totalPass++; else totalFail++;
    summary.push({ id: result.id, pass: result.pass, failed: result.failed_assertions, trace_file: result.trace_file });
  }

  console.log('='.repeat(60));
  console.log(`Summary: ${totalPass} PASS / ${totalFail} FAIL / ${totalPass + totalFail} run`);
  if (totalFail > 0 && quietFlag) {
    // 失败时打 fail case 简要给 hook 用 + trace 路径让审计能直接看
    for (const s of summary) {
      if (!s.pass) {
        console.log(`  FAIL ${s.id}: ${s.failed?.map(f => f.key).join(', ')}`);
        if (s.trace_file) console.log(`        trace: ${s.trace_file}`);
      }
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
