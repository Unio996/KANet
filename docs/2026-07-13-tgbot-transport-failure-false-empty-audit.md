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
| bot.mjs:102,139 | `availableMarkets`+`cardGroups`(/start 首页趋势区块) | `if (av.ok && av.json?.ok) trending=...`(失败时保持初始 `[]`) | 🔴假空(区块静默不显, 用户以为没热门盘) | 加 transport guard(失败时不同渲染路径) |
| bot.mjs:289 | `brokerEarningsByAddress`(/broker 收益摘要) | `if (er.ok && er.json?.ok) earnings=...`(失败时 earnings 仍 null) | 🔴假空(显示"暂无收益"而非"查询失败") | 加 transport guard |
| bot.mjs:302 | `brokerEarningsByAddress`(/earnings 主命令) | `if (!r.ok \|\| !r.json?.ok) return earnings_fail` | ✅已正确区分 | 不动 |
| bot.mjs:367 | `championMarkets`(/champions) | 已有专门注释标注 2026-07-04 修过 r.ok vs 空区分 | ✅已正确区分 | 不动 |
| bot.mjs:422 | `availableMarkets`(/hot) | `if (!r.ok \|\| !r.json?.ok) return hot_fail` | ✅已正确区分 | 不动 |

**结论**: 6 处真实需要修(494/621/701/102/139/289)，5 处已经是正确模式(说明这个坑之前已经被独立发现修过几次，
只是没有形成统一 helper/纪律，新代码会持续复发同一坑——这条本身也是"零散逐点补丁不如单源 helper"的又一
案例)。3 处不在本轮范围(449 低优先级内部 helper、744 良性降级)。

## DoD

1. `console-api.mjs` 新增 `isTransportFailure(r)`，`i18n.mjs` 新增 `service_busy`(EN/ZH，Owner 已批复照发)。
2. 6 处调用点补 guard，逐点最小改动(不重构周边逻辑)。
3. 离线回归：mock `status:0` 场景验证每个改动点显示 `service_busy` 而非原假空文案；mock 真实空结果(`status:200,
   json.markets=[]`)场景验证仍正确显示"确实没有"文案(不能矫枉过正把真空也当成故障)。
4. lint-kanet 0 error。

## 明确不做什么

- 不改 `req()` 本身(避免波及所有其它已经用 `r.ok` 正确区分的调用点，风险不对称)。
- 不处理 449(内部 helper，无直接用户可见文案) / 744(良性降级到已有数据)。
- 不新增全局重试机制(那是 Owner 桥/反馈通道那两个卡各自的 retry 逻辑，本卡只做展示层文案区分)。
