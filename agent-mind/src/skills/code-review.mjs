/**
 * Skill: Code Review
 *
 * Boundary skill — Agent reviews code changes across KANet projects.
 * Different from code_sense (reads files): this skill focuses on
 * analyzing diffs, identifying issues, and suggesting improvements.
 *
 * Data sources:
 *   - git diff (unstaged + staged changes)
 *   - git log --stat (recent commit summaries)
 *   - Targeted file reading for changed files context
 *
 * Activates when messages mention review, optimize, improve, quality, etc.
 */

import { Skill } from './base.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECTS_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const PROJECTS = [
  { name: 'agent-mind', desc: 'Soul layer — five kernels, context builder, skills' },
  { name: 'kasia-console', desc: 'Data hub — API, UI, DB, services' },
  { name: 'kasia-relay', desc: 'Communication — on-chain message relay' },
  { name: 'kaspa-scout', desc: 'Perception — chain protocol scanner' },
  { name: 'agent-adapter', desc: 'Neural bridge — AI provider abstraction' },
  { name: 'kas-market-maker', desc: 'Independent KAS market maker — first KANet external client' },
  { name: 'docs', desc: 'Project documentation, designs, reports' },
];

const REVIEW_KEYWORDS = [
  'review', 'optimize', 'improve', 'quality', 'issue', 'problem',
  'refactor', 'clean', 'debt', 'smell', 'lint', 'check code',
  'what changed', 'diff', 'changes', 'compare',
  '审查', '优化', '改进', '质量', '问题', '重构', '清理',
  '变更', '改动', '看看改了', '有什么变化',
];

const MAX_DIFF_LINES = 200;
const MAX_LOG_ENTRIES = 10;

export class CodeReviewSkill extends Skill {
  constructor() {
    super('code_review', 'Review code changes across KANet — diffs, recent commits, quality analysis');
    this._lastMessage = '';
  }

  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';
    return REVIEW_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const msg = this._lastMessage.toLowerCase();
    const result = { diffs: [], logs: [], stats: { totalChanged: 0, additions: 0, deletions: 0 } };

    // Determine which projects to review (specific or all)
    const targetProjects = this._matchProjects(msg);

    const tasks = targetProjects.map(async (proj) => {
      const cwd = path.join(PROJECTS_ROOT, proj.name);

      // 1. Git diff (unstaged + staged combined)
      const diff = this._exec('git diff HEAD 2>/dev/null || git diff 2>/dev/null', cwd);
      if (diff) {
        const lines = diff.split('\n');
        const adds = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
        const dels = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
        result.diffs.push({
          project: proj.name,
          diff: lines.slice(0, MAX_DIFF_LINES).join('\n'),
          truncated: lines.length > MAX_DIFF_LINES,
          additions: adds,
          deletions: dels,
        });
        result.stats.totalChanged++;
        result.stats.additions += adds;
        result.stats.deletions += dels;
      }

      // 2. Recent commits with stats
      const log = this._exec(
        `git log --oneline --stat -${MAX_LOG_ENTRIES} 2>/dev/null`,
        cwd
      );
      if (log) {
        result.logs.push({ project: proj.name, log });
      }
    });

    await Promise.all(tasks);

    // 3. If no uncommitted diffs, get diff between last 2 commits for active projects
    if (result.diffs.length === 0) {
      for (const proj of targetProjects) {
        const cwd = path.join(PROJECTS_ROOT, proj.name);
        const lastDiff = this._exec('git diff HEAD~1..HEAD --stat 2>/dev/null', cwd);
        if (lastDiff) {
          const fullDiff = this._exec('git diff HEAD~1..HEAD 2>/dev/null', cwd);
          if (fullDiff) {
            const lines = fullDiff.split('\n');
            result.diffs.push({
              project: proj.name,
              diff: lines.slice(0, MAX_DIFF_LINES).join('\n'),
              truncated: lines.length > MAX_DIFF_LINES,
              additions: lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length,
              deletions: lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length,
              isLastCommit: true,
            });
          }
        }
      }
    }

    return result;
  }

  formatForBrain(gathered) {
    const sections = ['--- CODE REVIEW INTELLIGENCE ---'];

    // Summary
    if (gathered.stats.totalChanged > 0) {
      sections.push(
        `\nUncommitted changes in ${gathered.stats.totalChanged} project(s): +${gathered.stats.additions} -${gathered.stats.deletions}`
      );
    } else if (gathered.diffs.length > 0) {
      sections.push('\nNo uncommitted changes. Showing last commit diffs:');
    } else {
      sections.push('\nNo code changes detected across all projects.');
    }

    // Diffs
    for (const d of gathered.diffs) {
      const label = d.isLastCommit ? ' (last commit)' : ' (uncommitted)';
      sections.push(
        `\n=== ${d.project}${label} (+${d.additions} -${d.deletions}) ===`,
        '```diff',
        d.diff,
        '```',
      );
      if (d.truncated) sections.push(`(truncated — first ${MAX_DIFF_LINES} lines shown)`);
    }

    // Recent commit history
    if (gathered.logs.length > 0) {
      sections.push('\n--- RECENT COMMIT HISTORY ---');
      for (const l of gathered.logs) {
        sections.push(`\n${l.project}:`, l.log);
      }
    }

    sections.push(
      '',
      'Review these changes. Focus on:',
      '1. Bugs or logic errors',
      '2. Security concerns (injection, leaks, missing validation)',
      '3. Performance issues (N+1, unnecessary re-renders, blocking calls)',
      '4. Code style consistency with the rest of the project',
      '5. Missing error handling at system boundaries',
      'Be specific: cite file names, line context, and concrete suggestions.',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        projectsWithDiffs: gathered.diffs.map(d => d.project),
        additions: gathered.stats.additions,
        deletions: gathered.stats.deletions,
      },
      instructions: sections.join('\n'),
    };
  }

  // ── Helpers ──

  /** Determine which projects to focus on */
  _matchProjects(msg) {
    const matched = PROJECTS.filter(p => msg.includes(p.name.replace('-', ' ')) || msg.includes(p.name));
    return matched.length > 0 ? matched : PROJECTS;
  }

  /** Safe exec with timeout */
  _exec(cmd, cwd) {
    try {
      return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000 }).trim() || null;
    } catch {
      return null;
    }
  }
}
