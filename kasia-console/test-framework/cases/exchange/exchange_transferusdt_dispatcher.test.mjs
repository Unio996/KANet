/**
 * Regression test — transferUsdt dispatcher 7 EVM + asset 参数透传
 *
 * NWT β 路径 Phase 2 Sub #1 ship (J2 #327 push back Option B refined ~33 LOC, NWT verdict 36594ed6 PASS).
 *
 * Bug 5/12 sediment §1: transferUsdt L204 dispatcher 只路由 bnb/eth → transferERC20,
 * polygon/arbitrum/optimism/avalanche/base 5 EVM 全走 'Unsupported chain' error.
 *
 * Fix: dispatcher 用 isEvmChain(chain) 路由 + 加第 5 参数 asset='USDT' 透传给 transferERC20.
 * ALL_SUPPORTED_CHAINS 派生 from chains.js EVM_RPC_URLS (自动 7 EVM) + sol + tron = 9 chain.
 *
 * Caller 兼容: 4 caller (broker-v2/router L175, exchange-machine L220, market-seeder L118,
 * broker-intake-watcher L860 dead) 仍 4 参数 call, asset 默 'USDT'. 只 trade-protocol-filter
 * L1376 (exchange auto-pay) 加 1 LOC asset 透传 offer.want_asset for base USDC e2e.
 *
 * 注: source-pattern 静态 guard (node --test). framework runner SKIP no default export.
 * 跑法: node --test test-framework/cases/exchange/exchange_transferusdt_dispatcher.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVM_TRANSFER_JS = readFileSync(join(__dirname, '../../../src/services/evm-transfer.js'), 'utf-8');
const TRADE_PROTOCOL_FILTER_JS = readFileSync(join(__dirname, '../../../src/services/trade-protocol-filter.js'), 'utf-8');

test('evm-transfer.js imports isEvmChain from chains.js', () => {
  assert.match(EVM_TRANSFER_JS, /import\s+\{[^}]*isEvmChain[^}]*\}\s+from\s+['"]\.\/chains\.js['"]/, 'isEvmChain import 缺失');
});

test('ALL_SUPPORTED_CHAINS 派生 from chains.js (NOT hardcode 4 chain)', () => {
  assert.doesNotMatch(EVM_TRANSFER_JS, /new\s+Set\s*\(\s*\[\s*['"]bnb['"]\s*,\s*['"]eth['"]\s*,\s*['"]sol['"]\s*,\s*['"]tron['"]\s*\]\s*\)/, 'ALL_SUPPORTED_CHAINS 仍硬编码 4 chain — Sub #1 fix 没生效');
  assert.match(EVM_TRANSFER_JS, /ALL_SUPPORTED_CHAINS[\s\S]{0,100}EVM_RPC_URLS/, 'ALL_SUPPORTED_CHAINS 没派生 from EVM_RPC_URLS');
});

test('transferUsdt signature 含 asset 参数 default USDT', () => {
  assert.match(EVM_TRANSFER_JS, /export\s+async\s+function\s+transferUsdt\s*\([^)]*asset\s*=\s*['"]USDT['"][^)]*\)/, 'transferUsdt 缺 asset 第 5 参数');
});

test('transferUsdt dispatcher 用 isEvmChain (NOT ["bnb","eth"] 硬编码)', () => {
  assert.doesNotMatch(EVM_TRANSFER_JS, /if\s*\(\s*\[\s*['"]bnb['"]\s*,\s*['"]eth['"]\s*\]\s*\.includes\s*\(\s*chain\s*\)\s*\)/, 'transferUsdt 仍硬编码 ["bnb","eth"] — 5 EVM 不会路由');
  assert.match(EVM_TRANSFER_JS, /if\s*\(\s*isEvmChain\s*\(\s*chain\s*\)\s*\)\s*return\s+transferERC20/, 'transferUsdt 缺 isEvmChain 路由');
});

test('transferUsdt 透传 asset to transferERC20', () => {
  assert.match(EVM_TRANSFER_JS, /return\s+transferERC20\s*\(\s*chain\s*,[^,]+,[^,]+,[^,]+,\s*asset\s*\)/, 'transferUsdt 没透传 asset 到 transferERC20');
});

test('trade-protocol-filter _autoPayExchange 透传 offer.want_asset', () => {
  assert.match(TRADE_PROTOCOL_FILTER_JS, /transferUsdt\s*\(\s*chain\s*,\s*wallet\.privkey_encrypted\s*,\s*receiveAddress\s*,\s*amount\s*,\s*offer\.want_asset/, 'trade-protocol-filter _autoPayExchange caller 没透传 offer.want_asset');
});
