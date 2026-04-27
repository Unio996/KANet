# Mobile Kasia V1-V3.5 验证报告

> 服务端(kasia-console / trade-protocol-filter)能查的全部查完。
> mobile 客户端(Kasia Android/iOS)代码不在本工作树,由 Martin 手工验证 UI。
> 本报告给出**服务端侧的结论**,并标注 mobile 端需要确认的盲点。

---

## 🎯 结论总览

| 验证项 | 服务端结论 | Mobile 客户端盲点(Martin 查)|
|---|---|---|
| **V1 accept_v1 广播接收** | ✅ server handler 就位(`trade-protocol-filter.js:664 handleExchangeAccept`) | mobile 能不能**生成** accept 广播?UI 入口在哪? |
| **V2 paid_v1 广播接收** | ✅ server handler 就位(`trade-protocol-filter.js:911 handleExchangePaid`),接受**任何 sender** | mobile 能不能**生成** paid 广播带 txhash? |
| **V3 收 KAS 到 mobile 钱包** | ✅ auto-deliver 自动 `sendKaspa` 到 `offer.taker` | mobile 的 Kaspa 地址能不能被用户知道 & 填进 accept? |
| **V3.5 sender 校验强度** | ✅ **软告警** — 非硬拒绝 | (无 mobile 依赖)|

**服务端侧 V1-V3.5 架构全 pass**。瓶颈不在 server,在 mobile UI。

---

## 🔍 V3.5 详解(最关键的一项,硬数据)

`cross-chain-verify.mjs:185-199`(BNB ERC20 USDT 校验,其他链对称):

```js
const sender = '0x' + transferLog.topics[1].slice(26);      // 185: 从 TX log 拿真 sender
// ...
const senderOk = !expectedFrom || sender.toLowerCase() === expectedFrom.toLowerCase();  // 190: 如果没给 expectedFrom 自动 pass
// ...
if (recipient.toLowerCase() !== expectedTo.toLowerCase()) {
  return { confirmed: false, ..., error: `Recipient mismatch: ...` };  // 196: recipient 错 = 硬拒
}
return { confirmed: true, ..., senderMismatch: !senderOk && !!expectedFrom };  // 199: sender 错只 flag,不拒
```

**行 190 的关键**:`!expectedFrom || ...` —— 如果 `expectedFrom` 为空(未传),`senderOk = true`,**完全不校验 sender**。

**行 199 的关键**:即使 `senderMismatch = true`,最终返回 `confirmed: true`。校验通过。`senderMismatch` 只是个元数据 flag,在上层是否使用,取决于 handleExchangePaid 是否读它。

### handleExchangePaid 处理 senderMismatch 了吗?

`trade-protocol-filter.js:911-952` 附近读 `msg.offer_id` 和 `msg.payment_tx`,然后走 recipient+amount 核对。**没发现对 senderMismatch 的硬拒逻辑**。

**V3.5 结论**:sender 不校验就完全不管;如果协议填了 taker_payment_address,校验通过仍返 confirmed,mismatch 只留痕。**retail 用户可以用任意 BNB 地址付款,不会被拒**。

**对 broker 设计的含义**:broker 在报价时**不需要**问用户的 BNB 地址。用户用 MetaMask 任意地址付都行。如果想要更强验证,可以把用户 BNB 填进 `taker_payment_address`,mismatch 会记 warning 但不拒交易。**这是 v0.3.2 清单 V3.5 的 decision:软告警 + 可填地址 → `纯 glue broker v0.3.2 立刻开工` 的矩阵项**。

---

## 🔍 V1/V2 详解

### 服务端 handlers 存在

| 消息类型 | handler | 接收条件 |
|---|---|---|
| `kanet_exchange_accept_v1` | `handleExchangeAccept(msg)` `trade-protocol-filter.js:664` | 收到链上广播即处理 |
| `kanet_exchange_paid_v1` | `handleExchangePaid(msg)` `trade-protocol-filter.js:911` | 读 `msg.payment_tx`,有 reuse 保护(4/14 Q3 audit),无 sender 限制 |

**服务端接收**:没有"只接受 Agent 广播,拒绝陌生人广播"的限制。**链上任何人广播该 type 的消息,服务端都会处理**。

这意味着:**只要 retail 用户从自己的 Kasia mobile 广播 accept_v1 / paid_v1(内容合法),服务端会接、会推进状态机、最终 auto-deliver**。

### mobile 客户端能不能生成这两条广播?

**我无法从 C:/kanet 工作树查证**。kasia-mobile 代码不在此仓库。

**Martin 手工验证方法**(5 分钟):

1. 打开 Android Kasia → 看有没有"市场 / Exchange / 交易"相关 tab
2. iOS 同上
3. 如果有,点进去看:
   - 能看到 offer 列表吗?
   - 有"接单"或"Accept"按钮吗?
   - 有"我已付款"或"Mark paid"之类按钮吗?
4. 如果都没有,再查:有没有某种"广播任意 payload"的高级功能入口

**三种可能结果**(跟 v0.3.2 清单一致):

| 结果 | 含义 | v0.3.2 路径 |
|---|---|---|
| A. mobile 有完整 accept/paid UI | 最佳 | broker 极简 glue,指引用户去按钮 |
| B. mobile 无 UI 但能广播任意 payload | 勉强可用 | broker DM 发 payload,用户点广播 |
| C. mobile 没 Exchange 协议能力 | 走法 B 破产 | 退走法 A(broker 代做 taker)|

### 如果是 B 或 C,server-side fallback

- **B 情况**:broker DM 把完整 accept/paid payload 发给用户,用户在 Kasia 里用"广播"功能手动发出。UX 差但能跑
- **C 情况**:broker 必须代做 taker。v0.3.1 设计回归。雷 1/2 靠以下缓解:
  - 雷 1 sender mismatch → V3.5 软告警,本来就不拒
  - 雷 2 reputation 归 broker → 记入 broker 的 agent_address,不归 retail

---

## 📊 v0.3.2 能写吗?

**服务端侧**:yes,现在就能写 broker.mjs 骨架,不等 mobile 验证。broker 的核心逻辑:
- 识别 intent
- 查 exchange_offers
- 翻译报价
- 指引用户

这三步**跟 mobile 是否支持 accept/paid 广播无关**。

**跟 mobile 能力相关的**:broker 最后两步是"指引用户自己广播"还是"代发广播"。这是**状态机的分支,不是架构差异**。

**策略**:broker 先写**共性部分**(识别/查/翻译/轮询),最后加一个 `mode` 配置:
```js
const BROKER_MODE = process.env.BROKER_MODE || 'auto';
// 'user_broadcasts' = 用户自己发 accept/paid(A 情况 / B 情况)
// 'broker_proxies'  = broker 代发(C 情况)
// 'auto'            = 启动时 probe mobile 能力决定(未来)
```

**一期先写 broker_proxies**(C 情况),**因为 Martin mobile 验证结果未出,这个是保底方案,永远能跑**。一旦 mobile 验证是 A/B,改 mode 即可切换。

---

## 🎯 Martin 需要回答 + 行动

### 现在能决定的(2 分钟)

1. **broker v0.3.2 spec 按"先写 broker_proxies 保底,未来切 user_broadcasts"这样分模式**,同意吗?
2. **Martin 手动 mobile 验证**今晚做还是先开工?(可以**并行**:我写 broker 骨架,你查 mobile)

### mobile 验证必做(5-10 分钟)

手机 Kasia 打开,看 Exchange / 市场 / 交易 三字眼 tab:
- ✅ 有 + 能接单 + 能标付款 → A 情况,broker 极简
- ⚠️ 有但只能看 offer 不能 accept → B 情况,broker 发 payload 指引
- ❌ 完全没有相关功能 → C 情况,broker 代发(已经是保底方案)

---

## 📋 完整结论

**服务端 V1-V3.5 全 pass**:
- ✅ accept/paid handler 就位
- ✅ sender 校验软告警(可填可不填)
- ✅ recipient 校验硬拒(正常)
- ✅ auto-deliver 到 offer.taker(用户 Kaspa 地址)
- ✅ exchange_offers 支持 taker_payment_address 等字段

**Mobile Kasia 能力**:未验证(代码不在此树),Martin 手工查 UI。

**broker 可开工**:双模式设计,`broker_proxies` 先写保底版,mobile 验证出来后切 `user_broadcasts` 升级版。

**代码量估**:
- broker_proxies 保底版:~150 行(v0.3.1 规模)
- user_broadcasts 升级版:~80 行(v0.3.2 glue 版)
- 两者共用 ~60 行骨架

---

**报告完。服务端全绿,等 Martin mobile UI 验证 + 批准 broker 双模式设计,开工 Step A**。
