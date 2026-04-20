#!/usr/bin/env node
/**
 * build-code-index.js — 构建代码库 FTS5 全文索引
 *
 * 将 KANet 全部 .js/.mjs/.eta 源文件索引到 SQLite FTS5，
 * 供 qwen.js --rag 检索时使用。
 *
 * 用法：node scripts/build-code-index.js
 * 产物：scripts/code-index.db
 */
const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, '..', 'kasia-console', 'node_modules', 'better-sqlite3'));

const KANET_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(__dirname, 'code-index.db');

// Directories to index
const SCAN_DIRS = [
  'kasia-console/src',
  'agent-mind/src',
  'agent-adapter/src',
  'kasia-relay/src',
  'kaspa-scout/src',
  'shared/lib',
  'scripts',
  'docs'
];

// File extensions to index
const EXTENSIONS = new Set(['.js', '.mjs', '.eta', '.md']);

// Max file size (skip huge generated files)
const MAX_FILE_SIZE = 200 * 1024; // 200KB

function collectFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'vendor') continue;
      collectFiles(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      const stat = fs.statSync(full);
      if (stat.size <= MAX_FILE_SIZE) {
        files.push(full);
      }
    }
  }
  return files;
}

function extractChunks(filePath, content) {
  const rel = path.relative(KANET_ROOT, filePath).replace(/\\/g, '/');
  const ext = path.extname(filePath);
  const chunks = [];

  if (ext === '.md') {
    // For markdown: split by ## headers
    const sections = content.split(/^## /m);
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (!section || section.length < 20) continue;
      const firstLine = section.split('\n')[0];
      chunks.push({
        file: rel,
        symbol: firstLine.slice(0, 80),
        lineStart: content.indexOf(section) > -1 ? content.substring(0, content.indexOf(section)).split('\n').length : i * 50,
        content: section.slice(0, 2000) // Cap per chunk
      });
    }
  } else {
    // For code: split by function/class/module boundaries
    const lines = content.split('\n');
    let currentChunk = [];
    let chunkStart = 1;
    let chunkSymbol = rel;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect function/class/export boundaries
      const isBoundary = /^(async\s+)?function\s+\w+|^(module\.)?exports\.|^class\s+\w+|^const\s+\w+\s*=\s*(async\s+)?\(|^(app|fastify)\.(get|post|put|delete)\(/.test(line.trim());

      if (isBoundary && currentChunk.length > 5) {
        // Save previous chunk
        chunks.push({
          file: rel,
          symbol: chunkSymbol,
          lineStart: chunkStart,
          content: currentChunk.join('\n').slice(0, 2000)
        });
        currentChunk = [];
        chunkStart = i + 1;
        // Extract symbol name
        const match = line.match(/(?:function|class|const|exports\.)\s*(\w+)/);
        chunkSymbol = match ? match[1] : `${rel}:${i + 1}`;
      }

      currentChunk.push(line);
    }

    // Last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        file: rel,
        symbol: chunkSymbol,
        lineStart: chunkStart,
        content: currentChunk.join('\n').slice(0, 2000)
      });
    }
  }

  return chunks;
}

// ── Main ──
console.log('Building code index...');

// Remove old index
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);

// Create FTS5 table
db.exec(`
  CREATE VIRTUAL TABLE code_chunks USING fts5(
    file,
    symbol,
    line_start,
    content,
    tokenize='porter unicode61'
  );
`);

const insert = db.prepare(
  'INSERT INTO code_chunks (file, symbol, line_start, content) VALUES (?, ?, ?, ?)'
);

let totalFiles = 0;
let totalChunks = 0;

const insertAll = db.transaction((chunks) => {
  for (const c of chunks) {
    insert.run(c.file, c.symbol, c.lineStart, c.content);
    totalChunks++;
  }
});

for (const dir of SCAN_DIRS) {
  const fullDir = path.join(KANET_ROOT, dir);
  const files = collectFiles(fullDir);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const chunks = extractChunks(file, content);
      if (chunks.length > 0) {
        insertAll(chunks);
        totalFiles++;
      }
    } catch (err) {
      console.error(`  Skip ${file}: ${err.message}`);
    }
  }
}

// Stats
const countResult = db.prepare('SELECT COUNT(*) as n FROM code_chunks').get();
const dbSize = fs.statSync(DB_PATH).size;

console.log(`\n✅ Index built: ${DB_PATH}`);
console.log(`   ${totalFiles} files → ${totalChunks} chunks`);
console.log(`   DB size: ${(dbSize / 1024).toFixed(0)} KB`);

// Quick test
const testResults = db.prepare(
  "SELECT file, symbol, line_start FROM code_chunks WHERE code_chunks MATCH ? ORDER BY rank LIMIT 5"
).all('sendCommandAsync transfer');

console.log(`\n   Test query "sendCommandAsync transfer":`);
testResults.forEach(r => console.log(`     ${r.file}:${r.line_start} — ${r.symbol}`));

db.close();
