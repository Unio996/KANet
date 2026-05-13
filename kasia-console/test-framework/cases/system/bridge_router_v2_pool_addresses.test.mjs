/**
 * Source-pattern regression — bridge-router.js Stargate V2 pool addresses + structure
 *
 * NWT spec 63e6fb48 v0.1 + 8fbe164f Polygon addr fix + KI 第 6 次复刻 sediment.
 *
 * Guard: bridge-router.js exports correct Stargate V2 pool addresses (J2 #330 triple-verified
 * against gitbook docs). Polygon USDT pool 必用 docs-verified `0xd47b03ee...`, NOT NWT spec
 * v0.1 typo `0xd47bAd7A...` (production money loss vector if typo reintroduced).
 *
 * 跑法: node --test test-framework/cases/system/bridge_router_v2_pool_addresses.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROUTER = readFileSync(join(__dirname, '../../../src/services/bridge-router.js'), 'utf-8');

test('STARGATE_POOLS const exists with 5 chain mappings', () => {
  assert.match(BRIDGE_ROUTER, /const\s+STARGATE_POOLS\s*=\s*\{/, 'STARGATE_POOLS const missing');
  for (const chain of ['bnb', 'polygon', 'arbitrum', 'optimism', 'base']) {
    assert.match(BRIDGE_ROUTER, new RegExp(`\\b${chain}\\s*:\\s*\\{`), `STARGATE_POOLS missing ${chain} entry`);
  }
});

test('STARGATE_EIDS const exists with 5 chain mappings', () => {
  assert.match(BRIDGE_ROUTER, /const\s+STARGATE_EIDS\s*=\s*\{/, 'STARGATE_EIDS const missing');
  // Stargate V2 EIDs: BSC 30102, polygon 30109, arbitrum 30110, optimism 30111, base 30184
  for (const [chain, eid] of [['bnb', 30102], ['polygon', 30109], ['arbitrum', 30110], ['optimism', 30111], ['base', 30184]]) {
    assert.match(BRIDGE_ROUTER, new RegExp(`\\b${chain}\\s*:\\s*${eid}\\b`), `STARGATE_EIDS ${chain}=${eid} mismatch`);
  }
});

test('Polygon USDT pool uses docs-verified addr (NOT NWT spec typo)', () => {
  // J2 #330 triple-verified docs value:
  assert.match(BRIDGE_ROUTER, /0xd47b03ee6d86Cf251ee7860FB2ACf9f91B9fD4d7/i,
    'Polygon USDT pool MUST use docs-verified 0xd47b03ee... (NWT spec v0.1 typo 0xd47bAd7A... = money loss vector if reintroduced)');
  // Negative guard: typo addr must NOT appear in source
  assert.doesNotMatch(BRIDGE_ROUTER, /0xd47bAd7A5cd9F4b6BFEAfBdAE6Cf3B0bD61C0F4e/i,
    'NWT spec v0.1 typo addr reintroduced — Polygon bridge would lose funds (KI 第 6 次复刻警示)');
});

test('5 other pool addresses match docs-verified values', () => {
  const expected = [
    ['BSC USDT', '0x138EB30f73BC423c6455C53df6D89CB01d9eBc63'],
    ['BSC USDC', '0x962Bd449E630b0d928f308Ce63f1A21F02576057'],
    ['Arbitrum USDT', '0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0'],
    ['Optimism USDT', '0x19cFCE47eD54a88614648DC3f19A5980097007dD'],
    ['Base USDC', '0x27a16dc786820B16E5c9028b75B99F6f604b5d26'],
  ];
  for (const [label, addr] of expected) {
    assert.match(BRIDGE_ROUTER, new RegExp(addr, 'i'), `${label} pool addr ${addr} missing`);
  }
});

test('exports bridgeAsset and quoteBridge', () => {
  assert.match(BRIDGE_ROUTER, /export\s+async\s+function\s+bridgeAsset\b/, 'bridgeAsset export missing');
  assert.match(BRIDGE_ROUTER, /export\s+async\s+function\s+quoteBridge\b/, 'quoteBridge export missing');
});

test('bridgeAsset uses Stargate V2 ABI sendToken (NOT V1 swap)', () => {
  // V2 OFT API: sendToken; V1 was swap (易混). NWT spec §5 强调 V1 vs V2.
  assert.match(BRIDGE_ROUTER, /sendToken\s*\(/, 'bridgeAsset must call sendToken (V2 OFT API)');
  assert.doesNotMatch(BRIDGE_ROUTER, /\.swap\s*\(/, 'V1 swap() call detected — must use V2 sendToken');
});

test('NO TX NO STATE CHANGE — bridge_initiated recorded only after tx.wait', () => {
  // recordChainEvent('bridge_initiated', ...) MUST come after tx.wait(1) — not optimistic write.
  const m = BRIDGE_ROUTER.match(/await\s+tx\.wait\([\s\S]*?recordChainEvent[\s\S]*?bridge_initiated/);
  assert.ok(m,
    'bridge_initiated chain_event must record only after tx.wait() confirms — NO TX NO STATE CHANGE 铁律 (DEVELOPER-GUIDE 第零条 bis)');
});

test('LayerZero nativeFee paid as msg.value (NOT skipped)', () => {
  // sendToken(..., { value: quote.nativeFee }) — LayerZero gas paid in native, else revert
  assert.match(BRIDGE_ROUTER, /value\s*:\s*quote\.nativeFee/,
    'sendToken must pass nativeFee as msg.value — else LayerZero source TX revert (gas underfunded)');
});

test('SendParam taxi mode oftCmd default 0x (no Bus batching)', () => {
  // Stargate V2 Bus mode (oftCmd != '0x') batches cross-chain — NWT spec §3 taxi mode for low latency
  assert.match(BRIDGE_ROUTER, /oftCmd\s*:\s*['"]0x['"]/,
    'SendParam.oftCmd must be 0x (taxi mode, direct transfer) — Bus batching delays cross-chain');
});

test('ERC20 approval check before sendToken (Stargate Pool pulls tokens)', () => {
  // Stargate Pool transferFrom() needs allowance — must approve if insufficient.
  assert.match(BRIDGE_ROUTER, /\.allowance\s*\(/, 'must check ERC20 allowance before sendToken');
  assert.match(BRIDGE_ROUTER, /\.approve\s*\(/, 'must approve Stargate Pool to spend ERC20 if allowance insufficient');
});
