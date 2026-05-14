/**
 * Bug C — chain === naked compare 漏 normalize regression (NWT 10:17 C4.4 Tier 4 surface).
 *
 * 5/14 C4.4 'Yes' confirm accept: broker reply "接单失败: 你没有 bsc 钱包"
 * 真因: server `/api/exchange/accept` L427 `chains.find(c => c.chain === selected_chain)`
 *   selected_chain='bsc' (broker-v3 menu label hardcoded), c.chain='bnb' (DB-canonical
 *   5/12 sediment) → 'bsc' !== 'bnb' fail. 5/12 §3.2 修了 L382 acceptedChains, 漏 L251
 *   + L427 chains.find + router.js L197 makerAddr.
 *
 * 修: 3 处全走 normalizeChainKey 双 wrap.
 *
 * 跑法: node --test test-framework/cases/broker/bug_c_chain_normalize_regression.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXCHANGE_JS = readFileSync(join(__dirname, '../../../src/api/exchange.js'), 'utf-8');
const ROUTER_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');

test('Bug C — exchange.js L251 (give_chain publish pre-check) uses normalizeChainKey双 wrap', () => {
  assert.match(EXCHANGE_JS, /const\s+giveChainNorm\s*=\s*normalizeChainKey\(give_chain\);\s*\n\s*const\s+chainWallet\s*=\s*chains\.find\(c\s*=>\s*normalizeChainKey\(c\.chain\)\s*===\s*giveChainNorm\)/, 'give_chain pre-check must use normalizeChainKey双 wrap');
});

test('Bug C — exchange.js L427 (selected_chain accept pre-check) uses normalizeChainKey双 wrap', () => {
  assert.match(EXCHANGE_JS, /const\s+selectedChainNorm\s*=\s*normalizeChainKey\(selected_chain\);\s*\n\s*const\s+chainWallet\s*=\s*chains\.find\(c\s*=>\s*normalizeChainKey\(c\.chain\)\s*===\s*selectedChainNorm\)/, 'selected_chain pre-check must use normalizeChainKey双 wrap');
});

test('Bug C — router.js L197 (makerAddr lookup) uses normalizeChainKey双 wrap', () => {
  assert.match(ROUTER_JS, /accepted_chains\?\.find\(c => normalizeChainKey\(c\.chain\)[^)]+\)\?\.address/, 'makerAddr lookup must use normalizeChainKey双 wrap (post-fix)');
});

test('Bug C — old naked === pattern not present in 3 fixed sites', () => {
  // Negative regression — these 3 lines previously had naked c.chain === X, must NOT come back.
  const exchangeGiveBlock = EXCHANGE_JS.match(/chains.find\([^)]+give_chain[^)]*\)/);
  if (exchangeGiveBlock) {
    assert.match(exchangeGiveBlock[0], /normalizeChainKey/, 'L251 give_chain find must contain normalizeChainKey');
  }
  const exchangeSelBlock = EXCHANGE_JS.match(/chains.find\([^)]+selected_chain[^)]*\)/);
  if (exchangeSelBlock) {
    assert.match(exchangeSelBlock[0], /normalizeChainKey/, 'L427 selected_chain find must contain normalizeChainKey');
  }
  const routerAcceptBlock = ROUTER_JS.match(/accepted_chains\?\.find\([^)]+selected_chain[^)]*\)/);
  if (routerAcceptBlock) {
    assert.match(routerAcceptBlock[0], /normalizeChainKey/, 'router.js makerAddr find must contain normalizeChainKey');
  }
});

test('Bug C — normalizeChainKey behavior smoke (bsc ↔ bnb double-alias)', () => {
  // exchange.js + router.js 各自定义 normalizeChainKey, body 必含 'bsc' → 'bnb' mapping.
  // 实际 pattern: `if (lower === 'bsc' || ...) return 'bnb';`
  assert.match(EXCHANGE_JS, /lower\s*===\s*['"]bsc['"][\s\S]{0,200}return\s+['"]bnb['"]/, 'exchange.js normalizeChainKey must map bsc → bnb');
  assert.match(ROUTER_JS, /lower\s*===\s*['"]bsc['"][\s\S]{0,200}return\s+['"]bnb['"]/, 'router.js normalizeChainKey must map bsc → bnb');
});
