/**
 * Handshake system vulnerabilities fix tests — 2026-05-04
 *
 * 守 4 个 P0 修复 source-level invariant, 防止 future regression:
 *   #1 discovery.js dup check 必须按 (txid, event_type) 双键
 *   #2 pending_actions idempotent_key reset on failed/expired
 *   #3 rpc-listener processHandshake outer catch 必须 ingestEvent 上报
 *   #6 rpc-listener claim fail 不 markSeen
 *
 * 历史 bug: Owner 5/1 c382fd2c0f72 真握手被漏处理 — 6 漏洞联合 (主要 #1+#3+#6)。
 * 见 PZ-HANDSHAKE-vulnerabilities-fix.md (待 ship)。
 *
 * Run: node --test kasia-console/test/handshake-vulnerabilities-fix.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../..');

// ── 漏洞 #1: discovery.js dup check (txid, event_type) 双键 ────────────────────

test('漏洞 #1: discovery.js /api/discovery/interaction dup check 按 (txid, event_type) 双键', () => {
  const src = readFileSync(join(REPO_ROOT, 'kasia-console/src/api/discovery.js'), 'utf-8');
  // 必须含 'WHERE txid = ? AND event_type = ?' 模式 (双键)
  assert.match(
    src,
    /SELECT\s+1\s+FROM\s+chain_events\s+WHERE\s+txid\s*=\s*\?\s+AND\s+event_type\s*=\s*\?/i,
    'discovery.js dup check 必须按 (txid, event_type) 双键, 否则 Relay 先写 tx row 让 Scout handshake 短路',
  );
  // 不能有旧的"WHERE txid = ?"单键 dup check (在 /interaction handler 里)
  // (允许其他文件 OR 同文件其他位置有 single-txid query, 但 interaction 的 dup 必须双键)
  // 简单守: dedupEventType 变量必须存在, 跟 interactionType 联动
  assert.match(src, /dedupEventType/, 'dedupEventType 变量名守, 防被错误删除');
});

// ── 漏洞 #2: pending_actions idempotent_key reset on failed/expired ───────────

test('漏洞 #2: ingest-service.js pending_actions failed/expired 允许 reset', () => {
  const src = readFileSync(join(REPO_ROOT, 'kasia-console/src/services/ingest-service.js'), 'utf-8');
  // 必须查现存 row 的 status
  assert.match(src, /SELECT\s+id,\s*status\s+FROM\s+pending_actions\s+WHERE\s+idempotent_key/i,
    'ingest-service 必须先 SELECT existing pending_action row');
  // failed/expired 时 UPDATE reset
  assert.match(src, /existing\.status\s*===\s*['"]failed['"]/, 'failed status 必须可 reset');
  assert.match(src, /existing\.status\s*===\s*['"]expired['"]/, 'expired status 必须可 reset');
  assert.match(src, /UPDATE\s+pending_actions\s+SET\s+status\s*=\s*['"]pending['"]/i,
    'UPDATE reset 路径必须存在');
});

test('漏洞 #2: discovery.js Scout 路径同款 reset 逻辑', () => {
  const src = readFileSync(join(REPO_ROOT, 'kasia-console/src/api/discovery.js'), 'utf-8');
  // 同 ingest-service 一致: existing status check + UPDATE reset
  assert.match(src, /SELECT\s+id,\s*status\s+FROM\s+pending_actions/i,
    'discovery.js Scout 路径必须先 SELECT existing');
  assert.match(src, /UPDATE\s+pending_actions\s+SET\s+status\s*=\s*['"]pending['"]/i,
    'discovery.js UPDATE reset 路径必须存在');
});

// ── 漏洞 #3: processHandshake outer catch 必须 ingestEvent ────────────────────

test('漏洞 #3: rpc-listener processHandshake outer catch 必须上报 /ingest/event', () => {
  const src = readFileSync(join(REPO_ROOT, 'kasia-relay/src/rpc-listener.mjs'), 'utf-8');
  // outer catch 区块里必须 fetch /ingest/event
  assert.match(src, /handshake_processing_failed/,
    'outer catch 必须用 eventType=handshake_processing_failed 上报');
  assert.match(src, /\/ingest\/event/, '必须 POST /ingest/event endpoint');
  assert.match(src, /traceId:\s*`handshake-fail:/, 'traceId 必须 handshake-fail 前缀防 Console 端 dedup 冲突');
});

// ── 漏洞 #6: claim fail 不 markSeen ──────────────────────────────────────────

test('漏洞 #6: rpc-listener claim 失败时不 markSeen, 让 catch-up 能 retry', () => {
  const src = readFileSync(join(REPO_ROOT, 'kasia-relay/src/rpc-listener.mjs'), 'utf-8');
  // 找 claim failed 区段, 必须没 markSeen call
  // 用注释 marker 锁定区段 (commit 注释里加了 "漏洞 #6 fix" tag)
  assert.match(src, /漏洞 #6 fix/, '漏洞 #6 fix 注释必须保留');
  // claim failed log 文案改了 (原 'skipping' → 'will recheck next cycle')
  assert.match(src, /will recheck next cycle/,
    'claim fail 文案必须 reflect retry 行为');
  // 直接验证: 在 'claim failed' log 5 行内不能有 markSeen 调用
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("'HANDSHAKE claim failed")) {
      const window = lines.slice(i, i + 6).join('\n');
      assert.doesNotMatch(window, /markSeen\s*\(\s*txId\s*\)/,
        `claim failed log 后 5 行不能 markSeen, line ${i + 1}`);
      break;
    }
  }
});

// ── Cross-cutting: 4 个修复全 ship ────────────────────────────────────────────

test('All 4 P0 fixes shipped (cross-cutting marker check)', () => {
  const discovery = readFileSync(join(REPO_ROOT, 'kasia-console/src/api/discovery.js'), 'utf-8');
  const ingest = readFileSync(join(REPO_ROOT, 'kasia-console/src/services/ingest-service.js'), 'utf-8');
  const relay = readFileSync(join(REPO_ROOT, 'kasia-relay/src/rpc-listener.mjs'), 'utf-8');
  // 4 fix marker 全在
  assert.match(discovery, /漏洞 #1 fix/, '#1 marker missing');
  assert.match(ingest, /漏洞 #2 fix/, '#2 marker missing in ingest-service');
  assert.match(discovery, /漏洞 #2 fix/, '#2 marker missing in discovery');
  assert.match(relay, /漏洞 #3 fix/, '#3 marker missing');
  assert.match(relay, /漏洞 #6 fix/, '#6 marker missing');
});
