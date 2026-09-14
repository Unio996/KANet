> **Status**: DRAFT-FOR-REVIEW v0.2（供 NWT 审；NWT 已确认方向 `12c73208`：Origin 只作 AND 副闸、页面
> token 无效、sessionStorage 方案有效——本稿把这条确认落成完整设计）

# T-LOOPBACK-AUTHZ 第一档落地设计 v0.2 — admin-secret-tier 主闸 + 浏览器一次性解锁

**本稿取代 v0.1 §0-§1 的机制部分**（`checkConsoleOrigin` 单独作为主闸的方案已证伪，见下方"v0.1 错在
哪"）。**v0.1 §2-§5 的逐路由分类表(Tier1.1/1.2/1.3/1.4 哪些路由属于哪一类)仍然有效，不重复列一遍**
——本稿只换"每一类路由挂什么闸"这件事，不改"哪条路由属于哪一类"。

## 0. v0.1 错在哪（两轮红队，如实记录，不是掩盖）

1. **第一版**（`checkConsoleOrigin` 单独当主闸）：Origin/Referer 对浏览器发起的跨源请求确实不可伪造，
   但对一个直接拿 curl/脚本打 loopback 端口的攻击者，Origin 只是普通 header，想设成什么就是什么——
   而这正是 T-LOOPBACK-AUTHZ 这整个课题要防的**主要**威胁（"任何其它本机进程"），不是浏览器 CSRF
   这个次要威胁。Bettor 1313 指出。
2. **第二版**（补一个页面渲染时注入的 token）：这个 token 能不能防住"本机进程"，取决于"拿到 token
   的门槛有多高"——而 console **没有登录态**，页面本身也是同一台机器上零鉴权的 GET，本机进程可以
   先 GET 页面把 token 抠出来，再拿着 token 去打 API，两步都不需要任何浏览器才能做到的能力。Bettor
   1314 指出：本质是同一个根因的第二次复发——**这个系统里没有任何东西是"攻击者拿不到、合法方拿得到"
   的，不引入一个真正只有人知道的秘密，绕不开这层**。
3. NWT `12c73208` 独立复核确认：Origin 检查本身不是没用（挡浏览器 CSRF 这个真实存在的次要威胁），
   但只能作 **AND 副闸**，不能单独当主闸；页面注入 token 方案在"无登录态"这个约束下**无效**，不建议
   采用；`sessionStorage` 方案（真秘密+浏览器一次记忆）有效。

## 1. 设计：admin-secret-tier 主闸 + 浏览器一次性解锁

### 1.1 后端机制（复用现成，不新造轮子）

```js
// checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS')   — 已有函数(admin-secret-tier.mjs)，零改动
```

**新开一档 `ADMIN_SECRET_FUNDS`，还是复用现有档？——取舍写清楚，不代为拍板**：

| 选项 | 优点 | 缺点 |
|---|---|---|
| 新开 `ADMIN_SECRET_FUNDS` | 跟既有 `ADMIN_SECRET_ZK_CLOSE_BROADCAST`/`ADMIN_SECRET_STATUS_SIGN`/`ADMIN_SECRET_KEY_EXPORT` 等"每类操作一把钥匙"的既定纪律一致（`admin-secret-tier.mjs` 头注原话："拿低风险 tier 的钥匙去打高风险端点必须 403"）；这批路由(Tier1.1，直接资金广播)风险等级跟已有几档不完全一样(比如跟 `ADMIN_SECRET_ZK_CLOSE_BROADCAST` 同属"真实广播"但覆盖面是完全不同的资产/协议)，独立开一档不会跟任何现有档混淆范围 | 又多一个 env 变量要操作员记住/配置 |
| 复用 `ADMIN_SECRET_KEY_EXPORT`(已有、已审) | 零新增配置项，操作员已经知道这个值 | **语义污染**：`ADMIN_SECRET_KEY_EXPORT` 的既定语义是"导出密钥"这一件事(且叠了 `RELAY_KEY_EXPORT_ENABLED_UNTIL` 时间窗)，把"转账"也塞进同一把钥匙，会让"泄露这把钥匙"的后果从"能导出密钥"膨胀成"能导出密钥+能转走所有资金"，也让`checkKeyExportWindow`那层时间窗逻辑对转账场景不适用(转账不该有"过期窗口"这种语义)——**不推荐**，本稿建议新开一档 |

**本稿建议：新开 `ADMIN_SECRET_FUNDS`。** 覆盖 v0.1 §2-§3 的 Tier1.1(直接资金广播) + Tier1.4(密钥生命周期开关) 全部路由——这两类风险等级相近（"移动资金"和"让密钥离开静止存储状态"，v0.1 §1.4 已经论证过是同一条链路的两端），共用一把钥匙合理，不需要为 1.4 再单独开一档。

**"未设 = 503"**（同 T-KEY-EXPORT/既有全部 tier 先例，`checkAdminSecretTier` 函数本身已经是这个语义，
零改动）。

### 1.2 前端机制（新增，v0.1 声称"零前端改动"这条在 v0.2 不成立，见 §3）

**一次性解锁 + `sessionStorage` 记忆**：

1. 操作员第一次在这个浏览器会话里触发 Tier1.1/1.4 任一操作时（比如点"转账"按钮），前端检查
   `sessionStorage.getItem('kanet_funds_secret')` 是否存在。
2. **不存在**：弹出一个输入框（"输入资金操作密钥"），操作员手动输入 `ADMIN_SECRET_FUNDS` 的值（这个值
   由 Owner/操作员自己配置进 `kanet.mainnet.env`，通过带外渠道告诉自己/需要用这个功能的人——不是本稿
   范围内展开"怎么安全分发这个值"，那是操作规程问题不是代码设计问题）。前端**不校验**这个值对不对
   （校验交给后端，前端只负责收集+存）——存入 `sessionStorage.setItem('kanet_funds_secret', value)`，
   然后带着这个值重发刚才那次操作。
3. **存在**：直接从 `sessionStorage` 读出来，作为 `x-console-admin-secret`(header 名跟 `checkAdmin
   SecretTier` 默认的 `x-kanet-admin-secret` 保持一致，不新发明 header 命名——落码时核对
   `checkAdminSecretTier` 第三参数 `headerName` 默认值，直接用默认值不用传自定义 header 名) 附加到
   fetch 调用上。
4. **后端 403**（密钥错）：前端捕获 403，`sessionStorage.removeItem('kanet_funds_secret')`，重新弹出
   输入框（"密钥不正确，请重新输入"），不静默重试、不无限循环——一次错误立刻要求人重新确认，不允许
   前端自己"猜第二次"。
5. `sessionStorage` 的生命周期天然是"这个浏览器 tab/窗口关闭即清空"（浏览器原生行为，不需要额外写
   过期逻辑）——**这就是"每浏览器会话解锁一次"这句话的字面意思，不是"每次转账都要输入"，也不是"永久
   记住直到手动清除"**。

**这一段("要不要引入一次解锁摩擦"、"摩擦收窄到多大颗粒度合适")是产品决定，不是纯安全机械问题——
本稿只给出可行的实现方案，最终"值不值得为这份安全增量换这份摩擦"由 Owner 拍板（Bettor 1319 原话）。**

### 1.3 Origin 副闸（AND，不是 OR）

```js
const secretCheck = checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS');
if (!secretCheck.ok) return reply.code(secretCheck.code).send({ error: secretCheck.error });
const originCheck = checkConsoleOrigin(request);   // v0.1 §1 已设计的函数，机制不变，角色改变
if (!originCheck.ok) return reply.code(originCheck.code).send({ error: originCheck.error });
```

**顺序很关键**：先查密钥（主闸），密钥都不对直接拒绝，不管 Origin 是什么；密钥对了之后再查 Origin
（副闸）——这样即便密钥不知怎么泄露给了一个能设置任意 header 但**不是**从 console 自己页面发起请求
的攻击者（比如密钥被记在某个不安全的地方被读到），Origin 检查仍然多一层拦截。**两者都是 AND 关系，
缺一个都不放行**——这是 v0.1 最初设计"Origin OR 密钥"的直接反面，吸取教训。

### 1.4 服务端到服务端调用方：`ingest_secret`

v0.1 §2 表格里标了"需要额外核实"的 `POST /api/tg-wallet/:tg_user_id/send`——如果这条路由的真实调用方
确实包含 Telegram bot 后端（服务端到服务端，没有浏览器/Origin 概念），这条走**独立的** `verify
IngestRequest`(`x-ingest-secret`) 通道，不强求也过 `ADMIN_SECRET_FUNDS`——两个通道 OR 关系（前端浏览器
走 admin-secret-tier + Origin，服务端调用方走 ingest_secret，二选一即可，不要求同一个请求两个都满足，
因为服务端调用方根本没有"浏览器一次性解锁"这个概念，也不该被要求有）。

## 2. 逐路由闸更新（只列"闸"这一列的新值，路由/文件行号/调用方影响见 v0.1 §2-§3 原表，不重复贴）

- **Tier 1.1（v0.1 §2 全部 18 条）+ Tier 1.4（v0.1 §3 全部 3 条）**：
  `checkAdminSecretTier(request, 'ADMIN_SECRET_FUNDS')` **AND** `checkConsoleOrigin(request)`，
  **OR** `verifyIngestRequest`（仅 `tg-wallet.js` 这一条，若落码时核实到它确实有服务端调用方）。
- **Tier 1.2/1.3**：v0.1 §4-§5 已经是 `checkAdminSecretTier`（新档），**本稿不改**——这两类本来就不
  做同源豁免、本来就是"未设=503"，跟本次调整的方向一致，不需要额外叠 sessionStorage 机制（那两类
  本来就不追求"浏览器无摩擦"，直接要求配置好 env 是既定设计，见 v0.1 §4/§5 原文）。

## 3. 前端改动面（v0.1 声称"零前端改动"，v0.2 不再成立，需要明确列出）

**需要改的 `.eta` 文件**（v0.1 §0 已经 grep 过一轮，这次补齐要改的具体内容）：`relays.eta`（transfer/
wallets import/delete/restart/assign 等多处 fetch）、`exchange.eta`、`market.eta`/`market-v2.eta`、
`hyperliquid.eta`、`stocks.eta`、`predictions.eta`、`trading.eta`、`partials/trade-otc.eta`、
`partials/trade-portfolio.eta`、`portfolio.eta`。

**建议做法**：不在每个 `.eta` 文件里各写一遍"读 sessionStorage + 弹窗 + 挂 header"的逻辑（会重复 10
遍、以后改一次要动 10 个文件）——抽成一个**共享的小型前端 helper**（比如 `public/js/funds-auth.js`
或者塞进现有的公共 JS 文件，落码时核对本仓前端 JS 组织方式），提供一个函数比如
`fetchWithFundsAuth(url, options)`，内部处理"读 sessionStorage → 没有则弹窗收集 → 挂 header → 发请求
→ 403 则清空重试一次弹窗"这一整套逻辑，10 个 `.eta` 文件里原来直接 `fetch(...)` 的地方全部换成
`fetchWithFundsAuth(...)`——**这是本次改动里真正的"新工程量"所在**，不是简单加个 header 那么小。

## 4. 测试计划

1. `checkAdminSecretTier` 本身已有测试（`admin-secret-tier-key-export.test.mjs` 等既有文件），本次
   只是新开一档 env 名，机制零改动，不需要新测该函数本身。
2. `checkConsoleOrigin` 单测同 v0.1 §6，不变。
3. **每条 Tier1.1/1.4 路由集成测试**：无 `x-kanet-admin-secret` header → 401/403（视 `checkAdmin
   SecretTier` 具体返回码）；带错误值 → 403；带正确值但 Origin 不对 → 403（验证 AND 语义，不是随便一
   个对了就放行）；两者都对 → 放行到业务逻辑。
4. **前端 helper 单测**（如果本仓前端 JS 有对应测试基础设施——落码时核实，若没有，至少手工过一遍：
   首次点击弹窗、输入后存 sessionStorage、二次点击不再弹窗、故意输错触发 403 后清空重新弹窗）。

## 5. 合入后重启计划（v0.2 关键变化：不再是"零协调"）

**v0.1 原来的卖点是"后端改动跟前端零关联，可以随便什么时候重启"——这条在 v0.2 不成立**：如果先合
后端(要求 header)、前端还没改，现有 `.eta` 页面的转账等操作会立刻全部 403（用户看到的是一个后端错误
提示，不是设计好的"请输入密钥"弹窗）；如果先合前端(会尝试读 sessionStorage 挂 header)、后端还没开
`ADMIN_SECRET_FUNDS` 这个 env，`checkAdminSecretTier` 是"未设=503"，功能一样不可用，只是报错信息
不同。**前后端必须在同一次 console 重启里一起上线**（同 T-KEY-EXPORT/`ADMIN_SECRET_ACCOUNT_CREDS`
那类"未设即不可用"改动一样，需要合入前先在 `kanet.mainnet.env` 配好 `ADMIN_SECRET_FUNDS`，代码+配置
+前端同一个窗口一起生效，避免中间态）。

## 6. 不在本次范围内

同 v0.1 §8，另加一条：**"操作员如何安全获知/分发 `ADMIN_SECRET_FUNDS` 这个值"是操作规程问题**，本稿
只设计"系统怎么用这个值"，不设计"这个值怎么产生/怎么告诉该知道的人"——那需要 Owner/Bettor 按现有
密钥管理惯例另定。
