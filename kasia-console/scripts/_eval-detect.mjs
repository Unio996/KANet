import { _detectIntent } from '../src/services/broker-llm-agent.js';
const tests = [
  '买 50 KAS',
  '我要买 50 KAS',
  '买 50 个 KAS',
  '想买 50 个 kas',
  '我想买点 kas',
  'buy 50 KAS',
  'comprar 50 KAS',
];
for (const t of tests) {
  console.log(JSON.stringify(t), '→', _detectIntent(t));
}
