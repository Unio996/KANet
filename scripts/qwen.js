#!/usr/bin/env node
/**
 * qwen.js — Opus→Qwen 调度器
 *
 * 用法：
 *   node scripts/qwen.js "写一个函数..." [--system "你是..."] [--file out.js] [--max-tokens 4096]
 *   echo "prompt" | node scripts/qwen.js --stdin
 *   node scripts/qwen.js --file-prompt task.md        # 从文件读 prompt
 *   node scripts/qwen.js --rag "exchange" "基于检索结果写..."  # 先检索再写
 *
 * 输出：纯净内容（thinking 已剥离），直接可用。
 * 退出码：0=成功 1=失败
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const QWEN_URL = process.env.QWEN_URL || 'http://localhost:8000';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;

// ── Parse args ──
const args = process.argv.slice(2);
let prompt = '';
let system = '';
let outFile = '';
let maxTokens = DEFAULT_MAX_TOKENS;
let temperature = DEFAULT_TEMPERATURE;
let useStdin = false;
let filePrompt = '';
let ragQuery = '';

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--system': case '-s': system = args[++i]; break;
    case '--file': case '-o': outFile = args[++i]; break;
    case '--max-tokens': case '-t': maxTokens = parseInt(args[++i]); break;
    case '--temperature': temperature = parseFloat(args[++i]); break;
    case '--stdin': useStdin = true; break;
    case '--file-prompt': case '-f': filePrompt = args[++i]; break;
    case '--rag': case '-r': ragQuery = args[++i]; break;
    default:
      if (!prompt) prompt = args[i];
      else prompt += ' ' + args[i];
  }
}

async function main() {
  // Read prompt from sources
  if (useStdin) {
    prompt = fs.readFileSync(0, 'utf8').trim();
  } else if (filePrompt) {
    prompt = fs.readFileSync(filePrompt, 'utf8').trim();
  }

  if (!prompt) {
    console.error('Usage: node scripts/qwen.js "your prompt" [--system "..."] [--file out.js]');
    process.exit(1);
  }

  // RAG: prepend code search results
  if (ragQuery) {
    const ragContext = await searchCodebase(ragQuery);
    if (ragContext) {
      prompt = `## Relevant code from the codebase:\n\n${ragContext}\n\n## Task:\n\n${prompt}`;
    }
  }

  // Inject QWEN-RULES if system prompt not provided
  if (!system) {
    const rulesPath = path.join(__dirname, '..', 'QWEN-RULES.md');
    if (fs.existsSync(rulesPath)) {
      const rules = fs.readFileSync(rulesPath, 'utf8');
      system = `You are a KANet senior developer. Follow these rules strictly:\n\n${rules}\n\nOutput clean code. No thinking tags. Be concise.`;
    } else {
      system = 'You are a senior JavaScript/Node.js developer. Write clean, production-ready code. Be concise.';
    }
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  // Qwen3.6 thinking mode kill switch — /no_think 前缀实测无效，
  // 唯一有效 kill switch 是 API body 的 chat_template_kwargs.enable_thinking=false
  // (规则#11，实测 8s → 1s)。DEVELOPER-GUIDE Rule 11.
  const body = JSON.stringify({
    model: 'Qwen3.6-35B-A3B',
    messages,
    max_tokens: maxTokens,
    temperature,
    chat_template_kwargs: { enable_thinking: false }
  });

  const startMs = Date.now();

  try {
    const raw = await httpPost(`${QWEN_URL}/v1/chat/completions`, body);
    const data = JSON.parse(raw);
    const elapsed = Date.now() - startMs;

    let content = data.choices?.[0]?.message?.content || '';
    // Fallback to reasoning_content (Qwen3.6 thinking mode on older llama.cpp)
    if (!content && data.choices?.[0]?.message?.reasoning_content) {
      content = data.choices[0].message.reasoning_content;
    }
    // Strip thinking tags (closed and unclosed)
    content = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

    if (!content) {
      console.error('ERROR: Qwen returned empty content after stripping thinking tags');
      console.error('Raw tokens:', data.usage?.completion_tokens, '— may need more max_tokens');
      process.exit(1);
    }

    const tokPerSec = (data.usage?.completion_tokens / (elapsed / 1000)).toFixed(0);

    // Output
    if (outFile) {
      fs.writeFileSync(outFile, content);
      console.error(`✓ ${elapsed}ms | ${data.usage?.completion_tokens} tok | ${tokPerSec} tok/s → ${outFile}`);
    } else {
      // Metadata to stderr, content to stdout (pipeable)
      console.error(`✓ ${elapsed}ms | ${data.usage?.completion_tokens} tok | ${tokPerSec} tok/s`);
      console.log(content);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
}

// ── RAG: FTS5 code search (fallback to grep) ──
async function searchCodebase(query) {
  const indexPath = path.join(__dirname, 'code-index.db');

  // Try FTS5 index first
  if (fs.existsSync(indexPath)) {
    try {
      const Database = require(path.join(__dirname, '..', 'kasia-console', 'node_modules', 'better-sqlite3'));
      const db = new Database(indexPath, { readonly: true });
      const results = db.prepare(
        `SELECT file, symbol, line_start, content
         FROM code_chunks WHERE code_chunks MATCH ?
         ORDER BY rank LIMIT 8`
      ).all(query);
      db.close();

      if (results.length > 0) {
        console.error(`  RAG: ${results.length} chunks via FTS5 for "${query}"`);
        return results.map(r =>
          `### ${r.file}:${r.line_start} (${r.symbol})\n\`\`\`javascript\n${r.content.slice(0, 1500)}\n\`\`\``
        ).join('\n\n');
      }
    } catch (e) {
      console.error(`  RAG FTS5 error: ${e.message}, falling back to grep`);
    }
  }

  // Fallback: grep
  const { execSync } = require('child_process');
  const kanetRoot = path.join(__dirname, '..');
  const searchDirs = ['kasia-console/src', 'agent-mind/src', 'agent-adapter/src', 'kasia-relay/src', 'kaspa-scout/src'];
  try {
    const results = [];
    for (const pattern of query.split(/\s+/).filter(Boolean)) {
      for (const dir of searchDirs) {
        const fullDir = path.join(kanetRoot, dir);
        if (!fs.existsSync(fullDir)) continue;
        try {
          const out = execSync(`grep -rnl --include="*.js" --include="*.mjs" "${pattern}" "${fullDir}"`, { encoding: 'utf8', timeout: 5000 }).trim();
          if (out) for (const file of out.split('\n').slice(0, 3)) {
            const rel = path.relative(kanetRoot, file);
            try {
              const ctx = execSync(`grep -n -B2 -A5 "${pattern}" "${file}" | head -40`, { encoding: 'utf8', timeout: 3000 }).trim();
              results.push(`### ${rel}\n\`\`\`javascript\n${ctx}\n\`\`\``);
            } catch {}
          }
        } catch {}
      }
    }
    return results.length > 0 ? results.slice(0, 5).join('\n\n') : null;
  } catch { return null; }
}

// ── HTTP helper ──
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 180000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout (180s)')); });
    req.write(body);
    req.end();
  });
}

main();
