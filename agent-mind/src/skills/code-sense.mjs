/**
 * Skill: Code Sense
 *
 * First "boundary skill" — bridges Agent Mind with the KANet codebase.
 * Gives agents the ability to read, understand, and analyze code files.
 *
 * Activates when messages mention code, files, reviews, bugs, etc.
 * Reads relevant files from project directories and injects content
 * into the Agent's context for analysis.
 */

import { Skill } from './base.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

const CODE_KEYWORDS = [
  'code', 'file', 'review', 'bug', 'check', 'read', 'look',
  'function', 'class', 'error', 'fix', 'refactor', 'test',
  'src/', '.js', '.mjs', '.eta', '.json', '.md',
  '代码', '文件', '检查', '审查', '看看', '读', '函数', '错误', '修复',
  'git', 'change', 'diff', 'commit', '改了', '修改', '变更',
];

const MAX_FILES = 3;
const MAX_LINES = 150;

export class CodeSenseSkill extends Skill {
  constructor() {
    super('code_sense', 'Read and analyze KANet codebase — files, structure, recent changes');
    this._lastMessage = '';
  }

  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    this._lastMessage = context._inputMessage || '';
    return CODE_KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const msg = this._lastMessage;
    const msgLower = msg.toLowerCase();
    const result = { files: [], structure: null, gitLog: null };

    // 1. Find and read files mentioned in the message
    const filePaths = await this._findFiles(msg);
    for (const fp of filePaths.slice(0, MAX_FILES)) {
      try {
        const content = await fs.readFile(fp, 'utf-8');
        const lines = content.split('\n');
        const truncated = lines.length > MAX_LINES;
        result.files.push({
          path: fp.replace(/\\/g, '/'),
          lines: lines.length,
          truncated,
          content: lines.slice(0, MAX_LINES).join('\n'),
        });
      } catch {}
    }

    // 2. Project structure (when no specific files found, or explicitly asked)
    if (result.files.length === 0 || msgLower.match(/structure|overview|project|all/i)) {
      result.structure = await this._getStructure();
    }

    // 3. Recent git changes (when relevant)
    if (msgLower.match(/git|change|diff|commit|recent|history/i)) {
      result.gitLog = await this._getGitLog();
    }

    return result;
  }

  formatForBrain(gathered) {
    const sections = ['--- CODE INTELLIGENCE ---'];

    // File contents
    if (gathered.files.length > 0) {
      for (const f of gathered.files) {
        sections.push(
          `\nFILE: ${f.path} (${f.lines} lines${f.truncated ? ', first ' + MAX_LINES + ' shown' : ''})`,
          '```',
          f.content,
          '```',
        );
      }
    }

    // Project structure
    if (gathered.structure) {
      sections.push('\n--- PROJECT STRUCTURE ---');
      for (const [proj, info] of Object.entries(gathered.structure)) {
        sections.push(`\n${proj} — ${info.desc}`);
        info.files.forEach(f => sections.push(`  ${f}`));
      }
    }

    // Git log
    if (gathered.gitLog) {
      sections.push('\n--- RECENT CHANGES ---');
      sections.push(gathered.gitLog);
    }

    if (sections.length <= 1) {
      sections.push('No code files matched. Mention specific filenames (e.g. chat.js, mind.mjs) to read them.');
    }

    sections.push('', 'Analyze the code. Be specific about line numbers, patterns, and issues.');

    return {
      name: this.name,
      description: this.description,
      data: { fileCount: gathered.files.length, hasStructure: !!gathered.structure },
      instructions: sections.join('\n'),
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Extract file references from message and resolve to real paths */
  async _findFiles(msg) {
    const found = [];

    // Match file-like patterns: word.ext, path/to/file.ext
    const filePatterns = msg.match(/[\w\-\/\\]+\.(?:js|mjs|eta|json|ts|css|html|sh|md|txt)/gi) || [];

    // Also check quoted paths
    const quoted = msg.match(/['"]([^'"]+\.\w+)['"]/g) || [];
    quoted.forEach(q => filePatterns.push(q.replace(/['"]/g, '')));

    const unique = [...new Set(filePatterns.map(p => p.replace(/\\/g, '/')))];

    for (const pattern of unique) {
      if (found.length >= MAX_FILES) break;
      const resolved = await this._resolveFile(pattern);
      if (resolved && !found.includes(resolved)) found.push(resolved);
    }

    return found;
  }

  /** Try to resolve a file pattern to an actual path across all projects */
  async _resolveFile(pattern) {
    const basename = path.basename(pattern);

    for (const proj of PROJECTS) {
      const projRoot = path.join(PROJECTS_ROOT, proj.name);

      // Try exact path
      const direct = [
        path.join(projRoot, pattern),
        path.join(projRoot, 'src', pattern),
      ];

      for (const candidate of direct) {
        try {
          await fs.access(candidate);
          return candidate;
        } catch {}
      }

      // Recursive search by filename (src/ first, then project root)
      if (!pattern.includes('/')) {
        const match = await this._searchFile(path.join(projRoot, 'src'), basename, 4);
        if (match) return match;
        const rootMatch = await this._searchFile(projRoot, basename, 2);
        if (rootMatch) return rootMatch;
      }
    }

    return null;
  }

  /** Recursively search for a filename in a directory */
  async _searchFile(dir, filename, depth) {
    if (depth <= 0) return null;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === filename) return full;
        if (entry.isDirectory()) {
          const found = await this._searchFile(full, filename, depth - 1);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }

  /** Get compact project structure (2 levels deep under src/ or root) */
  async _getStructure() {
    const structure = {};
    for (const proj of PROJECTS) {
      const srcDir = path.join(PROJECTS_ROOT, proj.name, 'src');
      const rootDir = path.join(PROJECTS_ROOT, proj.name);
      try {
        const files = await this._listTree(srcDir, 2);
        structure[proj.name] = { desc: proj.desc, files };
      } catch {
        try {
          const files = await this._listTree(rootDir, 2);
          structure[proj.name] = { desc: proj.desc, files };
        } catch {
          structure[proj.name] = { desc: proj.desc, files: ['(not accessible)'] };
        }
      }
    }
    return structure;
  }

  /** List directory tree with indentation */
  async _listTree(dir, maxDepth, prefix = '') {
    const result = [];
    if (maxDepth <= 0) return result;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      // Directories first, then files
      const sorted = entries
        .filter(e => e.name !== 'node_modules' && e.name !== '.git')
        .sort((a, b) => (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) || a.name.localeCompare(b.name));

      for (const entry of sorted) {
        if (entry.isDirectory()) {
          result.push(prefix + entry.name + '/');
          if (maxDepth > 1) {
            const children = await this._listTree(path.join(dir, entry.name), maxDepth - 1, prefix + '  ');
            result.push(...children);
          }
        } else {
          result.push(prefix + entry.name);
        }
      }
    } catch {}
    return result;
  }

  /** Get recent git log from all projects */
  async _getGitLog() {
    const logs = [];
    for (const proj of PROJECTS) {
      try {
        const log = execSync(
          'git log --oneline -5 2>/dev/null',
          { cwd: path.join(PROJECTS_ROOT, proj.name), encoding: 'utf-8', timeout: 3000 }
        ).trim();
        if (log) logs.push(`${proj.name}:\n${log}`);
      } catch {}
    }
    return logs.length > 0 ? logs.join('\n\n') : null;
  }
}
