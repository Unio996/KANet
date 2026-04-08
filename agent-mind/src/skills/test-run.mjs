/**
 * Skill: Test Run
 *
 * Boundary skill — Agent can execute tests across KANet projects
 * and report pass/fail results with diagnostics.
 *
 * Test infrastructure:
 *   - agent-adapter: node:test, 3 test files (~69 cases)
 *   - kasia-console: node:test, 7 test files (~360 cases) + test.sh
 *   - kaspa-scout: node:test configured but no tests yet
 *   - agent-mind / kasia-relay: no tests yet
 *
 * Runs tests with strict timeout to stay within skill budget.
 * Parses node:test TAP-like output for structured results.
 */

import { Skill } from './base.mjs';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECTS_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';

const TEST_PROJECTS = [
  {
    name: 'agent-adapter',
    testDir: 'test',
    testCmd: 'node --test test/*.test.mjs',
    desc: 'Neural bridge — AI provider abstraction',
  },
  {
    name: 'kasia-console',
    testDir: 'test',
    testCmd: 'node --test test/*.test.mjs',
    desc: 'Data hub — API, UI, DB, services',
    needsServer: true,
  },
];

const ALL_PROJECTS = [
  { name: 'agent-mind', desc: 'Soul layer' },
  { name: 'kasia-console', desc: 'Data hub' },
  { name: 'kasia-relay', desc: 'Communication' },
  { name: 'kaspa-scout', desc: 'Perception' },
  { name: 'agent-adapter', desc: 'Neural bridge' },
];

const TEST_KEYWORDS = [
  'test', 'tests', 'run test', 'check test', 'pass', 'fail',
  'spec', 'suite', 'assert', 'coverage',
  '测试', '跑测试', '运行测试', '通过', '失败', '测试结果',
];

const SKILL_TIMEOUT = 8000; // 8s, leaving 2s buffer for registry's 10s limit

export class TestRunSkill extends Skill {
  constructor() {
    super('test_run', 'Run tests across KANet projects and report pass/fail results');
    this._lastMessage = '';
  }

  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';
    return TEST_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const msg = this._lastMessage.toLowerCase();
    const result = { runs: [], inventory: [], noTestProjects: [] };

    // 1. Inventory: scan test files across all projects
    for (const proj of ALL_PROJECTS) {
      const testDir = path.join(PROJECTS_ROOT, proj.name, 'test');
      const srcDir = path.join(PROJECTS_ROOT, proj.name, 'src');
      let testFiles = [];

      try {
        const files = await fs.readdir(testDir);
        testFiles = files.filter(f => f.endsWith('.test.mjs') || f.endsWith('.test.js'));
      } catch {}

      // Also check src/**/*.test.mjs (kaspa-scout pattern)
      if (testFiles.length === 0) {
        testFiles = await this._findTestFiles(srcDir);
      }

      if (testFiles.length > 0) {
        result.inventory.push({ project: proj.name, files: testFiles });
      } else {
        result.noTestProjects.push(proj.name);
      }
    }

    // 2. Determine which projects to actually run
    const targetName = this._matchProject(msg);
    const toRun = targetName
      ? TEST_PROJECTS.filter(p => p.name === targetName)
      : TEST_PROJECTS;

    // 3. Run tests in parallel with timeout
    const runTasks = toRun.map(proj => this._runTests(proj));
    const runs = await Promise.all(runTasks);
    result.runs = runs.filter(Boolean);

    return result;
  }

  formatForBrain(gathered) {
    const sections = ['--- TEST RESULTS ---'];

    // Test run results
    if (gathered.runs.length > 0) {
      for (const run of gathered.runs) {
        const icon = run.exitCode === 0 ? 'PASS' : 'FAIL';
        sections.push(
          `\n=== ${run.project} [${icon}] ===`,
          `Pass: ${run.passed} | Fail: ${run.failed} | Skip: ${run.skipped} | Total: ${run.total}`,
          `Duration: ${run.duration}ms`,
        );
        if (run.timedOut) {
          sections.push('(Test run timed out — partial results shown)');
        }
        if (run.failed > 0 && run.failureDetails.length > 0) {
          sections.push('\nFailure details:');
          for (const detail of run.failureDetails.slice(0, 5)) {
            sections.push(`  - ${detail}`);
          }
        }
        if (run.output) {
          const lines = run.output.split('\n');
          // Show last 30 lines of output (most informative part)
          const tail = lines.slice(-30).join('\n');
          sections.push('\nOutput (tail):', '```', tail, '```');
        }
      }
    } else {
      sections.push('\nNo test runs executed.');
    }

    // Inventory
    if (gathered.inventory.length > 0) {
      sections.push('\n--- TEST INVENTORY ---');
      for (const inv of gathered.inventory) {
        sections.push(`${inv.project}: ${inv.files.length} test file(s) — ${inv.files.join(', ')}`);
      }
    }

    if (gathered.noTestProjects.length > 0) {
      sections.push(`\nNo tests: ${gathered.noTestProjects.join(', ')}`);
    }

    sections.push(
      '',
      'Analyze the test results. If failures exist:',
      '1. Identify the root cause from failure details',
      '2. Suggest specific fixes',
      '3. Note any patterns (flaky tests, env dependencies, missing setup)',
      'If all pass, note test coverage gaps based on the inventory.',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        projectsTested: gathered.runs.map(r => r.project),
        totalPassed: gathered.runs.reduce((s, r) => s + r.passed, 0),
        totalFailed: gathered.runs.reduce((s, r) => s + r.failed, 0),
      },
      instructions: sections.join('\n'),
    };
  }

  // ── Helpers ──

  /** Run tests for a project with timeout */
  _runTests(proj) {
    return new Promise((resolve) => {
      const cwd = path.join(PROJECTS_ROOT, proj.name);
      const startTime = Date.now();

      const child = exec(proj.testCmd, {
        cwd,
        timeout: SKILL_TIMEOUT,
        env: { ...process.env, NODE_NO_WARNINGS: '1', FORCE_COLOR: '0' },
      }, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;
        const output = (stdout || '') + (stderr || '');
        const parsed = this._parseTestOutput(output);

        resolve({
          project: proj.name,
          exitCode: error ? error.code || 1 : 0,
          timedOut: error?.killed || false,
          duration,
          output: output.slice(-3000), // Keep last 3KB
          ...parsed,
        });
      });
    });
  }

  /** Parse node:test output for pass/fail counts */
  _parseTestOutput(output) {
    let passed = 0, failed = 0, skipped = 0;
    const failureDetails = [];

    const lines = output.split('\n');
    for (const line of lines) {
      // node:test TAP output: "# pass N", "# fail N", "# skipped N"
      const passMatch = line.match(/^# pass\s+(\d+)/);
      if (passMatch) { passed = parseInt(passMatch[1], 10); continue; }

      const failMatch = line.match(/^# fail\s+(\d+)/);
      if (failMatch) { failed = parseInt(failMatch[1], 10); continue; }

      const skipMatch = line.match(/^# skipped\s+(\d+)/);
      if (skipMatch) { skipped = parseInt(skipMatch[1], 10); continue; }

      // Fallback: count "ok" and "not ok" lines
      if (line.match(/^ok\s+\d+/)) passed++;
      if (line.match(/^not ok\s+\d+/)) {
        failed++;
        failureDetails.push(line.trim().slice(0, 200));
      }

      // Capture assertion errors
      if (line.includes('AssertionError') || line.includes('Error:')) {
        failureDetails.push(line.trim().slice(0, 200));
      }
    }

    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
      failureDetails,
    };
  }

  /** Find .test.mjs files recursively in src/ */
  async _findTestFiles(dir, depth = 3) {
    const found = [];
    if (depth <= 0) return found;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile() && (entry.name.endsWith('.test.mjs') || entry.name.endsWith('.test.js'))) {
          found.push(entry.name);
        }
        if (entry.isDirectory()) {
          found.push(...await this._findTestFiles(full, depth - 1));
        }
      }
    } catch {}
    return found;
  }

  /** Match a specific project from message */
  _matchProject(msg) {
    for (const proj of TEST_PROJECTS) {
      if (msg.includes(proj.name) || msg.includes(proj.name.replace('-', ' '))) {
        return proj.name;
      }
    }
    return null; // Run all
  }
}
