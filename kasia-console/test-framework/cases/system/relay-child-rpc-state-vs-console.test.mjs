/**
 * Regression test — relay child RPC state vs console daemon RPC scope distinction
 *
 * 5/12 ws-proxy hijack 暴露的 UI 误导根因:
 *   /api/config/rpc-status 测 console daemon 自己 RpcClient (用 getWorkingRpc)
 *   而 relay child 内部 _rpc state 完全独立 — daemon "全绿" 时 relay child 可能死循环 reconnect.
 *
 * 修法 (T-J2-2026-05-12): 新 surface /api/relay/:id/rpc-state + /api/system/rpc-overview 走 IPC 拿
 * relay child 内部 state, 跟 daemon 老 endpoint 语义分离.
 *
 * Guard: 防止 future refactor 把两 surface 合并 (e.g. daemon endpoint 改用 relay child 数据,
 * OR relay child endpoint fallback 到 daemon 数据) → 复刻 误导 bug.
 *
 * Run: node --test kasia-console/test-framework/cases/system/relay-child-rpc-state-vs-console.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_JS = readFileSync(join(__dirname, '../../../src/api/settings.js'), 'utf-8');
const API_RELAY = readFileSync(join(__dirname, '../../../src/api/relay.js'), 'utf-8');
const RELAY_MGR = readFileSync(join(__dirname, '../../../src/services/relay-manager.js'), 'utf-8');

// 提取 fastify handler body — 用下个 fastify.get/post/put/delete OR 文件尾作 delimiter (避内嵌 });}）误匹配)
function extractHandler(src, routePattern) {
  const startMatch = src.match(new RegExp(`fastify\\.(get|post|put|delete)\\(['"]${routePattern}['"]`));
  if (!startMatch) return null;
  const startIdx = startMatch.index;
  // 找下一个 fastify.<verb>( OR 文件尾
  const tail = src.slice(startIdx + 1);
  const nextMatch = tail.match(/fastify\.(get|post|put|delete)\(/);
  const endIdx = nextMatch ? startIdx + 1 + nextMatch.index : src.length;
  return src.slice(startIdx, endIdx);
}

test('/api/config/rpc-status uses getWorkingRpc (console daemon scope), NOT getRelayRpcState', () => {
  const handlerBlock = extractHandler(SETTINGS_JS, '\\/api\\/config\\/rpc-status');
  assert.ok(handlerBlock, '/api/config/rpc-status handler not found in settings.js');
  assert.match(handlerBlock, /getWorkingRpc/, 'daemon endpoint must use getWorkingRpc');
  assert.ok(!/getRelayRpcState/.test(handlerBlock), 'daemon endpoint must NOT collapse into relay child probe');
});

test('/api/relay/:id/rpc-state uses getRelayRpcState (relay child scope), NOT getWorkingRpc', () => {
  const handlerBlock = extractHandler(API_RELAY, '\\/api\\/relay\\/:id\\/rpc-state');
  assert.ok(handlerBlock, '/api/relay/:id/rpc-state handler not found in api/relay.js');
  assert.match(handlerBlock, /getRelayRpcState/, 'relay child endpoint must use getRelayRpcState');
  assert.ok(!/getWorkingRpc/.test(handlerBlock), 'relay child endpoint must NOT fallback to daemon-scoped getWorkingRpc');
});

test('/api/system/rpc-overview iterates listRelayNodes (per-relay aggregation), NOT single daemon state', () => {
  const handlerBlock = extractHandler(API_RELAY, '\\/api\\/system\\/rpc-overview');
  assert.ok(handlerBlock, '/api/system/rpc-overview handler not found');
  assert.match(handlerBlock, /listRelayNodes/, 'overview must iterate listRelayNodes (per-relay scope)');
  assert.match(handlerBlock, /Promise\.all/, 'overview must parallel-probe all relays');
  assert.ok(!/getWorkingRpc/.test(handlerBlock), 'overview must NOT use daemon-scoped getWorkingRpc');
});

test('getRelayRpcState wrap routes via IPC (sendCommandAsync), NOT direct daemon getServerInfo', () => {
  const wrapBlock = RELAY_MGR.match(/export\s+async\s+function\s+getRelayRpcState[\s\S]*?^\}/m);
  assert.ok(wrapBlock, 'getRelayRpcState wrap not found');
  assert.match(wrapBlock[0], /sendCommandAsync/, 'wrap must route via IPC sendCommandAsync');
  assert.match(wrapBlock[0], /get_rpc_state/, 'wrap must send get_rpc_state command');
  assert.ok(!/getServerInfo|getWorkingRpc|new\s+RpcClient/.test(wrapBlock[0]), 'wrap must NOT directly probe RPC (must go through relay child)');
});

test('settings.eta UI: daemon Node Connection + relay child states are two distinct sections', () => {
  const SETTINGS_ETA = readFileSync(join(__dirname, '../../../src/ui/settings.eta'), 'utf-8');
  // 老 section 用 rpc-status (daemon)
  assert.match(SETTINGS_ETA, /\/api\/config\/rpc-status/, 'settings.eta daemon section (rpc-status endpoint) missing');
  // 新 section 用 rpc-overview (relay child aggregate)
  assert.match(SETTINGS_ETA, /\/api\/system\/rpc-overview/, 'settings.eta relay-child section (rpc-overview endpoint) missing');
  // 两 section 用不同 fetch endpoint, 验证 UI 真分离 (不只 alias)
  const overviewCount = (SETTINGS_ETA.match(/\/api\/system\/rpc-overview/g) || []).length;
  const statusCount = (SETTINGS_ETA.match(/\/api\/config\/rpc-status/g) || []).length;
  assert.ok(overviewCount >= 1 && statusCount >= 1, `both endpoints must appear (overview:${overviewCount}, status:${statusCount})`);
});
