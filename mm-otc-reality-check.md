# mm-otc 现实核对报告

> 回答 v0.3-challenges.md 三个质疑,基于 2026-04-22 实跑 grep + DB 查询得出。
> 动任何代码前必读。

---

## 质疑 1:用户手动付款谁触发 `paid`?

### 答案:**路径 β(被动等 txhash)**

**证据** `kasia-console/src/services/exchange-verifiers.js:56-75`:

```js
class CrossChainTxVerifier extends BaseVerifier {
  async start(matchContext) {
    return { status: 'pending', message: 'Awaiting cross-chain TX proof' };
  }
  async checkProgress(matchContext) {
    const meta = JSON.parse(matchContext.offer.verification_meta || '{}');
    if (meta.verified_tx) return { status: 'completed' };   // ← 只检查 meta 有没有 tx
    return { status: 'pending', message: `Awaiting TX on ${meta.chain}` };
  }
  async isCompleted(matchContext) {
    return !!JSON.parse(matchContext.offer.verification_meta || '{}').verified_tx;
  }
}
```

**verifier 完全被动**。没有链扫、没有 setInterval、没有主动查询 BNB 节点。它**只是等** `verification_meta.verified_tx` 字段被写入。

### 谁来写 `verified_tx`?

顺 grep 找:`sqlite.prepare('UPDATE exchange_offers SET ... verification_meta ...')`(exchange.js:339, exchange-machine.js:194)。**是 trade-protocol-filter 的 `handleExchangePaid` 族函数**(由链上 `kanet_exchange_paid_v1` 广播触发)。

### 对 broker 的含义

**retail 用户没 KANet relay → 发不出 `paid` 广播**。**broker 必须代发**。broker 状态机多一步:

```
accept → 报付款地址 → [等用户 DM 回 txhash] → broker 广播 paid 带 txhash → verifier.checkProgress pass → delivered → completed
```

这一步不能省。broker 的 state machine 比"glue"多一个显式等待态。

---

## 质疑 2:Hedge 门控加哪里?

### 答案:**mm-otc 跟现有 Exchange 协议不在一条路径,Spec §7 假设的 `_executeHedge()` 位置需要重新定位**

**证据 1** — mm-otc 的 ACTION 链路 (`action-executor.mjs:219-231`):

```
CREATE_MM_ORDER → executeTradeAction({type: 'publish_order'})  ← trading.js 老路径
SEND_KAS         → executeTradeAction({type: 'send_kas'})       ← trading.js
VERIFY_PAYMENT   → executeTradeAction({type: 'verify_payment'}) ← trading.js
```

这些 ACTION **全部走 `trading.js`,写 `mm_orders` 表**,**不走** `/exchange/publish`,不触发 `handleExchangeAccept`,不触发 `_autoPayExchange`。

**证据 2** — 现行 Exchange 流量落在 exchange_offers,由 seeder + trade-protocol-filter 驱动。mm-otc 跟这条链**平行**。

**证据 3** — mm-otc 的 "hedge/CEX/MEXC" 命中:

```
mm-otc.mjs:118     const exchange = new ccxt.mexc();  ← 仅用来读价格,不下单
```

mm-otc 自己**不做自动对冲**。只读 MEXC 作为 mid price 参考。

### 那 `_executeHedge` 在哪?

```
grep -rn "_executeHedge\|auto.*hedge" kasia-console/src/
```

→ (需补跑验证) —— spec §7 的位置假设需要再确认。**初步判断:hedge 不在 mm-otc,也不明显在 trade-protocol-filter**。要么 Martin 4/4 做的对冲还没 land,要么在另外的 service 里(比如 market-scanner 的 executor 分支)。

### 对 broker 的含义

- 如果 broker 走 **Exchange 协议**(方案 γ,推荐)→ 要定位 Exchange 路径上的 hedge trigger,在那加门控
- 如果 broker 走 **mm-otc 老路径**(ACTION:CREATE_MM_ORDER)→ **根本不走 Exchange,hedge 问题不存在**(但会错过 Exchange 协议的 cross_chain_tx 验证器等好处)

### Step G 开工前必须补一条验证:

```bash
grep -rn "hedge\|_executeHedge\|autoHedge" kasia-console/src/services/
```

搞清楚 hedge 真正触发点后再决定门控位置。

---

## 质疑 3:mm_orders 和 exchange_offers 什么关系?

### 答案:**exchange_offers 是当前系统,mm_orders 是 legacy 并行系统,已被取代**

**硬证据**:

| 项 | 值 |
|---|---|
| mm_orders 行数 | **0** |
| exchange_offers 行数 | **419** |
| mm-otc.mjs 最后 commit | **2026-04-08**(2 周前) |
| exchange_offers UPDATE 位置 | exchange.js + exchange-machine.js(活跃) |
| mm_orders UPDATE 位置 | trading.js(9 处,但零写入数据 → 代码存在但无数据流) |

**结论**:Exchange 协议架构(4/10+)上线后,**mm-otc + mm_orders 事实上停用**。代码在但数据库空,没人在新建订单。

### 为什么 Martin 记忆里"mm-otc 跑通过 2 笔"?

- **时间点**:早于 4/10 Exchange 架构上线
- **表**:当时写入 mm_orders,现在 0 行可能是 migrate 期间清了,或被迁移走了
- **不改变现状判断**:今天要启用 mm-otc 走老路径 = 走死胡同(不跟 Exchange 生态共享流动性/审计/自动化)

### 对 broker 的含义(关键)

**不要轻易"点亮 mm-otc"**。mm-otc 当下是孤儿代码,点亮它等于维护两套并行系统(mm_orders + exchange_offers),永远在两个表之间同步数据。

**正确路径**:broker 基于 **exchange_offers 协议**,不是 mm_orders。

mm-otc 的**定价逻辑**(CCXT + spread + 库存感知 + 客户历史)是宝贵资产,但需要**重新包装**:让它驱动 `/exchange/publish`(作为 MM 挂单的 pricing brain)而不是 CREATE_MM_ORDER。这是 T-22-06(不是 T-22-05)的工作。

---

## 对 T-22-05 v0.3 的修正建议

基于三答,**v0.3 方向没错但路径要调整**:

### 确定的部分

- ✅ broker 是 glue,不持库存 —— **对**
- ✅ A+B 打通理念 —— **对**,但 A(mm-otc)是"将来"的定价脑,不是"今天"的执行引擎
- ✅ 一期 0 佣金 —— **对**

### 必须修正

- ❌ "点亮 mm-otc 30 分钟搞定" —— **错**。mm-otc 跟 Exchange 协议脱钩,点亮 ≠ 能用。T-22-05 不能依赖 mm-otc
- ❌ broker 直接调 /api/exchange/accept 帮用户下单 —— **半对**。retail 无 relay → broker 必须也代发 `paid` 广播,状态机多一步
- ⚠️ hedge 门控位置待定 —— Step G 开工前先补 grep 验证

### T-22-05 v0.3.1 最小闭环(再次简化)

**MM 侧(今天不动)**:
- 保持现有 seeder(`market-seeder.js`)继续挂 SELL offers 到 exchange_offers
- seeder 定价用硬编码 spread(今天在跑)
- **不启用 mm-otc**(留给 T-22-06 重新包装成 seeder 的定价脑)

**broker 侧(T-22-05 要做的)**:
- 新 skill `broker.mjs`(~180 行,比 v0.3 多的是"等 txhash 代发 paid"这段状态机)
- 查 `/api/exchange/offers?status=open&maker=<seeder 地址>` 找可接 offer
- 用户 YES → broker relay 代发 `kanet_exchange_accept_v1`(broker = taker-of-record)
- 用户付款 → DM 回 txhash → broker 代发 `kanet_exchange_paid_v1` with txhash
- Exchange 协议自动推到 delivered(auto-deliver 已有)
- KAS 到 **broker relay** → broker 再 `sendKaspa` 转给用户的 Kasia 地址(1 笔 extra KAS TX,几 sompi)

**安全栏**:broker 钱包不能放大额 KAS,每笔接到就立刻转给用户(减少 broker 被攻击损失)。

**演示剧本**:
- 6 步(参照 v0.1 §11),新增第 7 步"broker 转发 KAS 给 user Kasia 地址"

### Hedge 位置已定位

补 grep 证据:

- 函数:`kasia-console/src/services/trade-protocol-filter.js:815` `_executeHedge(offerId, agentName, side, qty, preferredCex)`
- export:第 27 行 `export { _executeHedge as executeHedge }`
- 调用点 3 处(全部走同一 `_executeHedge`):
  - `api/exchange.js:587`
  - `services/exchange-machine.js:617`
  - `services/exchange-machine.js:749`
- 已有 circuit breaker `_hedgeFailures`,不影响门控设计

**Step G 落点**:在 `_executeHedge` 函数入口加:

```js
async function _executeHedge(offerId, agentName, side, qty, preferredCex = null) {
  // T-22-05 §7 安全门控 —— 只有显式 opt-in 的 offer 才对冲
  const offer = await getOfferById(offerId);
  const meta = JSON.parse(offer?.meta || '{}');
  if (meta.hedge_enabled !== true) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0,8)} hedge_enabled=false → skipped`);
    return;
  }
  // ...(现有逻辑不动)
}
```

**单点门控,3 个调用点自动受保护**。seeder / broker 默认不在 meta 设 `hedge_enabled`,**所有现有 offer 默认跳对冲**。只有显式 opt-in 才对冲。**向后兼容** —— 历史 offer meta 无此字段,全部 skip,跟今天行为一致(因为 hedge 本就没在跑)。

⚠️ **实施前额外校验一条**:`getOfferById` 函数要确认存在且同步/异步签名。若不存在,用 sqlite 直读。

---

## 结论

| 质疑 | 答案 | 对 v0.3 的影响 |
|---|---|---|
| 1. 付款触发 paid | **路径 β**(被动,broker 代发)| broker 状态机多一个等待态 |
| 2. Hedge 位置 | 跟 mm-otc 无关,在 Exchange 路径 | Step G 前补验证一条 grep |
| 3. mm_orders vs exchange_offers | **exchange_offers 是真,mm_orders 是孤儿** | broker 只面向 Exchange,不碰 mm-otc |

**可以开工 Step A 了吗**:需 Martin 批准。同时:
- [ ] Step G 前补 1 条 hedge grep 验证
- [ ] broker skill 规模从 ~150 行上调到 ~200 行(多"等 txhash + 代发 paid"段)
- [ ] broker 钱包设计:设置"收到即转发"规则,不滞留 KAS

---

**报告完。** 写 broker.mjs 前,Martin 看完批准即进 Step A。
