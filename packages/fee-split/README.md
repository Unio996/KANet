# @kanet/fee-split

**Trustless, deterministic value-split component.** "谁该得多少" 焊死成一个纯函数 → 每个协调角色(生产者/
撮合者/引荐者/验证者/基础设施)因为确定能拿到自己那份,才会去做自己那部分——不需要中心协调者,激励结构
自己把社会资源协调起来,协调成本趋零。预测市场只是第一个应用;本组件对任何"多方按规则分一笔钱"的场景都
适用(众筹、电商分佣、自由职业撮合、供应链分账……)。

站在**个体经济利益驱动**角度设计:不是"信任平台会公平分",是"任何人拿同一份规则独立算,结果必然
byte-identical"——这是数学保证,不是承诺。

## 一个核,两种接入方式

本组件只有**一套计算逻辑**(`feeSplit()` 纯函数),不分"给人用"和"给系统用"两套实现——两套逻辑迟早会
算不一致,信任就塌了。区别只在**谁调用它、调用完怎么用**:

- **系统接入**(本教程覆盖的这扇门):你的服务 `import` 这个包,把算出来的分配结果接进自己的结算/UI/API。
  预测市场场景下,KANet 自己也是这样接的。
- **人用配置**(未来能力,不在本包范围):给不想写代码的人一个表单去配置规则、看到查询结果——那一层只是
  "生成标准输入 + 呈现标准输出",最终喂给的还是这同一个 `feeSplit()` 核心,不会另起一套算法。

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

## 安装

```bash
npm install @kanet/fee-split
```

唯一依赖是 `@noble/hashes`(算 `computeFeeRulesCommit` 用的 blake2b)。没有任何 KANet 专属依赖、没有隐藏
路径、不连数据库、不连链——这个包能在你自己的 `node_modules` 里独立跑,拔掉整个 KANet 代码库也不受影响。

## 十分钟跑通(4 个脚本,建议按顺序跑)

```bash
node examples/prediction-demo.mjs     # ① 最小示例: 预测市场预设(与 KANet 生产分法逐字同值)
node examples/ecommerce-demo.mjs      # ② 换行业: 同一个函数, 换一份规则, 服务电商场景(证明"行业无关"不是空话)
node examples/integrate-your-app.mjs  # ③ 完整生命周期: 建规则→链锚→分账→模拟落链→通知(接自己产品照抄这份的形状)
node notify.test.mjs                  # ④ notify 层单测(看懂三态: matched/mismatch/unmatched)
```

① ② 只演示"分账数学"这一步(给一份规则 + 一笔钱,算出谁拿多少)。③ 演示的是"一笔真实交易从建单到用户
收到到账通知"的完整链路——这才是你接入自己产品时实际要写的代码形状,建议直接复制这个文件当起点改。

## 完整接入:照着 `integrate-your-app.mjs` 的四步走

1. **定义规则**(建单时做一次):角色名/比例你自己定,组件不关心你的行业是什么。
2. **链锚**(trustless 的核心一步,千万别省):`computeFeeRulesCommit(feeRules)` 算出规则的 hash,把这个
   值写进你的交易/市场创建记录里——具体怎么上链由你决定(KANet 用 covenant ctor 字段,你可能用智能合约
   storage、或数据库+签名,只要保证"事后不能偷改"即可)。省掉这一步,"可配"和"trustless"就不能同时成立。
3. **算分账**(交易发生时,可能几秒后也可能几个月后——跟第 2 步是分开的两个时间点):`feeSplit(feeRules,
   poolSompi, winners)`,拿到 `payoutLeaves` 去广播真实转账交易。
4. **落链后发通知**(不是算完就发,是等链上终审后才发):把你确认终审的 output 集喂给
   `matchLandedFeeOutputs()`,再用 `emitLandedNotification()` 投递——见下方"notify 层"小节的强制前提,这
   一步跳过终审判定是最容易踩的坑。

## 常见踩坑(冷启动实测踩出来的,不是猜的)

- **`address` 字段必须是 64 位 hex 字符串**(32 字节 pk 的 hex 表示),不能塞任意占位字符串(比如
  `'my-address-placeholder'`)——`validateFeeRules()` 会直接 throw。占位测试时用 `'a'.repeat(64)` 这类写法。
- **`provider` 角色不能带 `address`/`derive`**:provider(赢家集)是 `feeSplit()` 调用时通过 `winners`
  参数供给的,不是规则里配置的静态地址——建规则时给 provider 加地址会被拒。
- **`Σbps` 必须精确等于 `10000`**,多一点少一点都会在 `validateFeeRules()` 就地 throw,不会留到分钱那一
  刻才发现。
- **`feeSplit()` 不做终审判定**:它是纯函数,不知道你喂进来的 `poolSompi` 是不是真链上读到的可信值——这
  是调用方的责任(见下方 trustless 前提 ①)。
- **`optional: true` 的角色缺席时,`bps` 自动归 provider**,不是消失也不是报错——建规则时留意这个隐含
  行为会不会跟你的产品逻辑冲突。

## 完整 API 一览

| 函数 | 用途 |
|---|---|
| `validateFeeRules(feeRules)` | 建单前/分账前必过的硬不变量校验(不合法直接 throw,fail-loud) |
| `canonicalizeFeeRules(feeRules)` | 规则的唯一 canonical 序列化(字段排序+地址小写+缺省归一),链锚哈希的 preimage |
| `computeFeeRulesCommit(feeRules)` | `blake2b-256(canonicalizeFeeRules(feeRules))`,32 字节 hex,建单时上链承诺这个值 |
| `deriveRoleFeeLeaves(feeRules, poolSompi, opts?)` | 只算 fee 半边(不含赢家分配),`feeSplit()` 内部用的就是这个 |
| `feeSplit(feeRules, poolSompi, winners, opts?)` | 核心函数:赢家分配 + fee 分配一次性算全,`Σ payoutLeaves == poolSompi` |
| `buildPredictionV1InterimRules({brokerPk, introducerPk?})` | KANet 预测市场专用的规则构造器(仅供参考,你的行业用不上这个,自己拼 `{schema_v, roles}` 对象即可) |
| `FEE_PRESETS.prediction` | 预测市场行业预设模板(角色地址是占位,不能直接上链,建单时注入真实地址后再 `validateFeeRules`) |
| `matchLandedFeeOutputs(outputs, feeLeaves, leafAddresses)` | notify 层:把 fee-split 产出的 leaf 跟链上真实 output 逐一匹配,三态输出 |
| `emitLandedNotification(matched, {onLanded})` | notify 层:对 matched 条目逐一投递通知,返回实际投递数 |

`feeSplit()`/`deriveRoleFeeLeaves()` 的返回金额都是**字符串形式的整数 sompi**(内部用 `BigInt` 算,避免
浮点误差),你接进自己系统时按字符串或 `BigInt` 处理,不要转成 JS `Number`(大数会精度丢失)。

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
   产出"通知用户收到钱了但链上其实还没定案"的假通知(可被 reorg 撤销)——这是 KANet 团队自己在真实事故
   里学到的教训,对任何接入方同样成立。

## notify 层(可选,系统门的"好用"部分)

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
两文件不一致时**阻塞 commit**(非警告),不给忘记同步的机会。`examples/` 与 `notify.mjs` 不受此同步机制
约束,是本包独立维护的文件。
