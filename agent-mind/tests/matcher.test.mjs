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

// ── generateReply 3 paths (M-2 fix: 删 T1 disclaimer, T3 阶段不该有) ──────────

test('generateReply low-confidence/none returns clarification (M-2: no T1 disclaimer)', () => {
  const r = generateReply({ side: 'none', confidence: 'low' });
  assert.match(r, /没完全听懂/);
  assert.doesNotMatch(r, /T1 验证阶段/);
});

test('generateReply missing_fields returns ask (M-2: no T1 disclaimer)', () => {
  const r = generateReply({ side: 'buy', asset: 'KAS', confidence: 'high', missing_fields: ['qty', 'pay_chain'] });
  assert.match(r, /购买 KAS/);
  assert.match(r, /qty.*pay_chain/);
  assert.doesNotMatch(r, /T1 验证阶段/);
});

test('generateReply full intent returns confirmation (M-2: no T1 disclaimer, ready-to-publish wording)', () => {
  const r = generateReply({ side: 'buy', asset: 'KAS', qty: 50, qty_unit: 'USDT', pay_chain: 'BSC', confidence: 'high', missing_fields: [] });
  assert.match(r, /50 USDT 买入 KAS/);
  assert.match(r, /BSC/);
  assert.doesNotMatch(r, /T1 验证阶段/);
  // M-2: 新文案 "准备出报价" — 给 Brain 真信号 matcher 准备 publish
  assert.match(r, /准备出报价/);
});

test('generateReply null intent returns clarification fallback (M-2: no T1 disclaimer)', () => {
  const r = generateReply(null);
  assert.match(r, /没完全听懂/);
  assert.doesNotMatch(r, /T1 验证阶段/);
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
  // M-2 fix: T1 disclaimer 已删除, 改 verify clarification 文案
  assert.ok(r.data.suggestedReply.includes('没完全听懂'), 'suggestedReply has clarification text');
  assert.ok(!r.data.suggestedReply.includes('T1 验证阶段'), 'M-2: T1 disclaimer 真已删除');
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

// ── T2.4 unit tests: publishOffer + stripMarkdown + offer feedback (per task v1.3 §T2.4) ────────────

test('T2 stripMarkdown strips **bold** + *italic* + # heading + `code` + [link](url)', () => {
  const m = new MatcherSkill();
  assert.equal(m.stripMarkdown('**报价单**'), '报价单');
  assert.equal(m.stripMarkdown('*italic text*'), 'italic text');
  assert.equal(m.stripMarkdown('# heading'), 'heading');
  assert.equal(m.stripMarkdown('`code`'), 'code');
  assert.equal(m.stripMarkdown('[link](http://x)'), 'link');
});

test('T2 stripMarkdown 不破 emoji / 中文 / 数字 / 普通 punct', () => {
  const m = new MatcherSkill();
  assert.equal(m.stripMarkdown('📋 报价详情'), '📋 报价详情');
  assert.equal(m.stripMarkdown('100 KAS / 3.26 USDT'), '100 KAS / 3.26 USDT');
  assert.equal(m.stripMarkdown('  - 你付: 50 USDT'), '  - 你付: 50 USDT');
  assert.equal(m.stripMarkdown(null), null);
  assert.equal(m.stripMarkdown(''), '');
});

test('T3.1 asyncShouldPublish fail-closed when adapter unavailable (KI-22)', async () => {
  const m = new MatcherSkill();
  const intent = { side: 'buy', confidence: 'high', missing_fields: [] };
  const okHist = [{ dir: 'in', text: '好的', ts: '2026-05-03' }];
  // No config.adapterUrl → fail-closed false (per T3.1 spec)
  assert.equal(await m.asyncShouldPublish(intent, okHist, {}), false);
  assert.equal(await m.asyncShouldPublish(intent, okHist, null), false);
});

test('T3.1 asyncShouldPublish cheap gates: low confidence / missing_fields / non buy-sell', async () => {
  const m = new MatcherSkill();
  const okHist = [{ dir: 'in', text: '好的' }];
  const config = { adapterUrl: 'http://127.0.0.1:99999' }; // unreachable, but cheap gates short-circuit before fetch
  // Cheap gates trigger before adapter call → false without LLM round-trip
  assert.equal(await m.asyncShouldPublish({ side: 'buy', confidence: 'low', missing_fields: [] }, okHist, config), false);
  assert.equal(await m.asyncShouldPublish({ side: 'buy', confidence: 'high', missing_fields: ['qty'] }, okHist, config), false);
  assert.equal(await m.asyncShouldPublish({ side: 'query', confidence: 'high', missing_fields: [] }, okHist, config), false);
});

// ── 漏洞 M-1: asyncShouldPublish 早 return false 路径必上报 events 表 telemetry ──

test('M-1: asyncShouldPublish 4 cheap-gate paths 全调 _reportPublishDecision', async () => {
  const m = new MatcherSkill();
  const calls = [];
  m._reportPublishDecision = async (cfg, decision, details) => { calls.push({ decision, details }); };
  const config = { adapterUrl: 'http://127.0.0.1:99999', consoleUrl: 'http://127.0.0.1:99999' };
  const okHist = [{ dir: 'in', text: '好' }];

  await m.asyncShouldPublish({ side: 'buy', confidence: 'low', missing_fields: [] }, okHist, config);
  await m.asyncShouldPublish({ side: 'query', confidence: 'high', missing_fields: [] }, okHist, config);
  await m.asyncShouldPublish({ side: 'buy', confidence: 'high', missing_fields: ['evm_address'] }, okHist, config);
  await m.asyncShouldPublish({ side: 'buy', confidence: 'high', missing_fields: [] }, okHist, {}); // no adapterUrl

  const decisions = calls.map(c => c.decision);
  assert.ok(decisions.includes('cheap_gate_confidence'), 'low confidence path 必上报');
  assert.ok(decisions.includes('cheap_gate_side'), 'non buy/sell side 必上报');
  assert.ok(decisions.includes('cheap_gate_missing_fields'), 'missing_fields 路径必上报');
  assert.ok(decisions.includes('no_adapter_url'), 'no adapter url 路径必上报');
  assert.equal(calls.length, 4, '4 cheap-gate paths 全 4 次 telemetry');
});

test('M-confidence fix: source markers 守', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // M-confidence fix marker
  assert.match(src, /M-confidence fix/, 'M-confidence fix marker 必保留');
  // schema 加 evm_address 字段 (允许 LLM surface 进 intent + missing_fields)
  assert.match(src, /"evm_address":\s*"0x\[40 hex\]"/, 'schema 必含 evm_address 字段');
  // confidence 判定规则真有
  assert.match(src, /confidence 必按下面规则判/, 'confidence 判定规则真在 prompt');
  assert.match(src, /字段齐 \+ user confirm → 必返 "high"/, 'high trigger 真规则真在');
  // missing_fields example 加 evm_address
  assert.match(src, /evm_address.*missing_fields|missing_fields.*evm_address/, 'missing_fields example 真含 evm_address');
});

test('M-2 + M-3 fix: source markers 守', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // M-2: T1_DISCLAIMER 必删除
  assert.match(src, /漏洞 M-2 fix/, 'M-2 fix marker 必保留');
  assert.doesNotMatch(src, /const T1_DISCLAIMER/, 'M-2: T1_DISCLAIMER const 真已删除');
  // M-2: generateReply 函数体不能含 disclaimer 文本 (history 注释允许 reference)
  const generateReplyFn = src.match(/export function generateReply\(intent\)\s*\{([\s\S]*?)^\}/m);
  assert.ok(generateReplyFn, 'generateReply 函数必存在');
  assert.doesNotMatch(generateReplyFn[1], /T1 验证阶段/, 'M-2: generateReply 函数体真不再含 T1 disclaimer 文本');
  assert.doesNotMatch(generateReplyFn[1], /暂时不能完成实际撮合/, 'M-2: generateReply 函数体真不再含 disclaimer 关键句');
  // M-2: 新文案 "准备出报价" 必有 (替换原 disclaimer 信号)
  assert.match(src, /准备出报价/, 'M-2: ready-to-publish 文案必在');
  // M-3: publishOffer fail telemetry
  assert.match(src, /漏洞 M-3 fix/, 'M-3 fix marker 必保留');
  assert.match(src, /publish_offer_failed/, 'M-3: publish_offer_failed decision 必有');
});

test('M-1: source — _reportPublishDecision marker 守 (防未来 regression)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // 漏洞 M-1 fix marker
  assert.match(src, /漏洞 M-1 fix/, 'M-1 fix marker 必保留');
  // helper 函数存在
  assert.match(src, /async _reportPublishDecision/, '_reportPublishDecision helper 必定义');
  // event_type 'matcher_publish_decision'
  assert.match(src, /matcher_publish_decision/, 'eventType matcher_publish_decision 必有');
  // 4 个 cheap-gate decision name 全在
  for (const d of ['cheap_gate_confidence', 'cheap_gate_side', 'cheap_gate_missing_fields', 'no_adapter_url', 'llm_ready_true', 'llm_ready_false', 'llm_call_or_parse_fail']) {
    assert.match(src, new RegExp(`['"]${d}['"]`), `decision '${d}' marker 必有`);
  }
  // /ingest/event endpoint
  assert.match(src, /\/ingest\/event/, '/ingest/event endpoint 必 POST');
  // x-ingest-secret header
  assert.match(src, /x-ingest-secret/, 'x-ingest-secret header 必有');
});

test('T3.2 reactToChainEvents fail-closed when address/consoleUrl missing', async () => {
  const m = new MatcherSkill();
  const r1 = await m.reactToChainEvents('', { consoleUrl: 'http://x' });
  assert.deepEqual(r1.activeOffers, []);
  assert.equal(r1.reason, 'no_address_or_console');
  const r2 = await m.reactToChainEvents('kaspa:abc', null);
  assert.deepEqual(r2.activeOffers, []);
  assert.equal(r2.reason, 'no_address_or_console');
});

test('T3.2 reactToChainEvents fetch err returns activeOffers=[] (NOT throw)', async () => {
  const m = new MatcherSkill();
  // unreachable port → fetchJson throws → catch returns {activeOffers:[], error:...}
  const r = await m.reactToChainEvents('kaspa:abc', { consoleUrl: 'http://127.0.0.1:1' });
  assert.deepEqual(r.activeOffers, []);
  assert.ok(r.error, 'error field set on fetch fail');
});

test('T3.2 source: reactToChainEvents 0 own state (per §9.5 #1)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // 0 instance Map/Set holding offer state across cycles (per anti-pattern #1)
  assert.doesNotMatch(src, /this\._offerStateCache\s*=/);
  assert.doesNotMatch(src, /this\._reactorMemory\s*=/);
  // reactToChainEvents must fetch 每 cycle (0 cache)
  assert.match(src, /\/api\/exchange\/offers\?maker=/);
});

test('T3.3 emitChainProtocol throws on missing relayNodeId', async () => {
  const m = new MatcherSkill();
  m._config = {}; // missing relayNodeId
  await assert.rejects(
    () => m.emitChainProtocol('kanet_exchange_delivered_v1', { offer_id: 'x' }),
    /relayNodeId missing/,
  );
});

test('T3.3 emitDeliveryInitiated wraps emitChainProtocol with delivered_v1 event', async () => {
  const m = new MatcherSkill();
  m._config = { relayNodeId: 'test-uuid', consoleUrl: 'http://127.0.0.1:1' };
  // unreachable consoleUrl → fetchJson throws (validate it gets to the fetch step, NOT relayNodeId guard)
  await assert.rejects(
    () => m.emitDeliveryInitiated('offer-1', '0.5', 'kaspa:abc', 'kastx-1'),
    /fetch failed|ECONNREFUSED|connect ECONNREFUSED|fetch error/i,
  );
});

test('T3.3 source: emitChainProtocol uses Relay send-command + kanet-exchange channel (KI-4)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  // Must use Relay send-command pattern (NOT direct chain TX, NOT new /api/exchange/verify)
  assert.match(src, /\/api\/relay\/.*send-command/);
  assert.match(src, /'send_broadcast'/);
  assert.match(src, /'kanet-exchange'/);
  // 0 sqlite import (skill HTTP-only KI-4)
  assert.doesNotMatch(src, /from\s+['"]better-sqlite3['"]/);
});

test('T3.5 notifyTransition sends user-friendly message for known transition', async () => {
  const m = new MatcherSkill();
  let captured = null;
  const actionExecutor = { executeOne: async (a) => { captured = a; return { ok: true }; } };
  await m.notifyTransition('offer-1', 'kaspa:peer', 'matched', 'verifying', actionExecutor);
  assert.ok(captured);
  assert.equal(captured.target, 'kaspa:peer');
  assert.equal(captured.type, 'send_message');
  assert.match(captured.message, /付款已收到.*验证/);
});

test('T3.5 notifyTransition returns null for unknown transition key', async () => {
  const m = new MatcherSkill();
  const actionExecutor = { executeOne: async () => { throw new Error('should not call'); } };
  const r = await m.notifyTransition('offer-1', 'kaspa:peer', 'open', 'completed', actionExecutor);
  assert.equal(r, null);
});

test('T3.5 notifyTransition returns null without peerAddress / actionExecutor', async () => {
  const m = new MatcherSkill();
  const actionExecutor = { executeOne: async () => ({ ok: true }) };
  assert.equal(await m.notifyTransition('offer-1', '', 'matched', 'verifying', actionExecutor), null);
  assert.equal(await m.notifyTransition('offer-1', 'kaspa:peer', 'matched', 'verifying', null), null);
  assert.equal(await m.notifyTransition('offer-1', 'kaspa:peer', 'matched', 'verifying', {}), null);
});

test('T3.5 notifyTransition stripMarkdown applies (KI-18 platform-agnostic)', async () => {
  const m = new MatcherSkill();
  let captured = null;
  const actionExecutor = { executeOne: async (a) => { captured = a; return { ok: true }; } };
  await m.notifyTransition('offer-1', 'kaspa:peer', 'delivering', 'completed', actionExecutor);
  // Message must NOT contain raw markdown (** or *)
  assert.doesNotMatch(captured.message, /\*\*/);
  // 完成 message check
  assert.match(captured.message, /KAS 已发出.*交易完成/);
});

// ── T3.6: integration + source-level invariant assertion ───────────────────────

test('T3.6 notifyTransition covers all 8 lifecycle transition keys', async () => {
  const m = new MatcherSkill();
  const transitions = [
    ['open', 'matched'], ['matched', 'verifying'],
    ['verifying', 'delivering'], ['delivering', 'completed'],
    ['open', 'timed_out'], ['matched', 'disputed'],
    ['verifying', 'disputed'], ['matched', 'cancelled'],
  ];
  let count = 0;
  const ae = { executeOne: async () => { count++; return { ok: true }; } };
  for (const [oldS, newS] of transitions) {
    const r = await m.notifyTransition('offer-x', 'kaspa:peer', oldS, newS, ae);
    assert.ok(r, `transition ${oldS}→${newS} must produce message`);
  }
  assert.equal(count, 8, 'all 8 transition keys must trigger send');
});

test('T3.6 source: matcher 0 SQL UPDATE exchange_offers (per §9.5 #2)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  assert.doesNotMatch(src, /UPDATE\s+exchange_offers/i);
  assert.doesNotMatch(src, /INSERT\s+INTO\s+exchange_offers/i);
});

test('T3.6 source: matcher 0 direct sendKaspa / sqlite (skill HTTP-only KI-4)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  assert.doesNotMatch(src, /\bsendKaspa\s*\(/);
  assert.doesNotMatch(src, /from\s+['"]better-sqlite3['"]/);
  assert.doesNotMatch(src, /from\s+['"]\.\.\/db\/client/);
});

test('T3.6 integration: extractIntent → asyncShouldPublish → reactor wiring (mock)', async () => {
  const m = new MatcherSkill();
  // Skip publishOffer (no relayNodeId): reactor still runs, asyncShouldPublish cheap-gates to false
  m._senderAddress = 'kaspa:peer';
  const config = { adapterUrl: 'http://127.0.0.1:99999', consoleUrl: 'http://127.0.0.1:99999', address: 'kaspa:trader-m' };
  const gathered = { peer: null, history: [{ dir: 'in', text: '查询' }], broadcasts: [], metadata: {} };
  // Adapter unreachable → _extractIntentT1 returns fallback intent.side='none'
  // asyncShouldPublish cheap gates → false (confidence!=high). reactor → activeOffers=[] (fetch err)
  const intent = await m.extractIntent(gathered, '查询', config);
  assert.equal(intent.should_publish, false, 'cheap gates short-circuit');
  assert.ok(intent._reactor, 'reactor result attached to intent');
  assert.deepEqual(intent._reactor.activeOffers, [], 'reactor fail-closed empty');
});

test('T2 publishOffer uses this._config.relayNodeId (T1.5 sediment)', async () => {
  const m = new MatcherSkill();
  m._config = {}; // missing relayNodeId
  await assert.rejects(
    () => m.publishOffer({ side: 'buy', qty: 50, asset: 'KAS', qty_unit: 'USDT' }),
    /relayNodeId missing/,
  );
});

test('T2 publishOffer rejects invalid intent (side / qty / asset)', async () => {
  const m = new MatcherSkill();
  m._config = { relayNodeId: 'test-uuid' };
  await assert.rejects(() => m.publishOffer({ side: 'none', qty: 50, asset: 'KAS' }), /invalid intent\.side/);
  await assert.rejects(() => m.publishOffer({ side: 'buy', qty: null, asset: 'KAS' }), /missing qty\/asset/);
});

test('T2 computePricing buy/sell shapes (KAS↔USDT MID 0.04)', () => {
  const m = new MatcherSkill();
  const buyP = m.computePricing({ side: 'buy', qty: 100, qty_unit: 'USDT', asset: 'KAS', pay_chain: 'BSC' });
  assert.equal(buyP.give_asset, 'KAS');
  assert.equal(buyP.want_asset, 'USDT');
  assert.equal(buyP.want_amount, '100');
  assert.equal(parseFloat(buyP.give_amount), 100 / 0.04);
  const sellP = m.computePricing({ side: 'sell', qty: 100, asset: 'KAS', pay_chain: 'ETH' });
  assert.equal(sellP.give_asset, 'KAS');
  assert.equal(sellP.want_asset, 'USDT');
  assert.equal(parseFloat(sellP.want_amount), 100 * 0.04);
});

test('T2 generateOfferFeedback contains offer_id + give/want + T2 disclaimer', () => {
  const m = new MatcherSkill();
  const offerResult = {
    offer_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    payload: { give_asset: 'KAS', give_amount: '2500', give_chain: 'kaspa', want_asset: 'USDT', want_amount: '100', want_chain: 'BSC' },
  };
  const buyMsg = m.generateOfferFeedback({ side: 'buy' }, offerResult);
  assert.match(buyMsg, /eeeeeeee/); // last-8 of offer_id
  assert.match(buyMsg, /T2 阶段/);
  assert.match(buyMsg, /BSC/);
  const sellMsg = m.generateOfferFeedback({ side: 'sell' }, offerResult);
  assert.match(sellMsg, /T2 阶段/);
});

test('T2 formatForBrain offerResult set → offer feedback path (stripMarkdown applied)', async () => {
  const m = new MatcherSkill();
  m.canActivate('reactive', { _senderAddress: 'kaspa:qtest', _inputMessage: '好的' });
  m._config = { adapterUrl: null };
  // Override extractIntent to inject offerResult (avoid live LLM/HTTP)
  m.extractIntent = async () => ({
    side: 'buy', asset: 'KAS', qty: 50, qty_unit: 'USDT', pay_chain: 'BSC',
    confidence: 'high', missing_fields: [],
    _offerResult: { offer_id: '12345678-aaaa-bbbb-cccc-deadbeef0000', payload: { give_asset: 'KAS', give_amount: '1250', give_chain: 'kaspa', want_asset: 'USDT', want_amount: '50', want_chain: 'BSC' } },
  });
  const r = await m.formatForBrain({ peer: null, history: [], metadata: {} });
  assert.match(r.instructions, /报价/);
  assert.match(r.instructions, /T2 阶段/);
  assert.ok(!r.instructions.includes('**'), 'stripMarkdown applied (no ** literal)');
});

test('T2 formatForBrain publishError set → error feedback path', async () => {
  const m = new MatcherSkill();
  m.canActivate('reactive', { _senderAddress: 'kaspa:qtest', _inputMessage: '好的' });
  m._config = {};
  m.extractIntent = async () => ({
    side: 'buy', confidence: 'high', missing_fields: [],
    _offerResult: null, _publishError: 'KANet endpoint unreachable',
  });
  const r = await m.formatForBrain({ peer: null, history: [], metadata: {} });
  assert.match(r.instructions, /发布报价时出错了/);
  assert.match(r.instructions, /KANet endpoint unreachable/);
});

test('T2 source: 0 instance state holding offer (per §11 #1)', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/skills/matcher.mjs', import.meta.url), 'utf-8');
  const forbidden = /this\.(offers|_offers|_lastOffer|_offerCache|offerMap)\b/;
  assert.ok(!forbidden.test(src), 'matcher instance must NOT hold offer state per §11 #1');
});

// Integration test (Trader-M live + LLM extract + Brain reply + retail_dex_orders 0 增) defer T1.9.
// per NWT r118: T1.6 acceptance live verify defer T1.9 12h 守同期 operator hat --apply trigger.
