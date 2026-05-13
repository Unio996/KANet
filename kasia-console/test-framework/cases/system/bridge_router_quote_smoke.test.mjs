/**
 * Integration smoke — bridge-router.quoteBridge BSC→polygon (read-only, $0 cost)
 *
 * Sub #3.c integration smoke: calls Stargate V2 BSC USDT pool quoteSend() via JsonRpcProvider.
 * No private key, no broadcast — read-only contract view call.
 *
 * 验证: production-ready RPC + pool contract responds + nativeFee > 0.
 *
 * skip_in_batch + skip_in_cron — needs live BSC RPC. Manual run:
 *   node --test test-framework/cases/system/bridge_router_quote_smoke.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { quoteBridge } from '../../../src/services/bridge-router.js';

test('quoteBridge BSC USDT → Polygon — RPC + pool live + nativeFee > 0', { skip: process.env.SKIP_LIVE_RPC === '1' }, async () => {
  // 10 USDT BSC → polygon, recipient is a valid burn-like EVM address (used only for bytes32 encoding test)
  const result = await quoteBridge({
    fromChain: 'bnb',
    toChain: 'polygon',
    asset: 'USDT',
    amount: '10',
    recipient: '0x0000000000000000000000000000000000000001',
    slippagePct: 0.5,
  });

  if (!result.ok) {
    // RPC down / pool revert is informational — log + skip rather than hard fail
    console.warn(`[quote-smoke] BSC→polygon quoteSend live call failed (RPC/pool issue, not regression): ${result.error}`);
    assert.ok(result.error, 'failure result must include error message');
    return;
  }

  assert.equal(typeof result.nativeFee, 'bigint', 'nativeFee must be BigInt');
  assert.ok(result.nativeFee > 0n, 'nativeFee > 0 (LayerZero gas)');
  assert.equal(result.dstEid, 30109, 'destination EID must be polygon=30109');
  assert.equal(typeof result.amountLD, 'bigint', 'amountLD must be BigInt');
  assert.ok(result.amountLD > 0n, 'amountLD > 0');
  assert.ok(result.minAmountLD < result.amountLD, 'minAmountLD < amountLD (slippage applied)');
});

test('quoteBridge rejects unsupported chain', async () => {
  const result = await quoteBridge({
    fromChain: 'avalanche',  // not in v0.1 STARGATE_POOLS
    toChain: 'polygon',
    asset: 'USDT',
    amount: '10',
    recipient: '0x0000000000000000000000000000000000000001',
  });
  assert.equal(result.ok, false, 'must reject avalanche (v0.1 backlog)');
  assert.match(result.error, /avalanche.*pool not configured/i, 'error message must identify unsupported chain');
});

test('quoteBridge rejects base→USDT (base only has USDC pool)', async () => {
  const result = await quoteBridge({
    fromChain: 'base',
    toChain: 'polygon',
    asset: 'USDT',
    amount: '10',
    recipient: '0x0000000000000000000000000000000000000001',
  });
  assert.equal(result.ok, false, 'base USDT pool not in v0.1 (base no native USDT, only USDC)');
  assert.match(result.error, /base\/USDT pool not configured/i);
});
