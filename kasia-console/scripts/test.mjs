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
  const allFlag = args.includes('--all');
  if (!caseFile && !domain && !allFlag) {
    console.log('Usage: node scripts/test.mjs --case=<path> | --domain=<broker|seeker|...> | --all');
    process.exit(1);
  }

  const files = await findCases({ caseFile, domain, all: allFlag });
  if (files.length === 0) {
    console.log('No matching test cases found.');
    process.exit(1);
  }

  let totalPass = 0, totalFail = 0, totalSkipped = 0;
  const summary = [];
  const isBatch = !caseFile;  // batch = --domain or --all (multiple files)
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const testCase = mod.default;
    if (!testCase?.id) {
      console.log(`SKIP (no default export): ${file}`);
      continue;
    }
    if (isBatch && testCase.skip_in_batch) {
      console.log(`SKIP (manual-only): ${testCase.id}`);
      totalSkipped++;
      continue;
    }
    const result = await runCase(testCase);
    console.log(formatResult(result));
    console.log('');
    if (result.pass) totalPass++; else totalFail++;
    summary.push({ id: result.id, pass: result.pass });
  }

  console.log('='.repeat(60));
  console.log(`Summary: ${totalPass} PASS / ${totalFail} FAIL / ${files.length} total`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(2);
});
