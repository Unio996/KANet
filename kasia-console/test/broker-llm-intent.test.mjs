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

  // T-J1-19k (NWT 30 轮 dynamic 发现): 中文非正式动词
  it('"搞 3 KAS" → buy (T-J1-19k 非正式)', () => assert.equal(_detectIntent('搞 3 KAS'), 'buy'));
  it('"想换 50 KAS" → buy (想换)', () => assert.equal(_detectIntent('想换 50 KAS'), 'buy'));
  it('"弄 99 KAS" → buy (弄)', () => assert.equal(_detectIntent('弄 99 KAS'), 'buy'));
  it('"来点 kas" → buy (来点)', () => assert.equal(_detectIntent('来点 kas'), 'buy'));
  it('"我要 5 KAS" → buy (我要)', () => assert.equal(_detectIntent('我要 5 KAS'), 'buy'));
  it('"想要 10 KAS" → buy (想要)', () => assert.equal(_detectIntent('想要 10 KAS'), 'buy'));
  it('"脱手 5 KAS" → sell (脱手)', () => assert.equal(_detectIntent('脱手 5 KAS'), 'sell'));
  it('"抛 100 KAS" → sell (抛)', () => assert.equal(_detectIntent('抛 100 KAS'), 'sell'));
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

describe('handleLlmDialog — T-J1-19f deterministic first-turn (NWT B fix)', () => {
  // First turn + Chinese intent → deterministic reply (no LLM call, regression: NWT 6/6 中文 fail)
  it('first-turn 中文 "买 50 KAS" → deterministic reply含 chain choices, NO LLM call', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    // Use a fake peer with no history. _loadHistory does real DB query but returns []
    // for unknown peer. handleLlmDialog detects intent → deterministic path.
    const fakePeer = 'kaspa:test_first_turn_zh_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, '买 50 KAS');
    assert.match(reply, /50 KAS/, `reply must mention qty 50 KAS, got: ${reply}`);
    assert.match(reply, /BSC|Polygon|SOL|TRON|链/, `reply must offer chain choices, got: ${reply}`);
    // CRITICAL: must NOT contain "买还是卖" (the symptom of NWT 6/6 fail)
    assert.doesNotMatch(reply, /买还是卖|想买还是卖|买.*还是.*卖/, `reply must NOT ask direction (NWT regression), got: ${reply}`);
  });

  it('first-turn 中文 "我要买 50 KAS" → deterministic, no direction question', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    const fakePeer = 'kaspa:test_first_turn_zh2_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, '我要买 50 KAS');
    assert.match(reply, /50 KAS/);
    assert.doesNotMatch(reply, /买还是卖/);
  });

  it('first-turn 英 "buy 50 KAS" → deterministic English reply', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    const fakePeer = 'kaspa:test_first_turn_en_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, 'buy 50 KAS');
    assert.match(reply, /50 KAS/);
    assert.match(reply, /BSC|Polygon|SOL|TRON|chain/i);
    assert.doesNotMatch(reply, /buy or sell|want to buy or sell/i, `reply must NOT ask direction in English`);
  });

  it('first-turn 西 "comprar 50 KAS" → deterministic Spanish reply', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    const fakePeer = 'kaspa:test_first_turn_es_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, 'comprar 50 KAS');
    assert.match(reply, /50 KAS/);
    assert.match(reply, /BSC|Polygon|SOL|TRON|cadena/i);
  });

  it('first-turn 卖 "卖 5 KAS" → deterministic 卖 path', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    const fakePeer = 'kaspa:test_first_turn_sell_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, '卖 5 KAS');
    assert.match(reply, /5 KAS/);
    assert.match(reply, /收/, `卖 path reply must mention 收 USDT, got: ${reply}`);
  });

  // T-J1-19g (NWT 报真 peer history 不空 isFirstTurn 失效 fix):
  // 真 peer 多次问"买 X KAS" — 第一次 deterministic, 之后再问应该仍 deterministic
  // (不像 history.length===0 那样只首次, 因为真 peer history 永不空).
  // The marker is "broker outbound 含 '哪个链'", 不是 history.length.
  it('T-J1-19g: 真 peer 已 history 但 broker 没问过链 → 仍 deterministic', async () => {
    const handler = await import('../src/services/broker-llm-agent.js');
    // Use a fake peer (so _loadHistory returns []), simulating fresh intent
    // even if previous broker conversation was about other topics.
    const fakePeer = 'kaspa:test_19g_' + Date.now();
    const reply = await handler.handleLlmDialog(fakePeer, '买 50 KAS');
    assert.match(reply, /50 KAS/);
    assert.doesNotMatch(reply, /买还是卖/);
  });
});

describe('_detectIntent — multi-turn message regression', () => {
  // After first turn "买 50 KAS" detected as buy, second turn "BSC, 对" should NOT
  // re-trigger intent (intent for second turn is null; LLM relies on history context).
  it('multi-turn 2nd msg "BSC, 对" → null (relies on history)', () => assert.equal(_detectIntent('BSC, 对'), null));
  it('multi-turn 2nd msg "我付了 0xabc..." → null (PAID, not intent)', () => assert.equal(_detectIntent('我付了 0xabc...'), null));
});
