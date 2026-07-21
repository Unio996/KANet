> **Status**: CURRENT

# tg-bot 传输失败被当空数据消费 — 全量清单 + 修法

**作者**: KANet-UI(2026-07-13,Bettor 派工 #izjcun.1,模式级裁定)

**背景**: 今早连续三处撞到同一族 bug——传输失败(fetch 超时/网络错误)被 catch 吞掉、返回值默认成空结构、
调用方把"空"当"业务上确实没有"处理，用户看到的是永久性语气的假空态("未分类 owner"/"No open markets"/
"无开放市场")而非"再试一次"。console-api.mjs 的 `req()` 已经有区分信号——`status: 0` **唯一**标记 fetch 本身
抛错(catch 分支)，跟任何真实 HTTP 响应(哪怕是 500)都不同：

```js
// console-api.mjs:10-21 (现状, 未改)
async function req(method, path, body) {
  try {
    const res = await fetch(...);
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: e.message } };   // ← status===0 唯一标记传输失败
  }
}
```

## 修法：新增判定helper + i18n统一文案，逐点补 guard（不改 req() 本身）

```js
// console-api.mjs 新增导出
export function isTransportFailure(r) {
  return r.status === 0;   // fetch 本身抛错(超时/网络), 区别于任何真实 HTTP 响应(含 4xx/5xx)
}
```

```js
// i18n.mjs 新增 key(Owner 已批复"点头即用"照发)
// EN: service_busy: 'Service busy, please retry in a moment.'
// ZH: service_busy: '⏳ 系统繁忙，请稍后再试。'
```

各调用点在现有空值降级**之前**插入一行：`if (api.isTransportFailure(r)) return t(lang, 'service_busy');`
（或 callback 场景改为不渲染该区块，见下表）。

## 全量清单（grep 全部 `api.xxx()` 调用点逐一核实，非假设）

| 文件:行 | 调用 | 现状 | 分类 | 修法 |
|---|---|---|---|---|
| prediction-menu.mjs:198,392 | `myPositions` | `if (!r.ok) return mybets_fail` | ✅已正确区分 | 不动 |
| prediction-menu.mjs:449 | `myPositions` | `if (!r.ok) return []` | 内部 helper(非直接用户可见), 低优先级 | 本轮不动, 记录 |
| prediction-menu.mjs:494 | `poolMarket` | `market = ... \|\| null` → `market_not_found` | 🔴假空 | 加 transport guard |
| **prediction-menu.mjs:621** | `availableMarkets(100)` | `allMarkets = ... \|\| []` → `bet_no_markets` | 🔴假空(**Owner 今早实撞这条**) | 加 transport guard |
| prediction-menu.mjs:701 | `poolMarkets` | `all = ... \|\| []` | 🔴假空(分类浏览) | 加 transport guard |
| prediction-menu.mjs:744 | `poolMarket` | `full = ... \|\| m`(回退到已有摘要对象) | 良性降级(非假空, 显示陈旧但真实数据) | 不动 |
| bot.mjs:102,139 | `availableMarkets`+`cardGroups`(/start 首页趋势区块) | `trending`/`sports` 初始 `null`, 只在成功时赋值; `messages.mjs:56-62` 用 `trendingMarkets !== null` 区分"失败=完全省略该区块" vs "`[]`=显示确认空态" | ✅已正确设计(**审计初稿误判为 bug, 更正**) | 不动 |
| bot.mjs:285 | `brokerOnboardStatus`(/broker 主状态) | `status` 初始 `null`, 失败时保持 `null`, 落到 `brokerRole()` 最后一个 `else` 分支——对**已 approved 的 broker** 显示"申请步骤"文案(暗示还没申请) | 🔴假空(比"暂无数据"更误导: 直接给错指引) | 加 transport guard, 短路整条回复 |
| bot.mjs:289 | `brokerEarningsByAddress`(/broker 内嵌收益摘要) | 只在 `status` 已成功加载且 `approved` 分支内才会走到, `earnings` 失败时 `if(earnings)` 为 false → 显示 `broker_role_earnings_no_data`(中性"暂无数据", 非误导指令) | 中性降级, 非本轮范围(可选跟进, 优先级低) | 不动 |
| bot.mjs:302 | `brokerEarningsByAddress`(/earnings 主命令) | `if (!r.ok \|\| !r.json?.ok) return earnings_fail` | ✅已正确区分 | 不动 |
| bot.mjs:367 | `championMarkets`(/champions) | 已有专门注释标注 2026-07-04 修过 r.ok vs 空区分 | ✅已正确区分 | 不动 |
| bot.mjs:422 | `availableMarkets`(/hot) | `if (!r.ok \|\| !r.json?.ok) return hot_fail` | ✅已正确区分 | 不动 |

**结论(实现阶段更正)**: 逐点写 mock 测试时发现审计初稿把 bot.mjs:102/139 误判成 bug——`messages.mjs` 早就用
`trendingMarkets !== null` 区分"失败静默省略区块" vs "`[]`=显示确认空态"，这是安全模式，不该加同款 guard(加了
反而会在纯装饰性区块偶发抖动时对用户展示不必要的"系统繁忙"横幅，过度惊扰)。深挖同款 `null` 初始值模式时，
在 `brokerOnboardStatus`(285)找到一个**审计初稿没列出的真实 bug**：`status` 传输失败时同样保持 `null`，但
`brokerRole()` 对它的处理不是"省略"，是落到最后一个 `else` 兜底分支显示"申请步骤"——对一个已经 approved 的
broker，这条文案不是中性省略而是主动给出误导性指令。**最终修复清单 = 4 处**：`prediction-menu.mjs:494/621/701`
+ `bot.mjs:285`。审计方法论教训：同样的"null 初始值 + 条件渲染"写法，`!== null` 判空 vs 无条件 fallthrough 到
最后一个 else，前者安全后者不安全——不能只看"用没用 null 初始值"就归类，要具体看渲染端的分支逻辑。

## DoD

1. `console-api.mjs` 新增 `isTransportFailure(r)`，`i18n.mjs` 新增 `service_busy`(EN/ZH，Owner 已批复照发)。
2. 4 处调用点补 guard(`prediction-menu.mjs:494/621/701` + `bot.mjs:285`)，逐点最小改动(不重构周边逻辑)。
3. 离线回归：mock `status:0` 场景验证每个改动点显示 `service_busy` 而非原假空文案；mock 真实空结果(`status:200,
   json.markets=[]`)场景验证仍正确显示"确实没有"文案(不能矫枉过正把真空也当成故障)。
4. lint-kanet 0 error。

## 明确不做什么

- 不改 `req()` 本身(避免波及所有其它已经用 `r.ok` 正确区分的调用点，风险不对称)。
- 不处理 449(内部 helper，无直接用户可见文案) / 744(良性降级到已有数据)。
- 不新增全局重试机制(那是 Owner 桥/反馈通道那两个卡各自的 retry 逻辑，本卡只做展示层文案区分)。
