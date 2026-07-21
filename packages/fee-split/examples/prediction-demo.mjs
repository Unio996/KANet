// prediction-demo.mjs — 十分钟 demo #1: 预测市场预设(spec §4 表格第一行)。
// 零链零 DB 零网络 — 复刻既有生产分法(FEE_CONFIG 同值, D-008 单源对应), 证明"组件替代非新增"。
// Run: node examples/prediction-demo.mjs
import { feeSplit, buildPredictionV1InterimRules } from '../index.mjs';

const rules = buildPredictionV1InterimRules({ brokerPk: 'a'.repeat(64) });
console.log('规则(建单时链锚的那份):', JSON.stringify(rules, null, 2));

const poolSompi = '1000000000';   // 10 KAS 池
const winners = [
  { pk: 'winner-1-pk'.padEnd(64, '0'), stake: '400000000' },
  { pk: 'winner-2-pk'.padEnd(64, '0'), stake: '200000000' },
];
const result = feeSplit(rules, poolSompi, winners);

console.log('\n分配结果:');
console.log(JSON.stringify(result, null, 2));
console.log(`\n守恒校验: Σ payoutLeaves = ${result.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n)} sompi == pool ${poolSompi} sompi`);
