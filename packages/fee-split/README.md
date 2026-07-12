# @kanet/fee-split

**Trustless, deterministic value-split component.** "谁该得多少" 焊死成一个纯函数 → 每个协调角色(生产者/
撮合者/引荐者/验证者/基础设施)因为确定能拿到自己那份,才会去做自己那部分——不需要中心协调者,激励结构
自己把社会资源协调起来。预测市场只是第一个应用;本组件对任何"多方按规则分一笔钱"的场景都适用。

## 30 秒 API

```js
import { feeSplit, validateFeeRules, FEE_PRESETS } from '@kanet/fee-split';

const rules = { schema_v: 1, roles: [
  { name: 'provider', bps: 9700 },
  { name: 'broker', bps: 300, address: 'a'.repeat(64) },
]};
validateFeeRules(rules);   // 硬不变量: Σbps==10000 / provider 下限 / role 上限 / 未知键 fail-loud

const result = feeSplit(rules, /* poolSompi */ '1000000000', /* winners */ [{ pk: 'w1', stake: '600000000' }]);
// result.payoutLeaves = 赢家分配 + fee 分配, Σ == poolSompi 精确清零
```

`feeSplit()` 是纯函数:零链、零 DB、零副作用。同输入同输出——跨节点/跨进程 byte-identical,这是本组件
trustless 可配的数学基础(委员/多方各自独立计算,结果必然一致)。

## 十分钟跑通

```bash
npm install
node examples/prediction-demo.mjs   # 预测市场预设(与生产分法逐字同值)
node examples/ecommerce-demo.mjs    # 电商预设——证明"行业无关"不是空话
node notify.test.mjs                # notify 层单测
```

## 行业预设(证明行业无关 + 替代性)

| 预设 | provider | facilitator | affiliate | verifier | infra |
|---|---|---|---|---|---|
| **prediction**(现有) | winner 97% | broker 1.6% | intro 0.2% | oracle 1% | node 0.2% |
| 电商 | 卖家 90% | 平台 5% | 联盟 3% | 验货 2% | — |
| 自由职业 | provider 92% | 撮合 5% | — | 仲裁 3% | — |
| 供应链分账 | 按合约 N 方自定义 | | | | |

预设是**可配置的输入**,不是硬编码逻辑——`feeSplit(rules, ...)` 的 `rules` 参数决定分法,函数本体对所有
行业一视同仁。

## trustless 前提(务必读)

`feeSplit()` 保证"给定同一份规则,任何地方算出来的分配 byte-identical"——**但规则本身的可信度不是本组件
的职责**。生产场景必须满足:

1. **规则建单时链锚**:规则(`feeRules`)必须在交易/市场创建时上链承诺(hash-commit),分配时任何一方
   re-derive 的规则必须验证 == 链上承诺,否则"可配"和"trustless"不能同时成立。这是**消费方**的职责
   (KANet 的实现见 `computeMarketCommitV2`),不是本组件内部做的事。
2. **`outputs` 必须是终审数据**(见 `notify.mjs` landed 前提):`matchLandedFeeOutputs()` 的 `outputs`
   参数必须是调用方已确认终审(如深度 ≥N 的 confirmed UTXO/output 集)的输出列表——**不能**直接喂
   mempool-accepted 或单次 RPC 查询结果。本函数不做终审判定,信任调用方喂入的数据;喂入未终审数据会
   产出"通知用户收到钱了但链上其实还没定案"的假通知(可被 reorg 撤销)。

## notify 层(可选,§3 好用层)

`feeSplit()` 本身零副作用(推送永不进纯函数体,这是 determinism 的根基)。`notify.mjs` 提供两个独立
的纯函数原语,让消费方在**落链事件确认后**(而非计算时)投递通知:

```js
import { matchLandedFeeOutputs, emitLandedNotification } from '@kanet/fee-split';

const matched = matchLandedFeeOutputs(confirmedOutputs, feeLeaves, leafAddresses);
emitLandedNotification(matched, { onLanded: (payload) => sendTelegramDM(payload) });
```

去重契约:`emitLandedNotification` 只保证单次调用内 at-most-once,跨调用的"恰好一次"依赖调用方自行
持久化 idempotency key(见 KANet 的 `broker-fee-emit.mjs` 实现范例)。

## 维护(内部开发者)

本目录的 `fee-split.mjs` 是 **构建产物**,唯一真相源是 `kasia-console/src/lib/fee-split.mjs`。改动源
文件后必须跑 `node scripts/sync.mjs` 重新同步——`lint-kanet.mjs` 的 `R-FEE-SPLIT-PKG-DRIFT` 规则会在
两文件不一致时**阻塞 commit**(非警告),不给忘记同步的机会。
