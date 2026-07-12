# B线落3 设计 — notify 层泛化 + package 抽离 + 十分钟 demo

> **Status**: CURRENT(设计稿·待 NWT 红队 + Bettor 审;落码前不动代码)
> **作者**: J2 · 2026-07-12 · Owner 主线直令(7/12 终端口谕,06:1x):"broker 佣金自分发独立和抽象出来,
> 作为第三方可用。这个很重要"——与 spec v1.3 §3.2"③好用层/采用性一等目标"完全同向,(d)从排队提为
> 落2 审毕后即启。
> **前置**: 落1(`e254ceb2`+F1修 `7dfbe9ea`)+落2(`6f51fbaa`+f1-p3修)已装载 live 验证(DoD#3 9gzf1 三方链验齐)。

## 0. 一句话

把 `broker-fee-emit.mjs` 里"landed 后单点 emit"的模式(已 live 验证过,7/11)从"只服务 broker 一个角色"
**泛化**为"服务 feeRules 里任意角色",再把 `fee-split.mjs` 组件本体 + 泛化后的 notify 原语 **打包成一个
零 KANet 依赖的独立目录**,third party 十分钟能跑通一个不接链的 demo。

## 1. 查了哪些既有资产

| 资产 | file:line | 复用点 |
|---|---|---|
| landed-then-emit 先例 | `kasia-console/src/services/broker-fee-emit.mjs`(全文已读) | V1/ZK 双分支按地址匹配 output、幂等标记、chain_events 写入——**泛化蓝本** |
| 组件本体 | `kasia-console/src/lib/fee-split.mjs` | 已零 KANet 依赖(唯一 import = `@noble/hashes/blake2b`),`feeSplit`/`validateFeeRules`/`canonicalizeFeeRules`/`computeFeeRulesCommit`/`FEE_PRESETS`/`buildPredictionV1InterimRules` 已导出齐全 |
| spec ③好用层 | `docs/2026-06-22-modular-fee-split-component-spec.md` §3.2(v1.3) | "推送=package 内独立 notify 层,永不进 feeSplit() 函数体"——本设计执行这条边界 |
| package.json 现状 | `kasia-console/package.json` | 单包非 workspace,无既有"抽离子包"先例——本设计是本仓库第一次做这件事,方案需保守(不引入 workspace 工具链改动) |

## 2. 方案:三段交付,scope 递进

### 2.1 notify 层泛化(package 内新文件 `notify.mjs`)

**从 broker-fee-emit 泛化的核心变化**:原逻辑硬编码"只找 broker 地址的 output"→ 泛化为"对 feeRules
里**任意**角色地址(broker/introducer/provider 已知 pk 列表)逐个按地址匹配 output"。

```js
// package 内, 零 KANet 依赖(不 import chain_events/pool_markets——那是 kasia-console 的存储细节)
export function matchLandedFeeOutputs(outputs, feeLeaves) {
  // outputs: [{address, amount_sompi}] (调用方已从链读到的真实 output 列表, 本函数不碰链不碰 DB)
  // feeLeaves: fee-split.mjs feeSplit() 产出的 feeLeaves(含 pk/amount/type)——调用方需自行 pk→address 派生
  //   (地址派生是链特定操作, 本函数只做"给定 address 候选集 + 给定 output 集 → 逐一匹配"的纯逻辑, 零链依赖)
  // 返回: [{leaf, output, matched:true}] ∪ [{leaf, matched:false}](未落地的角色, 调用方决定重试或跳过)
}
export function emitLandedNotification(matched, { onLanded }) {
  // matched: matchLandedFeeOutputs 的产出。onLanded(payload) 由调用方注入(DM/webhook/事件流——本函数不关心
  //   投递方式, 只负责"每个真正落地的角色恰好触发一次"的去重语义(调用方传 idempotencyKey 由自己存)。
  // payload 形状: {role, address, amountSompi, txid, outputIndex, landedAt} —— 通用, 不含 marketId 等 KANet 概念
  //   (KANet 特定字段由调用方在 onLanded 回调里自行拼装追加, 组件产出的是"分润角色到账"这一层通用事实)
}
```

**kasia-console 侧改造**(独立小 diff,不在本次交付阻塞项):`broker-fee-emit.mjs` 改为调用
`matchLandedFeeOutputs`+`emitLandedNotification`(泛化到多角色)+ 自己的 KANet 特定 wiring(chain_events
写入/幂等标记走 metadata/tg-bot 消费)。**本轮设计交付 = package 内的两个通用函数 + 单测**;
kasia-console 侧接线是否本轮一并做,见 §4 DoD 分级。

### 2.2 package 抽离(`packages/fee-split/`)

```
packages/fee-split/
  package.json         # name: "@kanet/fee-split", deps: 仅 @noble/hashes, 零 kasia-console 引用
  index.mjs             # re-export fee-split.mjs 全部 + notify.mjs 全部(单一入口)
  fee-split.mjs          # kasia-console/src/lib/fee-split.mjs 的内容(见 §2.3 单源策略, 不是复制粘贴两份)
  notify.mjs             # §2.1 两个函数
  README.md              # 十分钟 quickstart(§2.4)
  examples/
    prediction-demo.mjs  # 复刻 spec §4 表格的 prediction 预设, 零链零 DB, 纯 console.log 演示
    ecommerce-demo.mjs   # spec §4 表格第二行(电商预设), 证明"行业无关"非空话
```

**🔴 单源策略(防"两份 fee-split.mjs 各自维护"家族病,同 D-008/落2 反 vacuous 铁律)**:
`kasia-console/src/lib/fee-split.mjs` **保持为唯一实现**,`packages/fee-split/fee-split.mjs` 是**构建产物
/符号链接**(本地开发用相对路径 import 或 postinstall 脚本同步,不手工复制)。落码时选定具体机制(优先级:
①相对路径 import `../../kasia-console/src/lib/fee-split.mjs` 最简单但暴露内部目录结构给"第三方独立包"的
定位有点别扭;②`fs.copyFileSync` 走一次构建脚本 `packages/fee-split/scripts/sync.mjs`,`package.json`
`prepublish`/手动跑,产物文件顶部加"自动生成,勿手改,源=kasia-console/src/lib/fee-split.mjs"警告注释)。
**本设计选②**(第三方拿到的包必须自包含,不能依赖 kasia-console 目录结构存在)。

### 2.3 十分钟 demo(`examples/prediction-demo.mjs`)

```js
import { feeSplit, FEE_PRESETS, buildPredictionV1InterimRules } from '../index.mjs';
const rules = buildPredictionV1InterimRules({ brokerPk: 'a'.repeat(64) });
const result = feeSplit(rules, '1000000000', [{ pk: 'winner-pk', stake: '600000000' }]);
console.log(JSON.stringify(result, null, 2));
// 零链零 DB零网络——"不懂链的开发者" import 一个文件、传三个参数、拿到确定性分配结果。
```
配 README 三步走(`npm install`/`node examples/prediction-demo.mjs`/读输出),这是 spec §3.2"十分钟跑通"
的字面验收标准——**验收方式 = 真找一个没碰过这个仓库的人计时跑一遍**(比自证靠谱,落码后找 Bettor/NWT
任一位冷启动跑一次计时)。

### 2.4 README 内容大纲(spec §0/§4 已有素材,搬运+精简,非重写)

1. 一句话定位(spec §0"社会资源协调原语")
2. 30 秒 API(feeSplit 签名 + 一个 JSON 输入输出对)
3. 预设表(spec §4 表格原样搬,证明行业无关)
4. trustless 前提(spec §3"规则必须建单时链锚"——README 诚实注明:package 本身不做链锚,那是
   **消费方**(如 kasia-console 的 `computeMarketCommitV2`)的职责,组件只保证"给定同一份规则,任何地方
   算出来的分配 byte-identical")

## 3. 为什么这么做(对抗自问)

- **为什么不现在就发 npm?** 没被问,且 D-005 隔离铁律精神类推:新建外部分发面是慎重事,先在仓库内部
  长成一个真正自包含、可 `cp -r` 出去独立跑的目录,发布是后续单独决策(Owner 未钦定要发布,只钦定"抽象
  独立出来")。
- **为什么 notify 泛化不改 broker-fee-emit.mjs 本体在本轮?** 那是 live 生产路径(7/11 验证过、DoD#3
  刚验证过 broker 首笔实收),改造它是独立风险面(消费点枚举铁律同款警惕),本轮先在 package 内把**通用
  原语**做对、单测钉死,kasia-console 侧的实际切换是下一刀(降低本轮改动半径,同"落1/落2/合卡"分段策略)。
- **为什么两个 demo(prediction+ecommerce)不只一个?** spec §4 的"行业无关"论证目前只有 prediction 一行
  被证明过(落码+live)——加一个非 prediction 预设的可跑 demo,才是"证明行业无关"而非"写在文档里说行业
  无关"。

## 4. 验收(DoD,分级)

1. **本轮 BLOCKING**:`packages/fee-split/` 目录成立(§2.2 结构)+ notify.mjs 两函数 + 单测(matchLandedFeeOutputs
   多角色匹配/未落地角色跳过/emitLandedNotification 去重语义)+ 两个 demo 脚本可独立运行(`node
   examples/prediction-demo.mjs` 零依赖 kasia-console 路径能跑)+ README。
2. **本轮 non-blocking(留续卡)**:kasia-console `broker-fee-emit.mjs` 切换到调用 package 内泛化函数
   (真正让 live 路径吃到这层抽象,而非只是"另建了一份没人用的代码")。
3. **验收方式**:冷启动计时跑通(§2.3);lint 新目录(`packages/`)纳入 lint-kanet.mjs 扫描范围(若脚本
   路径匹配逻辑需要调整,落码时一并核)。
