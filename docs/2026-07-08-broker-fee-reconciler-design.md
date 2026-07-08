# broker 手续费对账器 — 设计稿(启用现有模块+补两态)

> **Status**: CURRENT
> **作者**: J1tn 2026-07-08 · **上游依据**: Owner"ZK只证correctness不证liveness"架构指令(D-007) + Owner直接指令"之前有这个模块,没有启用,查!尽量不要造新轮子"

---

## §0 一句话

**`kasia-console/src/services/broker-fee-emit.mjs` 已经实现了"✅到账且核实"这条链验路径,链验金额+幂等+写 chain_event 触发 DM,但从没被挂进任何 cron(index.js 零调用点),而且只覆盖"到账"这一种状态,缺 Owner 要的另外两态(🔴金额不符/🟠超时未到账)。方案 = 启用它 + 补两态,不重造扫链/幂等这层已经写对的东西。**

## §1 现状盘点(查了再写,不是猜)

`broker-fee-emit.mjs` 已有:
- `brokerFeeLandedEmitTick(db, deriveBrokerAddress, log)`:扫 `protocol_status='completed' AND settle_txid IS NOT NULL AND broker_pk IS NOT NULL` 的市场,按 `deriveBrokerAddress(broker_pk)` 算出应该收款的地址,查 `kaspa_tx_log`(经共享原语 `getIndexedTxOutputs`,`lib/broker-fee-chain.mjs`)里 settle_txid 的实际 output 有没有一笔付给这个地址,有就写 `chain_events` 表 `broker_fee_landed` 事件(tg-bot poller 消费此事件推 DM,消费端已存在,J2 2026-06-28 就接好了)。
- 幂等:`pool_markets.metadata.broker_fee_landed_emitted_at` 标记,一盘只 emit 一次。
- backfill-suppress:部署时把已有 completed 盘标记成"已 emit 不补发",只对新结算的盘生效。
- **诚实口径已经写对**:金额来自 `kaspa_tx_log.outputs_json`(链验),不是 DB 估算或期望值。

**没做的**(Owner 要的另外两态):
1. **🔴 到账但金额不符**:当前逻辑只要 broker 地址有任意 output 就 emit,不比对"这个金额是不是等于 pool×broker_fee_pct 精确值"。这条按设计不该出现(电路内 Σleaf 断言理论上兜死),真出现 = 电路漏洞级警报,但代码里目前**没有这层比对**。
2. **🟠 过 deadline+grace 仍无 fee 落链**:当前 tick 只扫 `completed` 的市场(已经结算完的),不扫"该结算但还没结算"的市场——那类市场自然也查不到 settle_txid,直接被现有 SQL 条件排除在外,不会被标记成"卡住"。这是 daemon-liveness 警报,目前完全没有对应逻辑。

## §2 方案(启用+补丁,不重写)

### §2.1 立即可做:挂 cron(零风险,纯启用)

`index.js` 参照 `broker-state-reconciler` 的挂法(723-725 行,5min cron 先例)加:
```js
import { brokerFeeLandedEmitTick } from './services/broker-fee-emit.mjs';
// 沿用既有 5min 量级 cron 节奏(跟 broker-state-reconciler 同档),新增独立开关(BROKER_FEE_EMIT_ENABLED,默认按其他新 cron 惯例先 OFF 一轮观察,或直接 ON——这条本身零 money-path 风险,只读链+写通知,可以更激进)。
```
这一步本身没有争议——纯粹是"接上一根已经焊好的线"。

### §2.2 补🔴态:金额精确核对

在 `brokerFeeLandedEmitTick` 现有的"找到 broker output"分支(L87-98)之后,加一步:
```js
const expectedFeeSompi = computeExpectedBrokerFee(m);  // = pool_total_sompi × broker_fee_pct / 10000(单一权威公式,复用既有 FEE_CONFIG/deriveFeeLeaves 同源逻辑, pool-shard-settle.mjs 已有, 不新造)
if (feeSompi !== expectedFeeSompi) {
  // 🔴 电路漏洞级警报:写一个新 chain_event(如 broker_fee_mismatch),独立于正常 broker_fee_landed,
  // 不覆盖/不静默——两个事件都写(landed=事实,mismatch=异常标注),下游按需分别消费。
}
```
计算 `expectedFeeSompi` 的公式需要跟结算时**实际用的那份**逻辑同源(V1 committee-sig 路是 `FEE_CONFIG`/`deriveFeeLeaves`,pool-shard-settle.mjs 已有;ZK-native 路是 §2.3 要单独处理的场景,不是这条公式)。

### §2.3 ZK-native 场景的独立性(诚实标注,今天不做)

`broker-fee-emit.mjs` 现有逻辑绑定的是**V1 committee-sig 结算路径**(`settle_txid` 单笔交易里找 broker output)。ZK-native 市场的 broker 收款走的是**门③ claim 机制**(broker 本身是 payoutRoot 树里的一个 claimant,通过独立的 claim 交易领取,不是 settle_txid 的一个 output)——这条完全是另一套数据模型,今天市场5 设计稿里"broker output 电路内 enforce 核实"那条(NWT/Bettor 已经在门③清单里加了)本质上是同一个问题在 ZK 路径上的对应物。本设计稿**只覆盖 V1 委员签路径**,ZK-native 路径的对账留独立待办(等 ZK 结算真正批量投产、有 claim 数据可核对时再做,今天没有生产 ZK 市场结算,做了也测不了)。

### §2.4 补🟠态:daemon-liveness 警报(新 tick 函数)

现有 `brokerFeeLandedEmitTick` 结构无法覆盖这个场景(它只扫 completed 盘)。需要一个新的、独立的检查:
```js
export function brokerFeeStuckAlertTick(db, log = () => {}) {
  // 扫: deadline 已过 + grace 窗口(沿用既有 ESCAPE_GRACE 或市场自己的 grace 定义)已过 + broker_pk 非空
  //   + protocol_status 不是 completed(还没结算) + 没有已发过的 stuck 告警标记(幂等,同款 metadata 标记模式)。
  // 命中 = 🟠 写 chain_event('broker_fee_stuck_alert'),daemon liveness 侧警报,不是资金问题。
}
```
这条判定逻辑(deadline+grace 窗口计算)复用市场5硬门③"exit-path 矩阵"里已经定过的 grace 窗口概念,不新发明一套时间窗算法。

## §3 通知形态(Owner 要求:每笔频道回执+日终汇总)

- 每笔:三个 chain_event(`broker_fee_landed`/`broker_fee_mismatch`/`broker_fee_stuck_alert`)已经是 tg-bot poller 能消费的既有机制(`broker_fee_landed` 的消费端已存在,另外两个新事件类型需要 KANet-UI 在 poller 里加对应分支,小改动)。
- 日终汇总:独立的每日一次脚本/cron,查当天三类事件计数+清单,发一条汇总消息——这条今天不做,排 non-blocking 待办(先把逐笔通知这条主线跑起来,验证有效后再加汇总层)。

## §4 范围边界(防止过度设计)

- **不改** `broker-fee-emit.mjs` 现有 `brokerFeeLandedEmitTick` 的 ✅ 逻辑本身(已经写对,链验+幂等),只在其基础上加比对分支。
- **不重造** `getIndexedTxOutputs`/幂等标记模式/chain_event 写入这些已经存在的原语。
- **不覆盖 ZK-native 路径**(§2.3 已说明,独立待办)。
- **不做日终汇总**(§3 已说明,排 non-blocking 待办)。
- 这次改动全部是**只读链+新增独立 chain_event 类型的写入**,不碰任何 money-path 决策(不影响 settle/claim/refund 逻辑本身),符合 Bettor 今晚重申的"六层调查纪律+钱路双人核实"这条唯一保留的严格标准——本设计稿不是 money-path 决策,是纯观测/告警层,风险面小。

## §5 签字区

- J1tn(设计):✅ 2026-07-08
- 待:NWT/Bettor 审(市场5间隙,不抢主线)
