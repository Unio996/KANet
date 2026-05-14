/**
 * Source-pattern regression — broker-v3 menu chain selection 6 chain
 *
 * Phase B P0 fix (J2 #338 per NWT spec 4324dccc):
 * broker-v3/state-machine.js chain menu 加 optimism + base.
 * 5/13 broker prefund 4 chain (polygon/arb/op/base, Phase 2 β $77 真链 lock),
 * 但老 menu 只 4 chain (BSC/ETH/Polygon/Arbitrum) — user 走菜单选不到 op/base, 钱用不到.
 *
 * 跑法: node --test test-framework/cases/broker/broker_v3_menu_6_chain.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');

test('SUPPORTED_CHAINS const 含 6 chain (含 optimism + base)', () => {
  assert.match(STATE_MACHINE, /SUPPORTED_CHAINS\s*=\s*\[\s*['"]bsc['"],\s*['"]eth['"],\s*['"]polygon['"],\s*['"]arbitrum['"],\s*['"]optimism['"],\s*['"]base['"]\s*\]/, 'SUPPORTED_CHAINS must contain 6 chain (bsc/eth/polygon/arbitrum/optimism/base)');
});

test('_chainSelectText menu lists optimism + base', () => {
  assert.match(STATE_MACHINE, /5️⃣\s*Optimism/, 'menu chain option 5 must be Optimism');
  assert.match(STATE_MACHINE, /6️⃣\s*Base/, 'menu chain option 6 must be Base');
  assert.match(STATE_MACHINE, /回数字\s+1-6\s+选/, 'prompt must say 1-6 (not 1-4)');
});

test('_handleTradeFlow chains array 6 chain', () => {
  assert.match(STATE_MACHINE, /const\s+chains\s*=\s*\[\s*['"]bsc['"],\s*['"]eth['"],\s*['"]polygon['"],\s*['"]arbitrum['"],\s*['"]optimism['"],\s*['"]base['"]\s*\]/, 'CHAIN_SELECT branch chains array must be 6 chain');
  // 5/14 Bug-D-residual: literal "1-6" → template literal `1-${SUPPORTED_CHAINS.length}` for future-proof
  assert.match(STATE_MACHINE, /数字超范围,\s*回\s+1-(\$\{SUPPORTED_CHAINS\.length\}|6)\s+选链/, 'error message must reference 1-6 (literal OR template)');
});

test('old 4-chain hardcode 不存 (negative regression guard)', () => {
  // Old menu had '回数字 1-4 选, back 返回菜单.' — must NOT exist anywhere after P0 fix
  assert.doesNotMatch(STATE_MACHINE, /回数字\s+1-4\s+选[^链]/, 'old menu "回数字 1-4 选" must not exist (P0 fix incomplete)');
});
