/**
 * matcher.mjs unit tests — T1.7 unit (per task PZ-MATCHER-shipT1 v1.2 §T1.7)
 *
 * Run: node --test agent-mind/tests/matcher.test.mjs
 *
 * Scope: pure functions + safe-path fallback (no live network / no live DB).
 * Live verify (LLM extract / Brain reply / Trader-M onboarded) defer T1.9 12h 守 + Owner 验收 3 硬标准.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { MatcherSkill, generateReply, ensureAsciiSafe, replyToUser } from '../src/skills/matcher.mjs';

// ── canActivate ──────────────────────────────────────────────────────────────

test('canActivate reactive saves _senderAddress + _inputMessage and returns true', () => {
  const m = new MatcherSkill();
  const r = m.canActivate('reactive', { _senderAddress: 'kaspa:qabc', _inputMessage: '买 KAS' });
  assert.equal(r, true);
  assert.equal(m._senderAddress, 'kaspa:qabc');
  assert.equal(m._inputMessage, '买 KAS');
});

test('canActivate proactive returns false', () => {
  const m = new MatcherSkill();
  assert.equal(m.canActivate('proactive', {}), false);
});

test('canActivate reflect returns false', () => {
  const m = new MatcherSkill();
  assert.equal(m.canActivate('reflect', {}), false);
});

test('canActivate reactive missing context defaults empty string', () => {
  const m = new MatcherSkill();
  m.canActivate('reactive', null);
  assert.equal(m._senderAddress, '');
  assert.equal(m._inputMessage, '');
});

// ── generateReply 3 paths + T1 disclaimer ────────────────────────────────────

test('generateReply low-confidence/none returns clarification + T1 disclaimer', () => {
  const r = generateReply({ side: 'none', confidence: 'low' });
  assert.match(r, /没完全听懂/);
  assert.match(r, /T1 验证阶段/);
});

test('generateReply missing_fields returns ask + T1 disclaimer', () => {
  const r = generateReply({ side: 'buy', asset: 'KAS', confidence: 'high', missing_fields: ['qty', 'pay_chain'] });
  assert.match(r, /购买 KAS/);
  assert.match(r, /qty.*pay_chain/);
  assert.match(r, /T1 验证阶段/);
});

test('generateReply full intent returns confirmation + T1 disclaimer', () => {
  const r = generateReply({ side: 'buy', asset: 'KAS', qty: 50, qty_unit: 'USDT', pay_chain: 'BSC', confidence: 'high', missing_fields: [] });
  assert.match(r, /50 USDT 买入 KAS/);
  assert.match(r, /BSC/);
  assert.match(r, /T1 验证阶段/);
});

test('generateReply null intent returns clarification fallback', () => {
  const r = generateReply(null);
  assert.match(r, /没完全听懂/);
  assert.match(r, /T1 验证阶段/);
});

// ── ensureAsciiSafe ──────────────────────────────────────────────────────────

test('ensureAsciiSafe passes clean text including CJK', () => {
  assert.equal(ensureAsciiSafe('hello 你好'), 'hello 你好');
});

test('ensureAsciiSafe strips lone surrogate', () => {
  // U+D83D is a high surrogate without low pair — invalid alone
  const result = ensureAsciiSafe('hi\uD83D');
  assert.equal(result.length, 2);
  assert.equal(result, 'hi');
});

test('ensureAsciiSafe handles null/empty safely', () => {
  assert.equal(ensureAsciiSafe(null), '');
  assert.equal(ensureAsciiSafe(''), '');
  assert.equal(ensureAsciiSafe(undefined), '');
});

// ── replyToUser ──────────────────────────────────────────────────────────────

test('replyToUser missing peer returns ok:false', async () => {
  const r = await replyToUser(null, 'hi', { executeOne: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing required arg/);
});

test('replyToUser missing executor returns ok:false', async () => {
  const r = await replyToUser('kaspa:q', 'hi', null);
  assert.equal(r.ok, false);
});

test('replyToUser executor missing executeOne returns ok:false', async () => {
  const r = await replyToUser('kaspa:q', 'hi', {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /executeOne/);
});

test('replyToUser captures correct action shape (executeOne API)', async () => {
  let captured;
  const mockExec = { executeOne: async (a) => { captured = a; return { ok: true }; } };
  const r = await replyToUser('kaspa:qABC', 'hello world', mockExec);
  assert.equal(r.ok, true);
  assert.deepEqual(captured, { type: 'send_message', target: 'kaspa:qABC', message: 'hello world' });
});

// ── gatherContext safe-path ──────────────────────────────────────────────────

test('gatherContext empty sender returns safe shape', async () => {
  const m = new MatcherSkill();
  // canActivate not called, _senderAddress = ''
  const ctx = await m.gatherContext({}, { consoleUrl: 'http://localhost:3100' });
  assert.equal(ctx.peer, null);
  assert.deepEqual(ctx.history, []);
  assert.equal(ctx.metadata.degraded, false);
});

test('gatherContext bad URL returns safe shape with error', async () => {
  const m = new MatcherSkill();
  m.canActivate('reactive', { _senderAddress: 'kaspa:qtest' });
  const ctx = await m.gatherContext({}, { consoleUrl: 'http://127.0.0.1:1', address: 'kaspa:qme' });
  assert.equal(ctx.peer, null);
  assert.ok(ctx.metadata.error, 'expects metadata.error on fetch fail');
});

// ── extractIntent fallback paths ─────────────────────────────────────────────

test('extractIntent no adapterUrl returns adapter_unavailable fallback', async () => {
  const m = new MatcherSkill();
  m._senderAddress = 'kaspa:qtest';
  const intent = await m.extractIntent({ history: [] }, '买 KAS', { adapterUrl: null });
  assert.equal(intent.side, 'none');
  assert.equal(intent.confidence, 'low');
  assert.deepEqual(intent.missing_fields, ['adapter_unavailable']);
});

test('extractIntent bad URL returns adapter_error fallback', async () => {
  const m = new MatcherSkill();
  m._senderAddress = 'kaspa:qtest';
  const intent = await m.extractIntent({ history: [], peer: { name: 'A', trustLevel: 'normal' } }, '买 KAS', { adapterUrl: 'http://127.0.0.1:1' });
  assert.equal(intent.side, 'none');
  assert.deepEqual(intent.missing_fields, ['adapter_error']);
  assert.ok(intent._error, 'expects _error on network fail');
});

// ── formatForBrain ───────────────────────────────────────────────────────────

test('formatForBrain empty sender returns skipped shape', async () => {
  const m = new MatcherSkill();
  // _senderAddress = '' (canActivate not called)
  const r = await m.formatForBrain({ peer: null, history: [] });
  assert.equal(r.name, 'matcher');
  assert.equal(r.data.skipped, 'no_sender');
});

test('formatForBrain end-to-end (no adapter): returns intent + suggestedReply with T1 disclaimer', async () => {
  const m = new MatcherSkill();
  m.canActivate('reactive', { _senderAddress: 'kaspa:qtest', _inputMessage: '买 KAS' });
  m._config = { adapterUrl: null }; // simulate gatherContext config save
  const fakeGathered = {
    peer: { name: 'Alice', trustLevel: 'normal' },
    history: [{ dir: 'in', text: 'hi', ts: '2026-05-01T08:00:00Z' }],
    broadcasts: [], connectionStatus: null, metadata: { historyCount: 1, degraded: false },
  };
  const r = await m.formatForBrain(fakeGathered);
  assert.equal(r.name, 'matcher');
  assert.ok(r.data.intent, 'data.intent present');
  assert.equal(r.data.intent.side, 'none'); // adapter unavailable fallback
  assert.ok(r.data.suggestedReply.includes('T1 验证阶段'), 'suggestedReply has T1 disclaimer');
  assert.ok(r.instructions.includes(r.data.suggestedReply), 'instructions includes suggestedReply');
});

// ── T1 anti-pattern invariants (defensive checks) ────────────────────────────

test('matcher.mjs source has 0 import sqlite (KANet skill convention 4 轴)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // Allow comment mention (e.g. "0 import sqlite"), block actual import
  const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
  for (const line of importLines) {
    assert.ok(!/sqlite/i.test(line), `forbidden import: ${line}`);
  }
});

test('matcher.mjs source has 0 import openai/anthropic (MATCHER §11 #4 anti-pattern)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
  for (const line of importLines) {
    assert.ok(!/openai|anthropic/i.test(line), `forbidden direct LLM SDK import: ${line}`);
  }
});

test('matcher.mjs source has 0 import kasia-relay (边界铁律: Console 不碰链)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
  for (const line of importLines) {
    assert.ok(!/kasia-relay/i.test(line), `forbidden Relay import: ${line}`);
  }
});

// ── T1.8 invariant: MATCHER §11 9 anti-pattern enforce ───────────────────────
// Source-level grep + import audit. T1.7 已 cover #4 (openai/anthropic) / #5 partial / #6 (kasia-relay) / #9 partial (sqlite).
// T1.8 加 6 项 supplement: #1 (module-level cache) / #2 (UPDATE SQL string) / #3 (history index) / #5 (kaspa-wasm) / #7 (single-broker) / #8 (schema modification).

async function _matcherSrc() {
  const fs = await import('node:fs/promises');
  return fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
}

test('§11 #1: 0 module-level Map/Cache holding retail_dex_orders state', async () => {
  const src = await _matcherSrc();
  // forbidden: top-level mutable cache for orders state — grep `^(const|let)\s+\w*[Oo]rder\w*\s*=\s*new (Map|Set|WeakMap)`
  const moduleLevelOrderCache = src.match(/^(const|let)\s+\w*[Oo]rder\w*\s*=\s*new\s+(Map|Set|WeakMap)/m);
  assert.ok(!moduleLevelOrderCache, `forbidden module-level order cache: ${moduleLevelOrderCache?.[0]}`);
});

test('§11 #2: 0 direct SQL UPDATE/INSERT retail_dex_orders string in source', async () => {
  const src = await _matcherSrc();
  assert.ok(!/UPDATE\s+retail_dex_orders/i.test(src), 'forbidden direct UPDATE retail_dex_orders');
  assert.ok(!/INSERT\s+INTO\s+retail_dex_orders/i.test(src), 'forbidden direct INSERT retail_dex_orders');
});

test('§11 #3: 0 self-built conversation history index/cache', async () => {
  const src = await _matcherSrc();
  // forbidden parallel index — grep keywords like history_cache / conversation_index / message_map / peer_history_map
  const forbidden = src.match(/(history|conversation|message)_(cache|index|map)\b|peerHistoryMap|chatHistoryCache/i);
  assert.ok(!forbidden, `forbidden parallel history index: ${forbidden?.[0]}`);
});

test('§11 #5: 0 import kaspa-wasm / RPC client (matcher 0 自扫链)', async () => {
  const src = await _matcherSrc();
  const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
  for (const line of importLines) {
    assert.ok(!/kaspa-wasm|RpcClient|getUtxos|ScoutClient/i.test(line), `forbidden chain scan import: ${line}`);
  }
});

test('§11 #7: 0 hardcoded single-broker assumption (multi-instance ready)', async () => {
  const src = await _matcherSrc();
  // forbidden: hardcode Trader-B / primary_broker / single broker assertion
  const forbidden = src.match(/Trader-B\b|primary_broker|onlyBroker|isMainBroker|BROKER_ADDRESS|TRADER_B_ADDRESS|MAIN_BROKER/);
  assert.ok(!forbidden, `forbidden single-broker assumption: ${forbidden?.[0]}`);
});

test('§11 #8: 0 schema modification (ALTER/CREATE TABLE retail_dex_orders)', async () => {
  const src = await _matcherSrc();
  assert.ok(!/ALTER\s+TABLE\s+retail_dex_orders/i.test(src), 'forbidden ALTER TABLE retail_dex_orders');
  assert.ok(!/CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?retail_dex_orders/i.test(src), 'forbidden CREATE TABLE retail_dex_orders');
});

// Integration test (Trader-M live + LLM extract + Brain reply + retail_dex_orders 0 增) defer T1.9.
// per NWT r118: T1.6 acceptance live verify defer T1.9 12h 守同期 operator hat --apply trigger.
