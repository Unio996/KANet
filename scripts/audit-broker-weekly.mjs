#!/usr/bin/env node
// audit-broker-weekly.mjs — 整合 #5+#6+#7 weekly audit cron (J2 propose 539a35e8, NWT 综合 a874c0d8)
//
// 三方 v2.2 convergence (dev-coord broadcast a874c0d8): 替代原 propose 的 3 个独立 cron:
//   #5 audit-broker-anti-patterns.mjs (broker code anti-pattern reintroduce 扫)
//   #6 dev_audit 表 (撤回, J2 git log audit 替代)
//   #7 audit-advisory-coverage.mjs (advisory commit 漏 enforce 扫)
// 整合到本 1 cron, 减 ops 复杂度 + maintenance 一处.
//
// Audit scope (4 dimension):
//   A. broker code 全 anti-pattern reintroduce (lint-kanet.mjs full scan, 统计 violations per rule)
//   B. git log coord-ack 跳率 + acknowledged 漏率 (规 13 / 规 10 enforce gap)
//   C. critical 8 file change 漏 acknowledged: T-X-X surfaced
//   D. emergency-Z 滥用 (24h ≥3 = team review trigger, 规 13 emergency SOP 第 4 条)
//
// 用法:
//   node scripts/audit-broker-weekly.mjs              # 跑全 audit, 7 天 commit window
//   node scripts/audit-broker-weekly.mjs --days=14    # 自定 window
//   node scripts/audit-broker-weekly.mjs --json       # JSON 输出 (cron alert 用)
//
// Cron schedule: 周级跑, FAIL 触发三方 + Owner alert (跟 test-cron 同 channel).

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const a = argv.find(a => a.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const DAYS = parseInt(arg('days', '7'), 10);
const JSON_OUT = hasFlag('json');

const CRITICAL_FILES = [
  'kasia-console/src/services/broker-llm-agent.js',
  'kasia-console/src/services/broker-state-authority.js',
  'kasia-console/src/services/broker-buy-handler.js',
  'kasia-console/src/services/broker-sell-handler.js',
  'kasia-console/src/services/broker-action-queue.js',
  'kasia-console/src/services/broker-cancel-refund.js',
  'kasia-console/src/services/broker-intake-watcher.js',
  'kasia-relay/src/lib/transaction.mjs',
];

const ANTI_PATTERN_REGEX = 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+|撤回|灾难|不准|拒绝';

// Bootstrap timestamp gate (COLLAB-REFORM Bootstrap 段). audit script 只扫 hook ship 后的 commit.
// 用 date timestamp 替 commit hash — hash 在 dual-host setup 下 sync gap (本机可能没 J1 ship hash).
// Default gate = 2026-04-28T10:00:00Z (UTC) ≈ J1 hook first ship 时段. Pre-gate commits 视为 historical.
// Override 用 --since="YYYY-MM-DDTHH:MM:SSZ" flag.
const BOOTSTRAP_GATE_DATE = arg('since', '2026-04-28T10:00:00Z');

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
const safe = (cmd, fb = '') => { try { return sh(cmd); } catch { return fb; } };

const findings = {
  window_days: DAYS,
  bootstrap_gate: BOOTSTRAP_GATE_DATE,
  A_anti_pattern_reintroduce: { violations: [], pass: true },
  B_coord_ack_gaps: { commits: [], total_audited: 0, gap_count: 0 },
  C_acknowledged_gaps: { commits: [], total_critical_changed: 0, gap_count: 0 },
  D_emergency_abuse: { count_24h: 0, count_window: 0, threshold_24h: 3, abuse: false },
};

// === Dimension A: anti-pattern reintroduce (lint-kanet full scan) ===
try {
  const lintOut = safe(`node scripts/lint-kanet.mjs`, '');
  if (lintOut.includes('violations across')) {
    const lines = lintOut.split('\n');
    const violLine = lines.find(l => l.includes('violations across'));
    findings.A_anti_pattern_reintroduce.violations.push(violLine?.trim() || '');
    findings.A_anti_pattern_reintroduce.pass = false;
  }
} catch (e) {
  findings.A_anti_pattern_reintroduce.violations.push(`lint script error: ${e.message}`);
}

// === Dimension B: coord-ack 跳率 + acknowledged 漏率 (git log) ===
// Both DAYS window AND bootstrap gate (date) — take later of two as effective start.
const daysAgoSec = Math.floor(Date.now() / 1000) - DAYS * 86400;
const gateSec = Math.floor(new Date(BOOTSTRAP_GATE_DATE).getTime() / 1000);
const effectiveSinceSec = Math.max(daysAgoSec, gateSec);
const sinceArg = `--since="@${effectiveSinceSec}"`;
const commitsRaw = safe(`git log ${sinceArg} --format="%H|%s"`, '');
const commits = commitsRaw.split('\n').filter(Boolean).map(line => {
  const [hash, ...subjectParts] = line.split('|');
  return { hash, subject: subjectParts.join('|') };
});

findings.B_coord_ack_gaps.total_audited = commits.length;

for (const c of commits) {
  // Skip merge commits (auto-generated msg)
  const fullMsg = safe(`git log -1 --format="%B" ${c.hash}`, '');
  if (/^Merge\b/m.test(fullMsg)) continue;

  // Check coord-ack: present (regex align J1 commit-msg hook c2c81cd60)
  const hasCoordAck = /^coord-ack:\s*(?:[a-f0-9]+|emergency-Z[a-zA-Z0-9-]+)/m.test(fullMsg);
  const hasBootstrap = /^bootstrap-exception:/m.test(fullMsg);
  if (!hasCoordAck && !hasBootstrap) {
    findings.B_coord_ack_gaps.commits.push({ hash: c.hash.slice(0, 9), subject: c.subject });
    findings.B_coord_ack_gaps.gap_count++;
  }

  // Check critical 8 file change → acknowledged: required
  const changedFiles = safe(`git diff-tree --no-commit-id --name-only -r ${c.hash}`, '').split('\n');
  const criticalChanged = changedFiles.filter(f => CRITICAL_FILES.includes(f));
  if (criticalChanged.length > 0) {
    findings.C_acknowledged_gaps.total_critical_changed++;
    // Check anti-pattern grep surface in changed critical files
    let surfaced = false;
    for (const cf of criticalChanged) {
      const grepOut = safe(`git show ${c.hash}:${cf} | grep -nE '${ANTI_PATTERN_REGEX}'`, '');
      if (grepOut.length > 0) { surfaced = true; break; }
    }
    if (surfaced) {
      const hasAcknowledged = /^acknowledged:\s*\S/m.test(fullMsg);
      if (!hasAcknowledged && !hasBootstrap) {
        findings.C_acknowledged_gaps.commits.push({
          hash: c.hash.slice(0, 9),
          subject: c.subject,
          critical_files: criticalChanged,
        });
        findings.C_acknowledged_gaps.gap_count++;
      }
    }
  }

  // Check emergency-Z usage
  const emergencyMatch = fullMsg.match(/^coord-ack:\s*emergency-Z(\S+)/m);
  if (emergencyMatch) {
    findings.D_emergency_abuse.count_window++;
    // Check if within last 24h
    const commitTime = parseInt(safe(`git log -1 --format="%ct" ${c.hash}`, '0'), 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - commitTime <= 86400) findings.D_emergency_abuse.count_24h++;
  }
}

findings.D_emergency_abuse.abuse = findings.D_emergency_abuse.count_24h >= findings.D_emergency_abuse.threshold_24h;

// === Output ===
if (JSON_OUT) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  console.log(`\n[audit-broker-weekly] window: last ${DAYS} days, bootstrap gate: ${BOOTSTRAP_GATE_DATE}\n`);
  console.log(`[A] Anti-pattern reintroduce (lint-kanet full scan):`);
  console.log(`    ${findings.A_anti_pattern_reintroduce.pass ? '✓ pass' : '✗ FAIL'}`);
  for (const v of findings.A_anti_pattern_reintroduce.violations) console.log(`    ${v}`);

  console.log(`\n[B] coord-ack gaps (规 13 enforce):`);
  console.log(`    audited ${findings.B_coord_ack_gaps.total_audited} commits, gap = ${findings.B_coord_ack_gaps.gap_count}`);
  for (const c of findings.B_coord_ack_gaps.commits.slice(0, 10)) {
    console.log(`    ${c.hash} ${c.subject}`);
  }
  if (findings.B_coord_ack_gaps.commits.length > 10) console.log(`    ... ${findings.B_coord_ack_gaps.commits.length - 10} more`);

  console.log(`\n[C] acknowledged gaps (规 10 critical 8 file enforce):`);
  console.log(`    critical changed = ${findings.C_acknowledged_gaps.total_critical_changed}, gap = ${findings.C_acknowledged_gaps.gap_count}`);
  for (const c of findings.C_acknowledged_gaps.commits.slice(0, 10)) {
    console.log(`    ${c.hash} ${c.subject}`);
    console.log(`        files: ${c.critical_files.join(', ')}`);
  }

  console.log(`\n[D] emergency-Z usage (规 13 emergency SOP 第 4 条):`);
  console.log(`    count_24h = ${findings.D_emergency_abuse.count_24h}, threshold = ${findings.D_emergency_abuse.threshold_24h}`);
  console.log(`    count_${DAYS}day = ${findings.D_emergency_abuse.count_window}`);
  console.log(`    ${findings.D_emergency_abuse.abuse ? '✗ ABUSE TRIGGER (team review)' : '✓ within threshold'}`);

  console.log(`\n--- summary ---`);
  const overallPass = findings.A_anti_pattern_reintroduce.pass &&
                       findings.B_coord_ack_gaps.gap_count === 0 &&
                       findings.C_acknowledged_gaps.gap_count === 0 &&
                       !findings.D_emergency_abuse.abuse;
  console.log(`audit ${overallPass ? '✓ pass' : '✗ FAIL — alert dev-coord'}`);
}

const overallPass = findings.A_anti_pattern_reintroduce.pass &&
                     findings.B_coord_ack_gaps.gap_count === 0 &&
                     findings.C_acknowledged_gaps.gap_count === 0 &&
                     !findings.D_emergency_abuse.abuse;
process.exit(overallPass ? 0 : 1);
