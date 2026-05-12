/**
 * Regression test — ws-proxy hijack detection via relay child rpc-state surface
 *
 * 5/12 ws-proxy hijack 40+ min UI 全绿但 relay child 死循环 reconnect.
 * 修法 (T-J2-2026-05-12 #1-#5): 加 getRpcState() chain (rpc-listener → IPC → wrap → API → UI)
 * 让 UI 真反映 relay child _rpc state.
 *
 * Guard: 整 chain 任一断 (export 丢/case 删/wrap 改/endpoint 删) 立刻 fail, 防 misleading UI 复刻.
 *
 * Run: node --test kasia-console/test-framework/cases/system/ws-proxy-hijack-detection.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RPC_LISTENER = readFileSync(join(__dirname, '../../../../kasia-relay/src/rpc-listener.mjs'), 'utf-8');
const RELAY_MJS = readFileSync(join(__dirname, '../../../../kasia-relay/src/relay.mjs'), 'utf-8');
const COMMANDS_MJS = readFileSync(join(__dirname, '../../../../kasia-relay/src/lib/commands.mjs'), 'utf-8');
const RELAY_MGR = readFileSync(join(__dirname, '../../../src/services/relay-manager.js'), 'utf-8');
const API_RELAY = readFileSync(join(__dirname, '../../../src/api/relay.js'), 'utf-8');

test('rpc-listener.mjs exports getRpcState with 6-field snapshot shape', () => {
  assert.match(RPC_LISTENER, /export\s+function\s+getRpcState\s*\(\s*\)/, 'export getRpcState() missing');
  for (const field of ['connected', 'reconnecting', 'attempt', 'currentUrl', 'lastConnectedAt', 'lastError']) {
    assert.match(RPC_LISTENER, new RegExp(`\\b${field}\\b`), `getRpcState snapshot field '${field}' missing`);
  }
});

test('rpc-listener._lastError set at 3 failure sites (disconnect/health/reconnect)', () => {
  // 3 个 set _lastError = ... 位置: disconnect listener / health check fail / reconnect catch
  const matches = RPC_LISTENER.match(/_lastError\s*=/g) || [];
  assert.ok(matches.length >= 4, `expect >=4 _lastError assignments (1 declaration + 3 set), found ${matches.length}`);
});

test('commands.mjs declares GET_RPC_STATE in all 3 schema tables', () => {
  assert.match(COMMANDS_MJS, /GET_RPC_STATE\s*:\s*['"]get_rpc_state['"]/, 'COMMAND_TYPES.GET_RPC_STATE missing');
  assert.match(COMMANDS_MJS, /\[COMMAND_TYPES\.GET_RPC_STATE\]\s*:\s*\[\]/, 'COMMAND_PAYLOAD_SCHEMA[GET_RPC_STATE] missing');
  assert.match(COMMANDS_MJS, /\[COMMAND_TYPES\.GET_RPC_STATE\]\s*:\s*\{\s*\}/, 'COMMAND_FIELD_TYPES[GET_RPC_STATE] missing');
});

test('relay.mjs IPC handler case get_rpc_state present + short-circuits generic reply', () => {
  assert.match(RELAY_MJS, /case\s+['"]get_rpc_state['"]\s*:/, 'IPC case get_rpc_state missing');
  // 验证 case body 内有 return (短路 generic), 不只 break — 不允 fall through generic txid reply
  const caseBlock = RELAY_MJS.match(/case\s+['"]get_rpc_state['"][\s\S]{0,400}?\}/);
  assert.ok(caseBlock, 'case body not parseable');
  assert.match(caseBlock[0], /\breturn\b/, 'case must `return` to short-circuit generic completion reply');
});

test('relay-manager.js exports getRelayRpcState with 5s timeout override', () => {
  assert.match(RELAY_MGR, /export\s+async\s+function\s+getRelayRpcState/, 'export getRelayRpcState missing');
  assert.match(RELAY_MGR, /sendCommandAsync\([^,]+,\s*\{[^}]*type:\s*['"]get_rpc_state['"][^}]*\},\s*5000\)/, '5s timeout override missing');
});

test('api/relay.js registers both endpoints (per-relay + aggregate)', () => {
  assert.match(API_RELAY, /fastify\.get\(['"]\/api\/relay\/:id\/rpc-state['"]/, '/api/relay/:id/rpc-state missing');
  assert.match(API_RELAY, /fastify\.get\(['"]\/api\/system\/rpc-overview['"]/, '/api/system/rpc-overview missing');
  // overview 必须聚合 summary
  assert.match(API_RELAY, /summary\s*[:=][\s\S]{0,200}\bconnected\b[\s\S]{0,80}\breconnecting\b[\s\S]{0,80}\bunreachable\b/, 'summary aggregation (connected/reconnecting/unreachable) missing');
});
