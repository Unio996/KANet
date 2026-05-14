/**
 * Bug H Sub Tier-1 — broker-escrow custody mode env flag regression (Owner 12:05 钦定 candidate A v2, ship γ).
 *
 * Owner 11:28 实测撞 broker-as-maker semantic gap (broker 帮 user 挂 SELL offer, user 没 prepay).
 * Owner 12:05 钦定 candidate A v2 = broker-escrow custody (user prepay → broker publish backed by escrow).
 * Ship γ (NWT 11:43 + J2 #357 + Owner 钦定 ok): env flag `BROKER_V3_ESCROW_MODE` 默认 false, 60/60 不退.
 * 全 ship + 测试 done 后 Owner 翻 flag → escrow flow 生效.
 *
 * 跑法: node --test test-framework/cases/broker/bug_h_escrow_mode_flag.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');
const ROUTER = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
const MIGRATE = readFileSync(join(__dirname, '../../../src/db/migrate.js'), 'utf-8');

test('Bug H γ — state-machine.js 加 ESCROW_MODE env flag (default false)', () => {
  assert.match(STATE_MACHINE, /const ESCROW_MODE = process\.env\.BROKER_V3_ESCROW_MODE === 'true'/, 'ESCROW_MODE must read env flag');
});

test('Bug H γ — CONFIRM "YES" 走 ESCROW_MODE 分支 (on → triggerQuote, off → triggerPublish legacy)', () => {
  assert.match(STATE_MACHINE, /if \(ESCROW_MODE\)\s*\{[\s\S]*?triggerQuote: true/, 'CONFIRM YES with ESCROW_MODE on must triggerQuote');
  assert.match(STATE_MACHINE, /triggerPublish: true/, 'CONFIRM YES with ESCROW_MODE off must triggerPublish (legacy)');
});

test('Bug H γ — WAIT_PREPAY state defensive — ESCROW_MODE off 走 clearFlowState fallback', () => {
  assert.match(STATE_MACHINE, /if \(cur\.step === 'WAIT_PREPAY'\)[\s\S]*?if \(!ESCROW_MODE\)[\s\S]*?clearFlowState/, 'WAIT_PREPAY defensive: if ESCROW_MODE off + state somehow here, clearFlowState fallback');
});

test('Bug H γ — router.js dispatch handles BOTH triggerQuote + triggerPublish', () => {
  assert.match(ROUTER, /result\.triggerQuote\)\s+reply = await _doQuote/, 'triggerQuote dispatched to _doQuote');
  assert.match(ROUTER, /result\.triggerPublish\)\s+reply = await _doPublish/, 'triggerPublish dispatched to _doPublish (legacy)');
});

test('Bug H γ — _doQuote function exists in router.js', () => {
  assert.match(ROUTER, /async function _doQuote\(peer, draft, relayNodeId, prevReply\)/, '_doQuote function defined');
});

test('Bug H γ — _doQuote uses deterministic quote_seq noise (NWT 12:12 ack)', () => {
  assert.match(ROUTER, /MAX\(quote_seq\),\s*0\)\s*\+\s*1/, '_doQuote derives next quote_seq from MAX(quote_seq)+1');
  assert.match(ROUTER, /nextSeq\s*%\s*9999/, '_doQuote uses seq % 9999 for noise (deterministic)');
});

test('Bug H γ — _doCheckPrepayStatus function exists in router.js', () => {
  assert.match(ROUTER, /async function _doCheckPrepayStatus\(peer, draft, prevReply\)/, '_doCheckPrepayStatus function defined');
});

test('Bug H γ — migration v107 user_escrow_balances 表存', () => {
  assert.match(MIGRATE, /\/\/ v107: Bug H/, 'v107 migration comment present');
  assert.match(MIGRATE, /CREATE TABLE user_escrow_balances/, 'user_escrow_balances table created');
  assert.match(MIGRATE, /quote_seq INTEGER NOT NULL/, 'quote_seq column for deterministic noise');
  assert.match(MIGRATE, /prepayment_tx TEXT UNIQUE/, 'prepayment_tx UNIQUE for anti-replay');
  assert.match(MIGRATE, /status TEXT NOT NULL DEFAULT 'pending_prepay'/, 'status default pending_prepay');
});

test('Bug H γ — escrow_balances 4 索引存 (user / offer / status / amount lookup)', () => {
  assert.match(MIGRATE, /CREATE INDEX idx_escrow_user/, 'idx_escrow_user');
  assert.match(MIGRATE, /CREATE INDEX idx_escrow_offer/, 'idx_escrow_offer');
  assert.match(MIGRATE, /CREATE INDEX idx_escrow_status/, 'idx_escrow_status');
  assert.match(MIGRATE, /CREATE INDEX idx_escrow_amount/, 'idx_escrow_amount (broker_recv_addr + amount_quoted + status for watcher lookup)');
});
