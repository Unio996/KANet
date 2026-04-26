/**
 * broker-llm-agent _detectIntent 单元测试
 *
 * NWT retest @ d2065558 中文 6/6 失败 fix: T-J1-19d regex preprocessor.
 * Run: node --test test/broker-llm-intent.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _detectIntent } from '../src/services/broker-llm-agent.js';

describe('_detectIntent — Chinese (NWT retest failures)', () => {
  it('"买 50 KAS" → buy', () => assert.equal(_detectIntent('买 50 KAS'), 'buy'));
  it('"我要买 50 KAS" → buy', () => assert.equal(_detectIntent('我要买 50 KAS'), 'buy'));
  it('"买 50 个 KAS" → buy', () => assert.equal(_detectIntent('买 50 个 KAS'), 'buy'));
  it('"想买 50 个 kas" → buy (lowercase kas)', () => assert.equal(_detectIntent('想买 50 个 kas'), 'buy'));
  it('"购买 100 KAS" → buy', () => assert.equal(_detectIntent('购买 100 KAS'), 'buy'));
  it('"在吗? 我想买一点儿 kas" → buy', () => assert.equal(_detectIntent('在吗? 我想买一点儿 kas'), 'buy'));
  it('"卖 5 KAS" → sell', () => assert.equal(_detectIntent('卖 5 KAS'), 'sell'));
  it('"想卖 10 个 KAS" → sell', () => assert.equal(_detectIntent('想卖 10 个 KAS'), 'sell'));
  it('"出售 KAS 换 USDT" → sell', () => assert.equal(_detectIntent('出售 KAS 换 USDT'), 'sell'));
});

describe('_detectIntent — English / Spanish / Japanese / Korean', () => {
  it('"I want to buy 50 KAS" → buy', () => assert.equal(_detectIntent('I want to buy 50 KAS'), 'buy'));
  it('"buy 50 kas" → buy (lowercase)', () => assert.equal(_detectIntent('buy 50 kas'), 'buy'));
  it('"sell 10 KAS for USDT" → sell', () => assert.equal(_detectIntent('sell 10 KAS for USDT'), 'sell'));
  it('"Hola, quiero comprar 50 KAS" → buy', () => assert.equal(_detectIntent('Hola, quiero comprar 50 KAS'), 'buy'));
  it('"vender 10 KAS" → sell', () => assert.equal(_detectIntent('vender 10 KAS'), 'sell'));
  it('"購入 KAS" → buy', () => assert.equal(_detectIntent('KAS を購入したい'), 'buy'));
});

describe('_detectIntent — false-positive guards', () => {
  it('"买面包" (no kas) → null (闲聊不误判)', () => assert.equal(_detectIntent('买面包'), null));
  it('"BSC, yes" (no direction) → null', () => assert.equal(_detectIntent('BSC, yes'), null));
  it('"YES" → null', () => assert.equal(_detectIntent('YES'), null));
  it('"" empty → null', () => assert.equal(_detectIntent(''), null));
  it('null/undefined → null', () => {
    assert.equal(_detectIntent(null), null);
    assert.equal(_detectIntent(undefined), null);
  });
  it('"今天天气好" (no kas, no direction) → null', () => assert.equal(_detectIntent('今天天气好'), null));
});

describe('_detectIntent — multi-turn message regression', () => {
  // After first turn "买 50 KAS" detected as buy, second turn "BSC, 对" should NOT
  // re-trigger intent (intent for second turn is null; LLM relies on history context).
  it('multi-turn 2nd msg "BSC, 对" → null (relies on history)', () => assert.equal(_detectIntent('BSC, 对'), null));
  it('multi-turn 2nd msg "我付了 0xabc..." → null (PAID, not intent)', () => assert.equal(_detectIntent('我付了 0xabc...'), null));
});
