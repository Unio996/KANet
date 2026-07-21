// integrate-your-app.mjs — 完整生命周期示范(建单 → 链锚 → 分账 → 落链通知),供第三方复制粘贴改造。
// 跟 prediction-demo.mjs / ecommerce-demo.mjs 的区别: 那两个只演示"分账数学"这一步,本文件演示
// "一笔真实交易从建单到通知"的完整链路——这才是接入你自己产品时实际要写的代码形状。
// Run: node examples/integrate-your-app.mjs
import { validateFeeRules, canonicalizeFeeRules, computeFeeRulesCommit, feeSplit } from '../index.mjs';
import { matchLandedFeeOutputs, emitLandedNotification } from '../index.mjs';

// ── 第 1 步: 定义你的分账规则(建单时做一次) ──
// 场景: 一个众筹项目, provider=项目方拿 85%, platform 拿 8% 手续费, referrer(推荐人)拿 5%,
// auditor(审计人)拿 2%。角色名/比例随便定义, 组件不关心行业。
// ⚠ address 字段必须是 32 字节 pk 的 hex 表示(恰好 64 个 hex 字符)——validateFeeRules() 会拒绝任何
// 非 hex/非 64 位长度的占位字符串(这不是随意选的格式限制, 见 fee-split.mjs 的 HEX64 校验)。
const feeRules = {
  schema_v: 1,
  preset: 'crowdfund-demo',
  roles: [
    { name: 'provider', bps: 8500 },
    { name: 'platform', bps: 800, address: 'a'.repeat(64) },
    { name: 'referrer', bps: 500, address: 'b'.repeat(64), optional: true },
    { name: 'auditor', bps: 200, address: 'c'.repeat(64) },
  ],
};
validateFeeRules(feeRules);   // 建单时就炸(坏 bps/坏地址), 不留到分钱那一刻才发现

// ── 第 2 步: 链锚(trustless 的核心一步, 千万别省) ──
// 把规则的 hash 写进你的交易/市场创建记录里(具体怎么写链上由你决定——KANet 用 covenant ctor 字段,
// 你可能用智能合约 storage / 数据库 + 签名, 都行, 只要保证"事后不能偷改")。
const canonical = canonicalizeFeeRules(feeRules);
const commitHash = computeFeeRulesCommit(feeRules);
console.log('规则canonical化(字段顺序/大小写归一, 保证同规则永远同哈希):', JSON.stringify(canonical));
console.log('规则hash(建单时上链承诺这个值):', commitHash);

// ── 第 3 步: 交易发生, 算分账(可能几秒后, 也可能几个月后——跟第 1/2 步是分开的两个时间点) ──
const poolSompi = '2000000000';   // 20 KAS 等值池子(sompi=最小单位, 8位小数)
const winners = [{ pk: 'backer-1', stake: '1200000000' }, { pk: 'backer-2', stake: '800000000' }];
const result = feeSplit(feeRules, poolSompi, winners);
console.log('\n分账结果(纯函数, 零链零DB零副作用——任何人拿同样输入算出同样结果):');
console.log(JSON.stringify(result, null, 2));
console.log(`守恒: Σ payoutLeaves(${result.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n)}) == pool(${poolSompi})`);

// ── 第 4 步: 广播交易, 等它真正落链(终审)后, 再匹配 output + 发通知 ──
// 🔴 这一步的 outputs 必须是你已经确认终审的数据(见 notify.mjs 文件头 landed 前提)——本例用假数据
// 模拟"链上真实到账"的场景, 生产环境这里换成你自己链读到的、已过确认深度的真实 output 列表。
const simulatedLandedOutputs = [
  { address: 'a'.repeat(64), amount: result.feeLeaves.find(l => l.type === 'platform').amount, txid: 'demo-tx-abc123' },
  { address: 'c'.repeat(64), amount: result.feeLeaves.find(l => l.type === 'auditor').amount, txid: 'demo-tx-abc123' },
];
const leafAddresses = result.feeLeaves.map(l => l.pk);   // 生产环境这里是"pk → 链上地址"的真实派生, demo 里 pk 本身就是地址占位
const matched = matchLandedFeeOutputs(simulatedLandedOutputs, result.feeLeaves, leafAddresses);
const notified = emitLandedNotification(matched, {
  onLanded: (payload) => console.log(`\n💰 到账通知: ${payload.role} 收到 ${payload.amountSompi} sompi → ${payload.address}(tx ${payload.txid})`),
});
console.log(`\n共投递 ${notified} 条到账通知(referrer 角色本例故意不模拟其到账 output——unmatched 状态下不会误发"到账"通知,
这正是 notify.mjs 存在的意义: 没链上证据就不投递,不靠"反正记得算过"这种记忆去猜)。`);
