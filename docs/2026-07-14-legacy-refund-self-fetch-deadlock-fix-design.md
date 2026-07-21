# legacyRefundBuilderTick 自 fetch 死锁修复设计 v1.0(第四源)

> **Status**: CURRENT (DRAFT v1.0 · Bettor 拟稿 2026-07-14 · 待 NWT 红队 → 落码)
> **优先级**: **P0** —— 夜间实测 285 次事件循环冻结 / 94 次 >30s / 最长 316 秒,系统大面积不可用,Owner 反复撞。
> **坐实证据(J2+NWT 双人独立)**: `pool-market-settler.js:247-249` `legacyRefundBuilderTick` 在 for 循环里 **serial await fetch 到 console 自己的 HTTP 端点**(`http://127.0.0.1:${PORT}/api/pool/market/:id/bettor-refund-claim`),且 **该 fetch 零 timeout 设置**(其它调用点均有 `AbortSignal.timeout`)。日志:`legacy-refund exception: fetch failed` 全天 134 次、`processed=5 triggered=0 failed=5`(成功率 0)。`poolSettlerTick` 从上午 560-1562ms 暴涨到 **314,586-392,421ms**。

## 1. 机制(为什么是自我死锁螺旋)

```
事件循环被占(任何原因)
  → legacyRefundBuilderTick 发给【自己】的 HTTP 请求排在同一个事件循环后面
  → 请求永远等不到自己处理(自锁)/ 超时失败
  → serial await 逐个 side 卡住,tick 时长 = Σ(每个 side 的等待)
  → tick 更长 → 事件循环占得更久 → 下一轮更容易失败
```

**恒定时长签名的解释**:失败耗时 ≈ (side 数 × 固定失败/超时耗时),两个因子都与数据量无关 → 每次冻结时长恒定(233-246s 观测值),这正是它既不像 GC(随堆变)也不像 backward-walk(随 gap 变)的原因。

## 2. 三处修法(按优先级)

### 修法 A(根治·必做):禁 HTTP 自调用,改内部函数直调
- `legacyRefundBuilderTick` 调用的 `/api/pool/market/:id/bettor-refund-claim` handler 逻辑,抽出为**纯函数**(如 `buildBettorRefundClaim(marketId, sideId, ctx)`),HTTP 路由与 tick **共用同一个函数**。
- tick 侧直接 `await buildBettorRefundClaim(...)`,**不再经过 HTTP 栈**——进程内自调用天然不需要网络往返,这条 fetch 从一开始就是设计错误。
- **同族排查(必做)**: grep 全 src,找出**所有** `fetch('http://127.0.0.1:${PORT}` / `localhost:3200` 的自调用点——这个反模式很可能不止一处。**lint 规则 `R-SELF-HTTP-FETCH`** 堵死复发(src/** 内禁 fetch 指向本机 console 端口)。

### 修法 B(纵深·必做):失败 side 上熔断
- 这 60 个 side **triggered=0 / 永远失败**,每 tick 重试 = 纯浪费 —— **正是 7/13 刚做的 `repeat-offender` 闸的完美用例**:同签名连续 3 次失败 → 标记隔离 + 审计行 + 可人工清除(`clearRepeatOffenderMarker` 已在)。
- 隔离后这批 side 转**人工处置卡**(它们失败的真因是另一个问题:`no local relay matches bettor_pk` / `no retail_dex_orders link`,属数据/身份问题,与本次性能修复分开处理,不可混为一谈)。

### 修法 C(兜底·必做):所有 fetch 必设 timeout
- 该 fetch 补 `AbortSignal.timeout(N)`(即使改内部直调后不再需要,也作为**通用防线**:任何无 timeout 的 fetch 都是潜在无限悬挂)。
- **lint 规则 `R-FETCH-NO-TIMEOUT`**:src/** 内 `fetch(` 调用未带 `AbortSignal.timeout` → WARN(白名单制)。

## 3. 验收标准(DoD)
1. `poolSettlerTick` 耗时回落到秒级(对照:上午健康值 560-1562ms)。
2. `diag:eventloop-lag` 中 **>30s 事件归零**(对照:夜间 94 次)。
3. `legacy-refund` 不再每 tick 重试永久失败 side(隔离生效,审计行可查)。
4. 全库自调用点清零 + 两条 lint 规则上线(防复发)。
5. 观察一个完整小时(覆盖 Mind 小时周期),lag 曲线做终验。

## 4. 风险与边界
- **非钱路**(不改任何签名/广播/状态转移逻辑),但**触碰 settler 主 tick**,必须 NWT 红队 + 回归测试全绿 + 装载窗三路核对。
- 修法 A 抽函数时**必须保证 HTTP 路由与 tick 走同一份逻辑**(不许复制两份 → 未来 drift,今日 9 文件死 id 就是不完整迁移的教训)。
- 那 60 个 side 的**业务真因不在本次范围**(身份/关联数据问题),本次只停止无效重试,不动它们的钱与状态。

## 5. 与反脆弱六柱的关系
本修复是**柱①(自愈隔离)**的第二个实例,并新增两条**柱③(配置/代码腐烂防线)**的 lint 规则。今日之后,"自己 HTTP 调自己" 与 "fetch 无 timeout" 两个反模式被机制堵死,不再靠人记得。
