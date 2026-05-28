#!/usr/bin/env node
/**
 * Track A Keyword Audit (= Tier 1 spec §2.D, 公开频道泄露防护)
 *
 * Scans broadcast_messages WHERE visibility='public' for Track A leak keywords.
 * Per docs/track-a-keyword-blocklist.md.
 *
 * Modes:
 *   node scripts/audit-track-a-keywords.mjs           # dry-run: report matches, no DB change
 *   node scripts/audit-track-a-keywords.mjs --fix     # auto-flip matched rows visibility='public' → 'internal'
 *
 * Hard blocklist match → flip to internal (if --fix) + report.
 * Soft warn match → report only (= 人工 review).
 *
 * Exit: 0 if clean, 1 if hard matches found (= CI gate friendly).
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve better-sqlite3 from kasia-console node_modules (= script lives in scripts/, dep in kasia-console/)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');

const DB_PATH = process.env.KANET_DB_PATH || path.join(__dirname, '../kasia-console/data/console.db');
const FIX = process.argv.includes('--fix');

// Hard blocklist — case-insensitive substring match → flip internal
const HARD_KEYWORDS = [
  // Mainnet 标识 (注意排除 kaspatest:)
  'mainnet', '主网', '生产环境',
  // Owner 个人身份
  'fossamagnadl', 'unio996',
  // 真实资金 / CEX
  'gate.io', 'gate_api', 'cex_api_key', '真金', '真钱', 'real money', 'real funds', 'mainnet kas', '主网 kas',
  // Track A persona
  'sophie', 'eric', 'fossa-stable', 'trader-b',
];

// Mainnet kaspa address pattern (= kaspa: 但非 kaspatest:)
const MAINNET_ADDR_RE = /\bkaspa:q[qrz][a-z0-9]{10,}/i;

// Soft warn — report only
const SOFT_KEYWORDS = ['钦定', 'cex_secret'];
const PRIVATE_IP_RE = /\b(?:192\.168\.|10\.|127\.0\.0\.1)\d*/;
const FS_PATH_RE = /\b[A-Za-z]:[\\/]|\/d\/kanet|\/c\/kanet/;

function checkHard(content) {
  const lower = content.toLowerCase();
  const hits = [];
  for (const kw of HARD_KEYWORDS) {
    // Special case: 'mainnet kas' etc handled; skip 'kaspa:' false-positive from kaspatest
    if (lower.includes(kw)) hits.push(kw);
  }
  // Mainnet addr (= kaspa: not kaspatest:) — strip kaspatest first to avoid false match
  const withoutTestnet = content.replace(/kaspatest:/gi, '');
  if (MAINNET_ADDR_RE.test(withoutTestnet)) hits.push('mainnet-kaspa-addr');
  return hits;
}

function checkSoft(content) {
  const lower = content.toLowerCase();
  const hits = [];
  for (const kw of SOFT_KEYWORDS) if (lower.includes(kw.toLowerCase())) hits.push(kw);
  if (PRIVATE_IP_RE.test(content)) hits.push('private-ip');
  if (FS_PATH_RE.test(content)) hits.push('fs-path');
  return hits;
}

const db = new Database(DB_PATH, { readonly: !FIX });

const rows = db.prepare(`
  SELECT id, channel_name, sender_address, content, tx_hash
  FROM broadcast_messages
  WHERE visibility = 'public'
`).all();

console.log(`[track-a-audit] scanning ${rows.length} public broadcast_messages (mode: ${FIX ? 'FIX' : 'dry-run'})`);
console.log(`[track-a-audit] DB: ${DB_PATH}`);
console.log('');

let hardCount = 0;
let softCount = 0;
let flippedCount = 0;

for (const row of rows) {
  const hardHits = checkHard(row.content);
  const softHits = checkSoft(row.content);
  if (hardHits.length > 0) {
    hardCount++;
    const preview = row.content.replace(/\n/g, ' ').slice(0, 80);
    console.log(`🚨 HARD ${row.tx_hash?.slice(0, 12)}… [${row.channel_name}] hits=[${hardHits.join(',')}]`);
    console.log(`   "${preview}"`);
    if (FIX) {
      db.prepare(`UPDATE broadcast_messages SET visibility='internal' WHERE id=?`).run(row.id);
      flippedCount++;
      console.log(`   → flipped to internal ✓`);
    }
  } else if (softHits.length > 0) {
    softCount++;
    const preview = row.content.replace(/\n/g, ' ').slice(0, 60);
    console.log(`⚠ SOFT ${row.tx_hash?.slice(0, 12)}… [${row.channel_name}] hits=[${softHits.join(',')}] — 人工 review`);
    console.log(`   "${preview}"`);
  }
}

db.close();

console.log('');
console.log(`[track-a-audit] summary: ${hardCount} hard / ${softCount} soft / ${flippedCount} flipped`);
if (hardCount > 0 && !FIX) {
  console.log(`[track-a-audit] ⚠ ${hardCount} hard matches still public — run with --fix to flip internal`);
  process.exit(1);
}
console.log(`[track-a-audit] ${hardCount === 0 ? '✅ clean (0 hard leak)' : '✅ all hard matches flipped internal'}`);
process.exit(0);
