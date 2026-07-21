# NWT 设计审 — 测试框架拟人化 UI-driver 层

> **Status**: NWT VERDICT 2026-07-10
> **审对象**: `docs/2026-07-10-test-framework-ui-driver-design.md`(commit a9884901, Bettor 拟稿)
> **裁定**: 🟠 **GREEN-with-MUST-FIX — 方向对(复用既有 test-framework、驱动真实 bot.mjs 入口、不碰真 Telegram 服务器的边界划分都对),Bettor 自摆的 4 点里 2 点(隔离/poller 复用)需要在实现前钉死具体机制而非留作开放问题,另补 2 点新发现——其中一点直接关系到这套测试是否会重蹈 broker-fee-emit.mjs 那种"代码在但零证据活跃"的覆辙。**

---

## §4 Bettor 自摆四点核实

### 1. captured-出口 vs 真 Telegram 等价性 — 边界划分对,补一条命名纪律
Telegram 传输层不是 KANet 代码,排除进常规 CI 合理,真 token 冒烟另立手动 case 也对。**补一条**:`ui_expect_dm` 断言证明的是"bot 决定要发送 X",不是"用户手机收到了通知"——这两个是不同强度的 claim。**必须**在断言/文档措辞里显式区分(比如断言名叫 `dmDecided`/`dmQueued` 而非暗示"用户收到"的名字),否则未来有人看到"ui_expect_dm PASS"会误读成"DM 真送达用户",跟 broker-fee-emit 那次"代码写好但从没被真正验证过跑没跑"是同一种误读风险(有测试 ≠ 有效果)。

### 2. 🔴 MUST-FIX — handleUpdate 状态隔离:只提了风险,没定具体机制
Bettor 自己点出风险(测试 update 污染真实 `_state.json`)但没给出解法,留作开放问题。这条不能留到实现阶段才决定——**必须在设计里钉死**:
- state store 需要能被注入(DI,同 `broker-fee-emit.mjs` 那种 `db + deriveBrokerAddress` 注入模式,不新发明一套),driver 跑测试时传隔离的 temp state,不允许任何路径写到生产 `_state.json`。
- 若 bot.mjs 当前的 state 读写是硬编码路径(非注入式),这本身是**落地前的前置改动**(需要先给 bot.mjs 加 DI 口子),范围比"加一层 driver"更大,设计文档里没有说清楚这算不算本方案范围内的工作量——需要 J2/KANet-UI 落码前确认 bot.mjs 现状,不是想当然"driver 层能兜住"。

### 3. i18n 断言脆性 — 认可,方向对
测行为等价(槽位值+callback_data)而非字面 text-equals,跟既有 `feedback-guan2-test-behavior-not-rendering` 教训一致。无异议。

### 4. 🔴 MUST-FIX — ui_expect_dm 与 consumer poller 的关系:必须复用,不能独立实现
设计里把这个列成"待对齐"的开放问题,但这条**答案应该是唯一的,不该留选择空间**:`ui_expect_dm` 必须**驱动真实的 tg-bot poller 函数本体**(同一份 `notifyLine`/`eventsSince` 调用链),只在最后一步(真发 Telegram API)stub 掉——不能独立实现一套"检测 DM 该不该发"的平行逻辑。

理由(直接命门): 如果 `ui_expect_dm` 自己重新判断"这个事件该不该触发 DM",那测的是 driver 自己写的逻辑,不是生产 poller 的真实行为——**今晚 broker-fee-emit.mjs 零证据活跃这整场事故的根源,就是"代码写了但没有被真实调用链验证过跑没跑"**。若新测试框架的验收机制本身又是一条独立于生产代码的平行判断路径,等于用同一个病根去"验证"这个病根有没有被治好,验证结果没有意义(vacuous)。§2.1 里提到 poller 的 `eventsSince(broker_addr)` 已存在,driver 必须直接调用这个函数,不允许 reimplementation。

---

## 补充发现(Bettor 未列)

### 🟡 补充① — 合成 Update 对象绕过输入侧真实性,残留一条"未测"边界
§4 point 1 只讨论了输出侧(sendMessage 被 stub)的等价性,但**输入侧**同样有一个未讨论的边界:真实 Telegram webhook 到达 bot.mjs 之前,可能有输入验证/签名检查/中间件(如果有的话),用手工构造 `Update{message:{text}}` 直接喂给 `handleUpdate` 会跳过这层。这不一定是阻塞项(如果 bot.mjs 没有这类中间件,这条边界不存在),但设计文档应该显式确认"bot.mjs 在 handleUpdate 之前有没有依赖真实 webhook 上下文的逻辑",而不是隐含假设"构造的 Update 跟真实 Update 对 handleUpdate 而言完全等价"——这个假设本身值得一次快速代码核实,落码时顺手确认即可,不需要现在阻塞设计。

### 🔴 补充② MUST-FIX — 断言强度必须能区分"业务规则合理抑制" vs "静默失败",否则重蹈 broker-fee-emit 覆辙
`ui_expect_dm` 的断言逻辑(尤其是**反向断言**"预期不发 DM 时确实没发",比如 backfill-suppress 场景)必须能区分两种 "没有 DM" 的原因:
1. **业务规则合理抑制**(比如 backfill-suppress 标记了这盘历史 fee 不该推、或 no_broker_output 场景),
2. **管道本身静默失败**(cron 没跑/emit 条件不匹配/consumer 侧丢事件)。

如果测试框架的"没收到 DM = 正常"这类断言不强制要求"能读到 skip 原因的显式证据"(比如 `pool_markets.metadata.broker_fee_landed_emitted_at` 里的 `skipped:'no_broker_output'` 标记,§broker-fee-emit.mjs:116 已有这个字段),而只是简单地"等 N 秒没收到就当过"——这种弱断言本身就是 `vacuous teeth`,跟 broker-fee-emit.mjs 零证据活跃了两周没人发现是**同一个失败模式的测试版**:一个"测试通过"的信号,底层可能是"东西真的没发生"或"东西没检查对地方",两者从外部看一样绿。**要求**: `ui_expect_dm` 的否定断言(没收到 DM)必须连带读取并断言 skip 原因的显式证据字段,不能是纯粹的"超时未收到=PASS"。

---

## 裁定

| 项 | 级别 | 备注 |
|---|---|---|
| §4-1 captured-出口边界 | 🟢 认可 | 补命名纪律(dmDecided 非"用户收到") |
| §4-2 状态隔离 | 🔴 MUST-FIX | 落码前钉死 DI 机制, 确认 bot.mjs 现状是否需要前置改动 |
| §4-3 i18n 脆性 | 🟢 认可 | 无异议 |
| §4-4 poller 复用 | 🔴 MUST-FIX | 答案唯一化: 必须复用生产 poller 函数, 禁止平行实现 |
| 补充① 输入侧等价性 | 🟡 记录 | 落码时顺手核实, 非阻塞 |
| 补充② 断言强度 | 🔴 MUST-FIX | 否定断言必须读 skip 证据字段, 禁纯超时判定 |

**Phase 1(ui_expect_dm)可以开工**,但落码 diff 必须把 §4-2/§4-4/补充② 三条 MUST-FIX 一起交,不能"先跑起来再说"——这三条恰好都是"这套测试会不会重演 broker-fee-emit 式假绿"的核心防线,值得在 Phase 1(直接服务眼前主线①验收)就做对,不留给 Phase 2/3 补。

— NWT(relay 8dd59acb)
