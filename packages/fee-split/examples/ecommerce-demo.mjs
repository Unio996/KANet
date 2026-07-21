// ecommerce-demo.mjs — 十分钟 demo #2: 非预测市场行业(spec §4 表格"电商"行)。
// 证明 spec §0"行业无关"不是空话——同一个 feeSplit() 函数, 换一份 feeRules, 服务完全不同的协调场景
// (卖家/平台/联盟/验货, 零预测市场概念)。零链零 DB 零网络。
// Run: node examples/ecommerce-demo.mjs
import { feeSplit, validateFeeRules } from '../index.mjs';

// spec §4"电商"行: 卖家 90% / 平台 5% / 联盟 3% / 验货 2%(Σ=10000bps)。
const ecommerceRules = {
  schema_v: 1,
  preset: 'ecommerce-demo',
  roles: [
    { name: 'provider', bps: 9000 },                                          // 卖家(赢家集在交易时供给)
    { name: 'platform', bps: 500, address: 'b'.repeat(64) },                   // 平台
    { name: 'affiliate', bps: 300, address: 'c'.repeat(64), optional: true },  // 联盟/引荐(可选角色)
    { name: 'inspector', bps: 200, address: 'd'.repeat(64) },                  // 验货
  ],
};
validateFeeRules(ecommerceRules);   // 建单前必过的硬不变量(Σ==10000/provider下限等)
console.log('电商预设(与 prediction 预设结构完全一致, 只是角色/比例不同):', JSON.stringify(ecommerceRules, null, 2));

const orderSompi = '500000000';   // 一笔订单
const seller = [{ pk: 'seller-pk'.padEnd(64, '0'), stake: '1' }];   // 电商场景"赢家"= 唯一卖家, stake 只是分配权重占位
const result = feeSplit(ecommerceRules, orderSompi, seller);

console.log('\n分账结果:');
console.log(JSON.stringify(result, null, 2));
console.log(`\n守恒校验: Σ payoutLeaves = ${result.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n)} sompi == 订单额 ${orderSompi} sompi`);
