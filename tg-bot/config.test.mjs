// config.test.mjs — Phase-1 ④ 纯函数测试(零链零 DB 零网络)。Run: cd tg-bot && node config.test.mjs
// 覆盖: settlePollMs 默认 5 min / env 覆盖; testBotUsers 默认 990001,999001 / env 覆盖 / 空串=不排除; isTestBotUser 对 number/string 一致。
import assert from 'node:assert/strict';
import { CONFIG, isTestBotUser } from './config.mjs';

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };

t('V1 settlePollMs 默认 300000(5 min), 独立于 pollMs(30 s 不变)', () => {
  if (!process.env.TG_SETTLE_POLL_MS) assert.equal(CONFIG.settlePollMs, 300_000);
  if (!process.env.TG_POLL_MS) assert.equal(CONFIG.pollMs, 30_000);
});
t('V2 testBotUsers 默认 = {990001, 999001}; isTestBotUser 对 number/string 同判', () => {
  if (!('TG_TEST_BOT_USERS' in process.env)) assert.deepEqual([...CONFIG.testBotUsers].sort(), ['990001', '999001']);
  assert.equal(isTestBotUser(990001), true); assert.equal(isTestBotUser('999001'), true);
  assert.equal(isTestBotUser(1437320734), false); assert.equal(isTestBotUser('7202335035'), false); assert.equal(isTestBotUser(undefined), false);
});
t('V3 cfg 注入: 自定义集合 / 空集合(env 空串) ⇒ 不排除任何人', () => {
  assert.equal(isTestBotUser(1437320734, { testBotUsers: new Set(['1437320734']) }), true);
  assert.equal(isTestBotUser(990001, { testBotUsers: new Set() }), false);
  const parse = (s) => new Set(String(s ?? '990001,999001').split(',').map((x) => x.trim()).filter(Boolean));   // 与 config.mjs 同式
  assert.deepEqual([...parse('')], []); assert.deepEqual([...parse(' 1 , 2 ')], ['1', '2']); assert.deepEqual([...parse(undefined)].sort(), ['990001', '999001']);
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
