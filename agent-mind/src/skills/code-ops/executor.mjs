/**
 * executor.mjs — Tool execution engine for code-ops.
 *
 * 5 tools: READ_FILE, SEARCH_CODE, HTTP_REQUEST, WRITE_FILE, RUN_COMMAND
 * Sandbox: path whitelist, command whitelist, blocked patterns, timeout, output cap.
 * Confirmation: L4 write/command tools go through pending confirmation.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';

// Load tool definitions
const require = createRequire(import.meta.url);
const toolsDef = require('./tools.json');

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const ALLOWED_ROOTS = [KANET_ROOT, '/tmp', process.env.TEMP || '/tmp'];
const COMMAND_TIMEOUT = toolsDef.sandbox.command_timeout_ms || 30000;
const OUTPUT_MAX = toolsDef.sandbox.output_max_bytes || 10240;
const WHITELIST_CMDS = toolsDef.whitelist_commands || [];
const CURL_WRITE_FLAGS = toolsDef.curl_write_flags || [];
const BLOCKED_PATTERNS = toolsDef.blocked_patterns || [];

// Pending confirmations (keyed by requestId)
const _pending = new Map();

function log(...args) {
  console.log(new Date().toISOString(), '[code-ops]', ...args);
}

// ── Path Sandbox ──────────────────────────────────────────────────────────

function _resolvePath(filePath, writeMode = false) {
  if (!filePath) throw new Error('Path is required');
  const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(KANET_ROOT, filePath);
  const normalized = resolved.replace(/\\/g, '/');
  // Write mode: strict whitelist. Read mode: allow any local path.
  if (writeMode) {
    const allowed = ALLOWED_ROOTS.some(root => normalized.startsWith(root.replace(/\\/g, '/')));
    if (!allowed) throw new Error(`Write path outside allowed roots: ${filePath}`);
  }
  return resolved;
}

// ── Command Sandbox ──────────────────────────────────────────────────────

function _isBlocked(cmd) {
  const lower = cmd.toLowerCase();
  return BLOCKED_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

function _isWhitelisted(cmd) {
  const trimmed = cmd.trim();
  const firstWord = trimmed.split(/\s+/)[0];

  // Check if the base command is in whitelist
  const baseMatch = WHITELIST_CMDS.some(w => {
    if (w.includes(' ')) {
      // Multi-word whitelist entry (e.g. "node --check"): prefix match
      return trimmed.startsWith(w);
    }
    return firstWord === w;
  });

  if (!baseMatch) return false;

  // Special curl validation: check for write flags
  if (firstWord === 'curl') {
    return !_curlHasWriteFlags(trimmed);
  }

  return true;
}

function _curlHasWriteFlags(cmd) {
  const lower = cmd.toLowerCase();
  return CURL_WRITE_FLAGS.some(flag => {
    // Match flag as a standalone argument (not substring of another arg)
    const flagLower = flag.toLowerCase();
    // Check for exact flag or flag= pattern
    const regex = new RegExp(`(^|\\s)${flagLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|=|$)`, 'i');
    return regex.test(cmd);
  });
}

// ── Tool Executors ──────────────────────────────────────────────────────

async function _execReadFile(params) {
  const filePath = _resolvePath(params.path);
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const limit = parseInt(params.limit) || 200;
  let offset = parseInt(params.offset) || 0;

  // Negative offset = tail (read last N lines)
  if (offset < 0) {
    offset = Math.max(0, lines.length + offset);
  }

  const slice = lines.slice(offset, offset + limit);
  return {
    ok: true,
    path: params.path,
    totalLines: lines.length,
    offset,
    linesReturned: slice.length,
    content: slice.map((l, i) => `${offset + i + 1}\t${l}`).join('\n'),
  };
}

async function _execSearchCode(params) {
  if (!params.pattern) throw new Error('pattern is required');
  const searchPath = _resolvePath(params.path || '.', false);
  const glob = params.glob || '*';

  // Use grep via shell (ripgrep if available, fallback to grep)
  let cmd = `grep -rn --include="${glob}" "${params.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;
  try {
    cmd = `rg -n --glob "${glob}" "${params.pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`;
  } catch {}

  try {
    const output = execSync(cmd, {
      timeout: COMMAND_TIMEOUT,
      encoding: 'utf-8',
      maxBuffer: OUTPUT_MAX,
      cwd: KANET_ROOT,
    });
    const lines = output.trim().split('\n').filter(Boolean);
    return { ok: true, pattern: params.pattern, matches: lines.length, results: output.trim().slice(0, OUTPUT_MAX) };
  } catch (e) {
    if (e.status === 1) return { ok: true, pattern: params.pattern, matches: 0, results: '' }; // grep no match
    return { ok: false, error: e.message?.slice(0, 200) };
  }
}

async function _execHttpRequest(params) {
  const method = (params.method || 'GET').toUpperCase();
  const url = params.url;
  if (!url) throw new Error('url is required');

  const fetchOpts = {
    method,
    signal: AbortSignal.timeout(15000),
  };

  if (params.headers) {
    try { fetchOpts.headers = JSON.parse(params.headers); } catch {}
  }
  if (!fetchOpts.headers) fetchOpts.headers = {};
  if (params.body && method !== 'GET') {
    fetchOpts.body = params.body;
    if (!fetchOpts.headers['Content-Type']) fetchOpts.headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    body: text.slice(0, OUTPUT_MAX),
  };
}

async function _execWriteFile(params) {
  const filePath = _resolvePath(params.path, true);

  // Edit mode (old_string → new_string)
  if (params.old_string && params.new_string !== undefined) {
    let existing;
    try { existing = await readFile(filePath, 'utf-8'); } catch { throw new Error(`File not found: ${params.path}`); }
    if (!existing.includes(params.old_string)) {
      return { ok: false, error: 'old_string not found in file', path: params.path };
    }
    const updated = existing.replace(params.old_string, params.new_string);
    await writeFile(filePath, updated, 'utf-8');
    return {
      ok: true,
      mode: 'edit',
      path: params.path,
      diff: `- ${params.old_string.slice(0, 200)}\n+ ${params.new_string.slice(0, 200)}`,
    };
  }

  // Full write mode
  if (params.content !== undefined) {
    await writeFile(filePath, params.content, 'utf-8');
    return { ok: true, mode: 'write', path: params.path, bytes: params.content.length };
  }

  return { ok: false, error: 'Either content or old_string+new_string required' };
}

function _execRunCommand(params) {
  if (!params.cmd) throw new Error('cmd is required');
  const cmd = params.cmd.trim();

  // Blocked check
  if (_isBlocked(cmd)) {
    return { ok: false, error: `Blocked: dangerous command pattern detected`, cmd };
  }

  const cwd = params.cwd ? _resolvePath(params.cwd) : KANET_ROOT;
  const timeout = Math.min(parseInt(params.timeout) || COMMAND_TIMEOUT, COMMAND_TIMEOUT);

  try {
    const output = execSync(cmd, {
      timeout,
      encoding: 'utf-8',
      maxBuffer: OUTPUT_MAX,
      cwd,
      shell: true,
    });
    return { ok: true, cmd, output: output.slice(0, OUTPUT_MAX) };
  } catch (e) {
    return {
      ok: false,
      cmd,
      exitCode: e.status,
      error: (e.stderr || e.message || '').slice(0, 500),
      output: (e.stdout || '').slice(0, OUTPUT_MAX),
    };
  }
}

// ── Main Dispatch ──────────────────────────────────────────────────────

/**
 * Execute a tool action.
 *
 * @param {string} toolName — READ_FILE | SEARCH_CODE | HTTP_REQUEST | WRITE_FILE | RUN_COMMAND
 * @param {object} params
 * @param {string} currentLayer — L1-L4
 * @param {boolean} isSelfHealing
 * @returns {Promise<{ ok, needsConfirm?, result? }>}
 */
export async function executeTool(toolName, params, currentLayer, isSelfHealing = false) {
  const name = toolName.toUpperCase();

  // Layer gate
  const toolDef = toolsDef.tools.find(t => t.name === name || t.name === name.replace('_GET', '').replace('_MUTATE', ''));
  if (!toolDef) return { ok: false, error: `Unknown tool: ${toolName}` };

  // L3 tools
  if (['READ_FILE', 'SEARCH_CODE'].includes(name)) {
    if (currentLayer !== 'L3' && currentLayer !== 'L4') {
      return { ok: false, error: `${name} requires L3+, current: ${currentLayer}` };
    }
  }

  // HTTP: split by method
  if (name === 'HTTP_REQUEST') {
    const method = (params.method || 'GET').toUpperCase();
    if (method === 'GET') {
      if (currentLayer !== 'L3' && currentLayer !== 'L4') {
        return { ok: false, error: 'HTTP GET requires L3+' };
      }
    } else {
      if (currentLayer !== 'L4') return { ok: false, error: `HTTP ${method} requires L4` };
      if (isSelfHealing) return { ok: false, error: 'Mutating HTTP blocked in self-healing mode' };
      // Needs confirmation
      return { ok: false, needsConfirm: true, tool: name, params, summary: `HTTP ${method} ${params.url}` };
    }
  }

  // L4 tools
  if (name === 'WRITE_FILE') {
    if (currentLayer !== 'L4') return { ok: false, error: 'WRITE_FILE requires L4' };
    if (isSelfHealing) return { ok: false, error: 'WRITE_FILE blocked in self-healing mode' };
    // Needs confirmation (show diff)
    return { ok: false, needsConfirm: true, tool: name, params, summary: `Write ${params.path}` };
  }

  if (name === 'RUN_COMMAND') {
    // Whitelisted read-only commands allowed at L3+, others require L4
    if (currentLayer !== 'L4' && currentLayer !== 'L3') return { ok: false, error: 'RUN_COMMAND requires L3+' };
    if (currentLayer === 'L3' && !_isWhitelisted((params.cmd || '').trim())) {
      return { ok: false, error: 'Only whitelisted read-only commands at L3. Upgrade to L4 for others.' };
    }
    const cmd = (params.cmd || '').trim();
    if (_isBlocked(cmd)) return { ok: false, error: 'Blocked: dangerous command' };

    // Self-healing: only whitelisted commands
    if (isSelfHealing && !_isWhitelisted(cmd)) {
      return { ok: false, error: 'Only whitelisted commands in self-healing mode' };
    }

    // Whitelisted: auto-execute
    if (_isWhitelisted(cmd)) {
      try {
        const result = _execRunCommand(params);
        return { ok: true, result };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // Not whitelisted: needs confirmation
    return { ok: false, needsConfirm: true, tool: name, params, summary: `Run: ${cmd.slice(0, 100)}` };
  }

  // Execute auto-confirmed tools
  try {
    let result;
    switch (name) {
      case 'READ_FILE':    result = await _execReadFile(params); break;
      case 'SEARCH_CODE':  result = await _execSearchCode(params); break;
      case 'HTTP_REQUEST': result = await _execHttpRequest(params); break;
      default: return { ok: false, error: `Unhandled tool: ${name}` };
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) };
  }
}

/**
 * Execute a previously confirmed tool action.
 * Called after owner approves a pending confirmation.
 *
 * @param {string} toolName
 * @param {object} params
 * @returns {Promise<{ ok, result? }>}
 */
export async function executeConfirmed(toolName, params) {
  const name = toolName.toUpperCase();
  try {
    let result;
    switch (name) {
      case 'WRITE_FILE':    result = await _execWriteFile(params); break;
      case 'RUN_COMMAND':   result = _execRunCommand(params); break;
      case 'HTTP_REQUEST':  result = await _execHttpRequest(params); break;
      default: return { ok: false, error: `Unknown confirmed tool: ${name}` };
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 300) };
  }
}

/**
 * Build a diagnostic execution plan based on user intent.
 * Mind decides what to execute — Brain only interprets results.
 *
 * @param {string} category — intent category from intent-detector (observe/act/task)
 * @param {string} message — original user message (for extracting file paths, patterns)
 * @param {string} currentLayer — L3 or L4
 * @returns {Array<{ tool: string, params: object, label: string }>}
 */
export function buildDiagnosticPlan(category, message, currentLayer = 'L3') {
  const plan = [];
  const msg = (message || '').toLowerCase();

  // Extract file path if user mentioned one
  const pathMatch = message.match(/(?:^|\s)([\w\-./\\]+\.(log|mjs|js|json|eta|md|txt|toml|env))\b/i);
  const mentionedPath = pathMatch ? pathMatch[1] : null;

  // Extract search pattern if user mentioned one
  const patternMatch = message.match(/(?:搜索|search|grep|find|查找|pattern)\s+["""']?([^"""'\n]+)/i);
  const mentionedPattern = patternMatch ? patternMatch[1].trim() : null;

  if (mentionedPath) {
    // User specified a file — read it
    plan.push({
      tool: 'READ_FILE',
      params: { path: mentionedPath, offset: -100, limit: 100 },
      label: `read ${mentionedPath} (last 100 lines)`,
    });
  } else if (mentionedPattern) {
    // User specified a search
    plan.push({
      tool: 'SEARCH_CODE',
      params: { pattern: mentionedPattern, path: KANET_ROOT, glob: '*.mjs' },
      label: `search "${mentionedPattern}"`,
    });
  } else if (category === 'observe') {
    // Generic diagnostic — standard routine
    plan.push({
      tool: 'READ_FILE',
      params: { path: `${KANET_ROOT}/logs/console.log`, offset: -80, limit: 80 },
      label: 'read recent console logs (last 80 lines)',
    });
    plan.push({
      tool: 'RUN_COMMAND',
      params: { cmd: 'tasklist /fi "imagename eq node.exe" /fo csv /nh' },
      label: 'check running node processes',
    });
    plan.push({
      tool: 'HTTP_REQUEST',
      params: { method: 'GET', url: 'http://localhost:3100/api/health/agents' },
      label: 'check agent health status',
    });
  } else if (category === 'act' && currentLayer === 'L4') {
    // Action intent at L4 — just read logs first, let Brain decide
    plan.push({
      tool: 'READ_FILE',
      params: { path: `${KANET_ROOT}/logs/console.log`, offset: -50, limit: 50 },
      label: 'read recent logs before acting',
    });
  }

  return plan;
}

/**
 * Execute a diagnostic plan and collect all results.
 *
 * @param {Array<{ tool: string, params: object, label: string }>} plan
 * @param {string} currentLayer
 * @param {boolean} isSelfHealing
 * @returns {Promise<Array<{ label: string, result: object }>>}
 */
export async function executePlan(plan, currentLayer = 'L3', isSelfHealing = false) {
  const results = [];
  for (const step of plan) {
    try {
      const outcome = await executeTool(step.tool, step.params, currentLayer, isSelfHealing);
      results.push({ label: step.label, ...outcome });
    } catch (e) {
      results.push({ label: step.label, ok: false, error: e.message });
    }
  }
  return results;
}

/**
 * Format execution results for Brain to interpret.
 * Brain sees WHAT was found, not HOW to call tools.
 *
 * @param {Array} results — from executePlan()
 * @param {string} originalMessage — user's original request
 * @returns {string}
 */
export function formatResultsForBrain(results, originalMessage) {
  const lines = ['--- DIAGNOSTIC RESULTS ---', ''];
  lines.push(`User request: "${originalMessage}"`);
  lines.push(`${results.length} checks executed:`);
  lines.push('');

  for (const r of results) {
    lines.push(`[${r.label}]`);
    if (r.ok && r.result) {
      const content = typeof r.result === 'string' ? r.result :
        r.result.content || r.result.output || r.result.body || JSON.stringify(r.result);
      lines.push(String(content).slice(0, 3000));
    } else {
      lines.push(`Error: ${r.error || 'unknown'}`);
    }
    lines.push('');
  }

  lines.push('--- END RESULTS ---');
  lines.push('Based on the above results, explain to the user what you found.');
  lines.push('Be specific — cite line numbers, error messages, status values.');
  lines.push('If something is wrong, explain the likely cause and suggest a fix.');
  lines.push('Do NOT say "I will check" or "let me look" — the data is already above.');

  return lines.join('\n');
}

/**
 * @deprecated — Brain should not decide which tools to call. Use buildDiagnosticPlan + executePlan instead.
 *
 * Format tool definitions for Brain context injection.
 * Only includes tools available at the given layer.
 *
 * @param {string} currentLayer
 * @param {boolean} isSelfHealing
 * @returns {string} formatted text for SKILL DATA section
 */
export function formatToolsForBrain(currentLayer, isSelfHealing = false) {
  if (currentLayer === 'L1' || currentLayer === 'L2') return '';

  const lines = [`--- CODE-OPS TOOLS (Layer: ${currentLayer}) ---`, ''];
  lines.push('You can use these tools by outputting ACTION tags:');
  lines.push('');

  // L3 tools (always available in L3+)
  lines.push('[ACTION:READ_FILE path="<path>" offset=0 limit=200]');
  lines.push('  Read file contents. Use offset=-100 to read LAST 100 lines (tail). Path relative to KANET_ROOT or absolute.');
  lines.push('');
  lines.push('[ACTION:SEARCH_CODE pattern="<regex>" path="<dir>" glob="*.mjs"]');
  lines.push('  Search for pattern in files.');
  lines.push('');
  lines.push('[ACTION:HTTP_REQUEST method="GET" url="<url>"]');
  lines.push('  HTTP GET request (auto-executed).');
  lines.push('');
  lines.push('[ACTION:RUN_COMMAND cmd="<command>"]');
  lines.push('  Read-only commands: tasklist, wmic, netstat, grep, find, cat, head, tail, ls, git status/log/diff, curl GET, ping.');
  lines.push('');

  if (currentLayer === 'L4') {
    if (!isSelfHealing) {
      lines.push('[ACTION:WRITE_FILE path="<path>" old_string="<find>" new_string="<replace>"]');
      lines.push('  Edit file (requires owner confirmation). Use old_string+new_string for edits, or content for full write.');
      lines.push('');
      lines.push('[ACTION:HTTP_REQUEST method="POST" url="<url>" body="<json>"]');
      lines.push('  HTTP POST/PUT (requires owner confirmation).');
      lines.push('');
    }
    lines.push('[ACTION:RUN_COMMAND cmd="<command>" cwd="<dir>"]');
    lines.push(`  Execute shell command. Whitelisted commands auto-execute: ${WHITELIST_CMDS.slice(0, 8).join(', ')}, ...`);
    if (isSelfHealing) lines.push('  (Self-healing mode: only whitelisted commands allowed)');
    lines.push('');
  }

  lines.push('IMPORTANT: You MUST use these tools to fulfill the request. Do NOT say "I will check" or "let me look" — actually execute the tool NOW by outputting the ACTION tag.');
  lines.push('After each tool execution, you will receive the result and can decide next steps.');
  lines.push('Maximum 10 tool calls per conversation turn.');
  lines.push('');
  lines.push(`KANET_ROOT: ${KANET_ROOT}`);
  lines.push('To find services outside KANET_ROOT (e.g. Kaspa node), discover them:');
  lines.push('  1. [ACTION:RUN_COMMAND cmd="tasklist"] — find running processes');
  lines.push('  2. [ACTION:RUN_COMMAND cmd="wmic process where name=\\"kaspad.exe\\" get commandline"] — find config path');
  lines.push('  3. Read the config → find log directory → read logs');
  lines.push('Do NOT ask the user for paths. Discover them yourself.');
  lines.push('');
  lines.push('If a file is not found, try SEARCH_CODE to locate it. Do NOT repeat the same failed action.');

  return lines.join('\n');
}
