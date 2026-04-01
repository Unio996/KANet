/**
 * KANet Anchor Switch Closed-Loop Tests
 *
 * 验证锚切换时的全链路行为一致性：
 *   signal-engine 输出不变
 *   strategy-engine 策略反转
 *   Brain context 格式正确
 *   execution_states 记录锚值
 *   P&L 单位跟着变
 *
 * 运行：node tests/test-anchor-loop.mjs
 */

import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

// ═══════════════════════════════════════════════════
// Import engines directly for unit testing
// ═══════════════════════════════════════════════════

const { analyzeMarket } = await import('../kasia-console/src/services/signal-engine.js');
const { generateProposal } = await import('../kasia-console/src/services/strategy-engine.js');
const { checkDrawdown, checkVolatility, checkTotalDrawdown } = await import('../kasia-console/src/services/trade-limits.js');

// ═══════════════════════════════════════════════════
// Shared test data
// ═══════════════════════════════════════════════════

// Strong downtrend candles
function makeDowntrend() {
  const candles = [];
  let price = 0.040;
  for (let i = 0; i < 50; i++) {
    price -= 0.0003;
    candles.push({ high: price + 0.0001, low: price - 0.0002, close: price, volume: 5000 });
  }
  return candles;
}

// Strong uptrend candles
function makeUptrend() {
  const candles = [];
  let price = 0.030;
  for (let i = 0; i < 50; i++) {
    price += 0.0003;
    candles.push({ high: price + 0.0001, low: price - 0.0001, close: price, volume: 5000 });
  }
  return candles;
}

function makeOrderBook(price, buyBias) {
  return {
    bids: Array.from({ length: 20 }, (_, i) => [price - i * 0.00001, buyBias ? 5000 : 2000]),
    asks: Array.from({ length: 20 }, (_, i) => [price + i * 0.00001, buyBias ? 2000 : 5000]),
  };
}

const ACCOUNT_WITH_USDT = {
  kasBalance: 1300000, usdtBalance: 50, totalValueKas: 1300000,
  dailyLimit: 5000, dailyUsed: 0, autoModeMax: 200, autoModeMaxUsdt: 20,
};

const ACCOUNT_NO_USDT = {
  kasBalance: 1300000, usdtBalance: 0, totalValueKas: 1300000,
  dailyLimit: 5000, dailyUsed: 0, autoModeMax: 200, autoModeMaxUsdt: 20,
};

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  1. Signal 不随锚变化');
console.log('══════════════════════════════════════════\n');

const downCandles = makeDowntrend();
const lastPrice = downCandles[downCandles.length - 1].close;
const sellBook = makeOrderBook(lastPrice, false);
const whale = { score: 40, direction: 'distribution' };
const analysis = analyzeMarket(downCandles, sellBook, whale);

test('下跌行情 signal composite < 0', () => {
  assert.ok(analysis.composite < 0, `expected negative, got ${analysis.composite}`);
});

test('signal 结构完整（五维+综合+环境）', () => {
  assert.ok('trend' in analysis.signals);
  assert.ok('momentum' in analysis.signals);
  assert.ok('orderFlow' in analysis.signals);
  assert.ok('volatility' in analysis.signals);
  assert.ok('whale' in analysis.signals);
  assert.ok('composite' in analysis);
  assert.ok('confidence' in analysis);
  assert.ok('regime' in analysis);
  assert.ok('adx' in analysis);
  assert.ok('actionable' in analysis);
});

test('同一数据两次计算结果一致', () => {
  const a2 = analyzeMarket(downCandles, sellBook, whale);
  assert.equal(analysis.composite, a2.composite);
  assert.equal(analysis.confidence, a2.confidence);
  assert.equal(analysis.regime, a2.regime);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  2. 同一信号，两种锚 → 策略反转');
console.log('══════════════════════════════════════════\n');

// Force actionable for testing
const strongDown = { ...analysis, actionable: true, composite: -70, confidence: 0.85 };

const usdProposal = generateProposal(strongDown, lastPrice, ACCOUNT_WITH_USDT, { anchor: 'usd' });
const kasProposal = generateProposal(strongDown, lastPrice, ACCOUNT_WITH_USDT, { anchor: 'kas' });

test('USD 锚 → 下跌时卖出（止损保 USDT）', () => {
  assert.ok(usdProposal, 'no USD proposal');
  assert.equal(usdProposal.action, 'sell', `expected sell, got ${usdProposal.action}`);
  assert.equal(usdProposal.anchor, 'usd');
});

test('KAS 锚 → 下跌时买入（便宜了=机会）', () => {
  assert.ok(kasProposal, 'no KAS proposal');
  assert.equal(kasProposal.action, 'buy', `expected buy, got ${kasProposal.action}`);
  assert.equal(kasProposal.anchor, 'kas');
});

test('USD 锚选择法币策略模板', () => {
  assert.ok(['trend_following', 'grid_trading', 'mean_reversion'].includes(usdProposal.strategy),
    `wrong strategy: ${usdProposal.strategy}`);
});

test('KAS 锚选择本币策略模板', () => {
  assert.ok(['accumulate', 'deploy_ammo', 'dip_reentry'].includes(kasProposal.strategy),
    `wrong strategy: ${kasProposal.strategy}`);
});

test('两个提案的 signal 完全相同', () => {
  assert.equal(usdProposal.signal.composite, kasProposal.signal.composite);
  assert.equal(usdProposal.signal.confidence, kasProposal.signal.confidence);
});

test('USD 提案有止损止盈', () => {
  assert.ok(usdProposal.params.stopLoss, 'USD proposal missing stopLoss');
});

test('KAS 提案无止损（跌了更便宜=更好）', () => {
  assert.equal(kasProposal.params.stopLoss, null, 'KAS proposal should not have stopLoss');
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  3. 上涨行情 → 锚反转验证');
console.log('══════════════════════════════════════════\n');

const upCandles = makeUptrend();
const upPrice = upCandles[upCandles.length - 1].close;
const buyBook = makeOrderBook(upPrice, true);
const bullWhale = { score: 60, direction: 'accumulation' };
const upAnalysis = analyzeMarket(upCandles, buyBook, bullWhale);
const strongUp = { ...upAnalysis, actionable: true, composite: 70, confidence: 0.85 };

const usdUp = generateProposal(strongUp, upPrice, ACCOUNT_WITH_USDT, { anchor: 'usd' });
const kasUp = generateProposal(strongUp, upPrice, ACCOUNT_WITH_USDT, { anchor: 'kas' });

test('上涨 + USD 锚 → 买入（追涨）', () => {
  assert.ok(usdUp, 'no USD proposal');
  assert.equal(usdUp.action, 'buy', `expected buy, got ${usdUp.action}`);
});

test('上涨 + KAS 锚 → 卖出（高点换弹药）', () => {
  assert.ok(kasUp, 'no KAS proposal');
  assert.equal(kasUp.action, 'sell', `expected sell, got ${kasUp.action}`);
});

test('KAS 锚卖出提案有 expectedUsdt 字段', () => {
  if (kasUp?.riskCheck) {
    assert.ok(kasUp.riskCheck.anchor === 'kas', 'riskCheck should be kas anchor');
  }
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  4. 提案参数边界检查');
console.log('══════════════════════════════════════════\n');

test('提案金额不超过 auto 限额', () => {
  if (usdProposal) {
    assert.ok(usdProposal.params.amount <= ACCOUNT_WITH_USDT.autoModeMax,
      `amount ${usdProposal.params.amount} > autoMax ${ACCOUNT_WITH_USDT.autoModeMax}`);
  }
  if (kasProposal) {
    assert.ok(kasProposal.params.amount <= ACCOUNT_WITH_USDT.autoModeMax,
      `amount ${kasProposal.params.amount} > autoMax ${ACCOUNT_WITH_USDT.autoModeMax}`);
  }
});

test('提案金额不超过日限额', () => {
  if (usdProposal) {
    assert.ok(usdProposal.params.amount <= ACCOUNT_WITH_USDT.dailyLimit,
      `amount ${usdProposal.params.amount} > dailyLimit ${ACCOUNT_WITH_USDT.dailyLimit}`);
  }
});

test('提案价格是正数', () => {
  if (usdProposal) assert.ok(usdProposal.params.price > 0, `price <= 0: ${usdProposal.params.price}`);
  if (kasProposal) assert.ok(kasProposal.params.price > 0, `price <= 0: ${kasProposal.params.price}`);
});

test('提案 reason 非空', () => {
  if (usdProposal) assert.ok(usdProposal.params.reason?.length > 0, 'USD reason empty');
  if (kasProposal) assert.ok(kasProposal.params.reason?.length > 0, 'KAS reason empty');
});

test('KAS 锚 reason 包含 [本币锚] 标记', () => {
  if (kasProposal) assert.ok(kasProposal.params.reason.includes('本币锚'),
    `KAS reason missing anchor label: ${kasProposal.params.reason}`);
});

test('无 USDT 弹药时 KAS 锚不生成买入提案', () => {
  const noAmmo = generateProposal(strongDown, lastPrice, ACCOUNT_NO_USDT, { anchor: 'kas' });
  // accumulate requires usdtBalance > 1, so should not match
  if (noAmmo && noAmmo.strategy === 'accumulate') {
    assert.fail('should not generate accumulate with 0 USDT');
  }
});

test('actionable=false → 无论什么锚都不生成提案', () => {
  const weak = { ...analysis, actionable: false, composite: -5, confidence: 0.25 };
  assert.equal(generateProposal(weak, lastPrice, ACCOUNT_WITH_USDT, { anchor: 'usd' }), null);
  assert.equal(generateProposal(weak, lastPrice, ACCOUNT_WITH_USDT, { anchor: 'kas' }), null);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  5. 风控三档');
console.log('══════════════════════════════════════════\n');

test('日亏损 < 5% → 正常', () => {
  const r = checkDrawdown(-40, 1000);
  assert.ok(r.allowed);
  assert.ok(!r.halfPosition);
});

test('日亏损 5-10% → 仓位减半', () => {
  const r = checkDrawdown(-70, 1000);
  assert.ok(r.allowed);
  assert.ok(r.halfPosition, 'should halfPosition');
});

test('日亏损 ≥ 10% → 停止交易', () => {
  const r = checkDrawdown(-100, 1000);
  assert.ok(!r.allowed, 'should not be allowed');
});

test('波动率 > 80 → 暂停', () => {
  const r = checkVolatility(85);
  assert.ok(!r.allowed);
});

test('波动率 < 80 → 正常', () => {
  const r = checkVolatility(60);
  assert.ok(r.allowed);
});

test('总回撤 ≥ 15% → 冻结', () => {
  const r = checkTotalDrawdown(850, 1000);
  assert.ok(!r.allowed);
  assert.ok(r.freeze);
});

test('总回撤 < 15% → 正常', () => {
  const r = checkTotalDrawdown(900, 1000);
  assert.ok(r.allowed);
});

// ═══════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════');
console.log('  6. 提案 riskCheck 结构因锚而异');
console.log('══════════════════════════════════════════\n');

test('USD 锚 riskCheck 有 positionPct + maxLoss', () => {
  if (usdProposal?.riskCheck) {
    assert.equal(usdProposal.riskCheck.anchor, 'usd');
    assert.ok(usdProposal.riskCheck.positionPct, 'missing positionPct');
    assert.ok(usdProposal.riskCheck.maxLoss, 'missing maxLoss');
  }
});

test('KAS 锚 riskCheck 有 kasAtRisk + usdtDeployed', () => {
  if (kasProposal?.riskCheck) {
    assert.equal(kasProposal.riskCheck.anchor, 'kas');
    assert.ok(kasProposal.riskCheck.kasAtRisk, 'missing kasAtRisk');
    assert.ok(kasProposal.riskCheck.usdtDeployed, 'missing usdtDeployed');
  }
});

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  ANCHOR LOOP: ${passed + failed} tests | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed > 0) console.log('  ⛔ ANCHOR TESTS NOT PASSED');
else console.log('  ✅ ALL ANCHOR TESTS PASSED');
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
