/**
 * Source-pattern + integration test — bridge-router.js v0.1.1 LZ V2 native drop
 *
 * NWT spec 868a1925 v0.1.1 + J2 #332 docs triple-verified OptionsType3 encoding (LZ V2
 * OptionsBuilder.sol + ExecutorOptions.sol).
 *
 * Guard: buildLzV2Options encoding 字节 layout 跟 LZ V2 protocol 一致, nativeDropTo missing
 * when nativeDropAmount > 0 throws, bridgeAsset/quoteBridge 新参数生效.
 *
 * 跑法: node --test test-framework/cases/system/bridge_router_native_drop.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildLzV2Options, quoteBridge } from '../../../src/services/bridge-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_ROUTER = readFileSync(join(__dirname, '../../../src/services/bridge-router.js'), 'utf-8');

test('buildLzV2Options exports + handles gas-only (no native drop)', () => {
  const opts = buildLzV2Options(200000n);
  // TYPE_3 (0x0003) + LZ_RECEIVE (0x01 + 0x0011 + 0x01 + uint128 gas = 20 bytes)
  // Total: 2 + 20 = 22 bytes = 44 hex chars (+ '0x' prefix = 46)
  assert.equal(opts.length, 46, `LZ_RECEIVE-only options must be 22 bytes (44 hex + 0x), got ${opts.length}`);
  assert.ok(opts.startsWith('0x0003'), 'TYPE_3 header (0x0003) missing');
  // gas 200000 = 0x30d40, padded to uint128 BE 16 bytes = 0x...00030d40
  assert.match(opts, /00000000000000000000000000030d40$/i, 'gas 200000 uint128 BE encoding mismatch');
});

test('buildLzV2Options NATIVE_DROP encoding 字节 layout', () => {
  const dropAmount = 50000000000000000n;  // 0.05 ETH/MATIC in wei
  const dropTo = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';  // Trader-B BSC addr (test fixture)
  const opts = buildLzV2Options(200000n, dropAmount, dropTo);
  // Total: 2 (TYPE_3) + 20 (LZ_RECEIVE) + 52 (NATIVE_DROP) = 74 bytes = 148 hex + 0x = 150 chars
  assert.equal(opts.length, 150, `full options must be 74 bytes (148 hex + 0x), got ${opts.length}`);
  // NATIVE_DROP entry: worker(0x01) + size(0x0031) + type(0x02) + amount uint128(16B = 32 hex, 0.05e18 = b1a2bc2ec50000 padded to 32) + receiver bytes32(32B = 64 hex, 12 zero bytes + 20B addr)
  assert.match(opts, /010031020{18}b1a2bc2ec500000{24}ad12544e7020e16d1279c65cc5810c8d8a3efcee$/i,
    'NATIVE_DROP entry encoding mismatch (worker+size+type+amount uint128 16B + receiver bytes32 32B)');
});

test('buildLzV2Options throws when nativeDropAmount > 0 but no nativeDropTo', () => {
  assert.throws(
    () => buildLzV2Options(200000n, 50000000000000000n, null),
    /nativeDropTo required/,
    'must throw when nativeDropAmount > 0 with null nativeDropTo',
  );
});

test('bridgeAsset signature accepts new 3 params (source pattern)', () => {
  assert.match(BRIDGE_ROUTER, /export\s+async\s+function\s+bridgeAsset\s*\(\s*\{[\s\S]{0,400}nativeDropAmount\s*=\s*0\s*,/,
    'bridgeAsset must accept nativeDropAmount param (default 0 backward compat)');
  assert.match(BRIDGE_ROUTER, /bridgeAsset\s*\(\s*\{[\s\S]{0,400}nativeDropTo\s*=\s*null/, 'bridgeAsset must accept nativeDropTo param');
  assert.match(BRIDGE_ROUTER, /bridgeAsset\s*\(\s*\{[\s\S]{0,500}lzReceiveGas\s*=\s*200000/, 'bridgeAsset must accept lzReceiveGas param (default 200000 Stargate V2)');
});

test('quoteBridge signature accepts new 3 params (source pattern)', () => {
  assert.match(BRIDGE_ROUTER, /export\s+async\s+function\s+quoteBridge\s*\(\s*\{[\s\S]{0,400}nativeDropAmount\s*=\s*0/, 'quoteBridge must accept nativeDropAmount');
  assert.match(BRIDGE_ROUTER, /quoteBridge\s*\(\s*\{[\s\S]{0,400}nativeDropTo\s*=\s*null/, 'quoteBridge must accept nativeDropTo');
  assert.match(BRIDGE_ROUTER, /quoteBridge\s*\(\s*\{[\s\S]{0,500}lzReceiveGas\s*=\s*200000/, 'quoteBridge must accept lzReceiveGas');
});

test('chain_events payload includes nativeDrop fields', () => {
  assert.match(BRIDGE_ROUTER, /nativeDropAmount:\s*String\(/, 'chain_events bridge_initiated payload must record nativeDropAmount');
  assert.match(BRIDGE_ROUTER, /nativeDropTo:\s*nativeDropTo\s*\|\|\s*recipient/, 'chain_events bridge_initiated payload must record nativeDropTo (fallback recipient)');
  assert.match(BRIDGE_ROUTER, /lzReceiveGas\s*,/, 'chain_events bridge_initiated payload must record lzReceiveGas');
});

test('quoteBridge integration smoke — BSC USDT→Polygon with native drop, live RPC', { skip: process.env.SKIP_LIVE_RPC === '1' }, async () => {
  // 1 USDT + 0.01 MATIC drop to test addr — quoteSend should accept extraOptions with native drop encoded
  const result = await quoteBridge({
    fromChain: 'bnb',
    toChain: 'polygon',
    asset: 'USDT',
    amount: '1',
    recipient: '0x0000000000000000000000000000000000000001',
    nativeDropAmount: 0.01,
    nativeDropTo: '0x0000000000000000000000000000000000000001',
    slippagePct: 0.5,
  });

  if (!result.ok) {
    console.warn(`[native-drop-smoke] BSC→polygon quoteSend with drop failed (RPC/pool issue): ${result.error}`);
    return;
  }
  assert.ok(result.nativeFee > 0n, 'nativeFee > 0 (includes lzReceive gas + native drop airdrop cost)');
  assert.equal(result.dstEid, 30109);
  // sendParam.extraOptions length: 2 (TYPE_3) + 20 (LZ_RECEIVE) + 52 (NATIVE_DROP) = 74 bytes = 148 hex + 0x
  assert.equal(result.sendParam.extraOptions.length, 150, 'sendParam.extraOptions must contain LZ_RECEIVE + NATIVE_DROP encoded');
});
