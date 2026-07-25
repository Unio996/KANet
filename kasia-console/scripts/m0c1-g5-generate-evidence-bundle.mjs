// J2 2026-07-25 — B6: 不可变 evidence bundle 生成器(Codex RESPONSE-20260725-G5-V2-COMMITTED-
// PARTIAL-CODEX-REVIEW B6, team 三方审 GREEN: 不纳 M0a 治理, 只读 git+regression log+content
// digest, 无 DB import, 不碰 money-path 执行路径)。
//
// Codex 原文: "Do not infer GREEN from comments or design notes"——散落在多个 commit message/
// pending-review doc 里的声明, 没法一次性验证"这个 commit 到底测了什么/测出了什么结果"。本
// 脚本在 regression 套件真跑出全绿之后手动调用一次, 生成的 JSON 连同 regression 自己写的
// logs/test-runs/*-latest.json 一起提交, Issue #5 的 review request 直接引用这个文件路径。
//
// 用法(cwd=D:/kanet-tn12, 必须在干净 checkout 里跑, regression 全绿之后):
//   node kasia-console/scripts/m0c1-g5-generate-evidence-bundle.mjs > docs/evidence/<date>-g5-v2-bX-evidence.json

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../src/lib/repo-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRepoRoot(HERE);

// G5 v2 + B1-B6 加固这一轮涉及的完整文件集(不是靠 git diff 猜"改了什么", 是显式列出——跟
// M0a manifest 追踪 writer 文件同一个哲学: 显式清单比"自动推断改动范围"更不容易漏/更可审)。
const TRACKED_PATHS = [
  'kasia-console/src/api/health.js',
  'kasia-console/src/db/client.js',
  'kasia-console/src/lib/repo-root.mjs',
  'kasia-console/src/lib/load-bearing-digest.mjs',
  'kasia-console/src/lib/runtime-scope-dirs.mjs',
  'kasia-console/src/lib/admin-secret-tier.mjs',
  'kasia-console/scripts/m0c1-g5-journal-reconcile.mjs',
  'kasia-console/test-framework/cases/m0c1-gate/g5-pilot-custodial-real-chain-smoke.mjs',
  'kasia-console/test-framework/cases/m0c1-gate/g5-real-chain-smoke-regression.mjs',
  'kasia-console/test-framework/cases/m0c1-gate/runtime-identity-endpoint-regression.mjs',
  'scripts/m0a-lib.mjs',
  'scripts/m0a-exception-manifest.json',
];

const REGRESSION_LOGS = [
  'logs/test-runs/g5-real-chain-smoke-regression-latest.json',
  'logs/test-runs/runtime-identity-endpoint-regression-latest.json',
];

function sha256File(absPath) {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function readRegressionLog(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) return { file: relPath, present: false };
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'));
    return { file: relPath, present: true, source_commit: parsed.source_commit ?? null, summary: parsed.summary ?? null };
  } catch (e) {
    return { file: relPath, present: true, parse_error: e.message };
  }
}

function main() {
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dirtyCheck = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();

  const contentDigests = {};
  for (const relPath of TRACKED_PATHS) {
    const abs = path.join(ROOT, relPath);
    contentDigests[relPath] = existsSync(abs) ? sha256File(abs) : null;
  }

  const bundle = {
    generated_at: new Date().toISOString(),
    source_commit: sourceCommit,
    working_tree_dirty_at_generation: dirtyCheck !== '',
    tracked_paths: TRACKED_PATHS,
    content_digests: contentDigests,
    m0a_manifest_entries_referenced: [
      'G5-realchain-smoke-dbreadonly',
      'TFW-g5-real-chain-smoke-regression',
    ],
    regression_logs: REGRESSION_LOGS.map(readRegressionLog),
  };

  process.stdout.write(JSON.stringify(bundle, null, 2) + '\n');
}

main();
