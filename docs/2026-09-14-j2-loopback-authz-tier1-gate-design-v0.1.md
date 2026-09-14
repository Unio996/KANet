> **Status**: DRAFT-FOR-REVIEW v0.1

# T-LOOPBACK-AUTHZ 第一档（资金/密钥类）落地设计 v0.1

**范围**：docs-only（Bettor 1307 派工，NWT 审）。基于
`docs/2026-09-14-nwt-redteam-loopback-authz-triage-v0.1.md`（NWT 分档，下称"分档文档"）§一（Tier 1.1-1.4）
给每条路由具体闸——不重新分档，直接在分档结论上落地。§0（`runInstaller` RCE 级白名单绕过）不在本票范围，
KANet-UI 已单独处理。

## 0. 先说一个分档文档没展开、但直接决定怎么落地的事实：这批路由的真实调用方是谁

**核实方法**：`grep` 每条路由的路径字符串在 `kasia-console/src/ui/*.eta`（服务端渲染、发给浏览器的
页面模板，里面内嵌 `<script>` 用 `fetch()` 调 API）里出现的位置。抽查了分档文档四个子类里跨度最大的
代表路由（`trade/withdraw`/`defi/hyperliquid/order`/`broker/.*/order`/`polymarket/.*/redeem`/
`predictions/order`/`relays/.*/delete`/`relays/.*/assign`/`trade/mode`/`broker/accounts`/
`trade/accounts`），**全部命中 `.eta` 前端文件**，且逐一打开 `relays.eta` 里 `/api/relay/:id/transfer`
那次真实调用现场核实：

```js
const res = await fetch('/api/relay/' + _transferRelayId + '/transfer', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to, amount })
});
```

**零 header，纯同源 fetch。** 反向确认："已经在用 `x-ingest-secret` 的 4 个调用方"
(`grep -rl x-ingest-secret src/`) 全部是**服务端文件**（`admin.js`/`chat.js`/`discovery.js`/
`tg-wallet.js`，进程内互调），**没有一个 `.eta` 前端文件**——`verifyIngestRequest` 在本仓从来只服务
"进程对进程"场景，从未被用来保护过"浏览器打进来"的路由。

**这意味着什么**：分档文档 §五第2条建议"Tier 1.1/1.4 统一升级为 `verifyIngestRequest`"——机制本身没错，
但**直接照搬会立刻踩一个新坑**：`verifyIngestRequest` 校验的是一个固定共享密钥（`getConfig
('ingest_secret')`，启动时自动生成、写死存一份），如果浏览器前端要继续能用这些功能，前端 JS 就得
**拿到这个密钥**才能在 fetch 里带上它——而"浏览器怎么拿到一个只有服务端知道的密钥"这件事，唯一现实
的办法是服务端把它**嵌进页面**（比如渲染 `.eta` 时塞进一个 `<script>` 变量）。

**这样做能不能真的防住什么，还是只加了一步没用的手续？** 关键在于"谁能读到这个嵌进页面的值"——**同源
策略**保证了：只有从**同一个源**（`http://127.0.0.1:<port>` 或 `http://localhost:<port>`，取决于
KANet-UI 怎么访问）加载的页面能读到自己页面里嵌的这个值；**另一个 tab 里开着的恶意网站**即使能对
`localhost:<port>` 发起跨源 `fetch()`/表单提交（经典的"本地服务被网页 CSRF"手法——这正是"零鉴权+仅
靠 loopback"这个现状下**今天就能被利用**的真实攻击面：任何用户访问过的恶意网页都能静默转走这台机器
上 relay 的钱，不需要用户点任何东西），**读不到**这个嵌在 KANet 自己页面里的值（跨源 fetch 能发出去，
但拿不到响应体，也没法读另一个源页面的 DOM/JS 变量）。**能读到这个值的人，本来就已经能直接同源访问
这个页面本身**——不缩小"谁能看见密钥"，但确实缩小"谁能在不打开我们自己页面的情况下伪造请求"，直接
关掉 CSRF 这一整类攻击。仍然防不住"已经能在这台机器上读这个已加载页面的 DOM/内存"这个更高权限的
攻击者（比如恶意浏览器扩展、或者机器已经被 RCE）——但那个权限级别下，攻击者已经有更直接的手段（读
relay 解密后驻留内存的私钥、读 sqlite 库文件），不是这批路由的鉴权能单独兜住的范围，跟本 session
"Rule 84：进程内存能读到解密助记词"是同一条已经承认的残留边界，不是本设计新引入的缺口。

**结论：Tier 1.1/1.4 不能直接套用 `verifyIngestRequest` 的现成调用方式（那是给进程对进程用的），需要
一层"同源校验"作为浏览器调用路径的主防线，`verifyIngestRequest`/密钥头作为服务端到服务端调用路径
（如果将来真有这类调用方）的替代通道——两者 OR 关系，缺一边不挡另一边。** Tier 1.2/1.3 则相反：这两类
**应该**制造摩擦（凭据写入/自动化开关，不该"随便点一下就生效"），直接沿用分档文档建议的
`checkAdminSecretTier` 新档（未设=503，同 T-KEY-EXPORT 先例），不做同源豁免。

## 1. 新增机制：`checkConsoleOrigin`（Tier 1.1/1.4 专用，零前端改动）

```js
// kasia-console/src/lib/console-origin-check.mjs（新文件，提案）
/**
 * checkConsoleOrigin — 同源校验(CSRF 主防线)，给"浏览器点一下就会真实动钱/动密钥"的路由用。
 * 现代浏览器对同源/跨源的 fetch/表单提交都会带 Origin(部分场景退回 Referer)——跨源请求(恶意网页在
 * 另一个 tab 里打这台机器的 loopback 端口)的 Origin 不会等于这个 console 自己的源，天然被挡。
 * 零前端改动: Origin/Referer 由浏览器自动附加，.eta 页面现有 fetch() 调用不需要改一行代码。
 * @returns {{ok:true}|{ok:false, code:number, error:string}}
 */
export function checkConsoleOrigin(request) {
  const origin = request.headers['origin'] || null;
  const referer = request.headers['referer'] || null;
  const expected = _expectedOrigin(request);   // 从 request 自己的 Host header 推导，见下方实现细节
  if (origin) return origin === expected ? { ok: true } : { ok: false, code: 403, error: `csrf: Origin(${origin}) != console 自己的源(${expected})` };
  if (referer) return referer.startsWith(expected + '/') ? { ok: true } : { ok: false, code: 403, error: `csrf: Referer(${referer}) 不是从 console 自己的页面发起` };
  // Origin 和 Referer 都没有: 不是正常浏览器同源 fetch 的样子(现代浏览器同源 fetch 至少会带一个)，
  // 也不是已知的 ingest_secret 服务端调用方式——fail-closed 拒绝，不假设"没带头=安全"。
  return { ok: false, code: 403, error: 'csrf: 请求既无 Origin 也无 Referer，且未走 x-ingest-secret 通道' };
}
```

- `_expectedOrigin(request)`：从请求自身的 `Host` header 推导（`http://` + `request.headers.host`）——
  不硬编码端口（`kanet.env` 的 `PORT` 可能改，硬编码会在改端口后集体假拒绝），这样无论 console 实际
  跑在哪个端口/绑定哪个地址，"这个请求打的地址"和"Origin 声称的地址"两者一致就通过，天然适配部署环境
  差异，不需要额外配置项。
- **每条路由的实际用法是 OR，不是替换**：
  ```js
  const originCheck = checkConsoleOrigin(request);
  const secretCheck = originCheck.ok ? null : await verifyIngestRequestSoft(request);   // soft = 不直接 reply，只返回 ok/reason
  if (!originCheck.ok && !secretCheck?.ok) return reply.code(originCheck.code).send({ error: originCheck.error });
  ```
  （`verifyIngestRequestSoft` 是 `verifyIngestRequest` 的非 reply 版本，参考 `isValidIngestSecret` 已有
  的"返回布尔不发 reply"模式，本设计不重新发明，只是要一个能拿到 `{ok,reason}` 而不是直接写 response
  的变体，供 OR 判断用——落码时核实 `isValidIngestSecret` 是否已经够用，不一定需要新函数。）

## 2. Tier 1.1（直接资金/交易广播）— 逐路由落地表

| 路由 | 文件:行 | 闸 | 默认状态(合入即生效) | 现有调用方影响 |
|---|---|---|---|---|
| POST /api/relay/:id/transfer | relay.js:535 | checkConsoleOrigin OR ingest-secret | 立即生效，`.eta` 前端零改动继续可用(同源) | 无影响(核实过的真实调用) |
| POST /api/relay/:id/wallets/:walletId/withdraw | relay.js:999 | 同上 | 同上 | 无影响(域推断，模式与 transfer 一致) |
| POST /api/relay/:id/wallets/:walletId/send | relay.js:1059 | 同上 | 同上 | 无影响(域推断) |
| POST /api/relay/:id/wallets/:walletId/swap | relay.js:1208 | 同上 | 同上 | 无影响(域推断) |
| POST /api/relay/:id/wallets/:walletId/bridge | relay.js:1307 | 同上 | 同上 | 无影响(域推断) |
| POST /api/relay/:id/wallets/import | relay.js:837 | 同上 | 同上 | 无影响(域推断) |
| **POST /api/relay/:id/send-command** | relay.js:1827 | 同上 **+ 额外建议**：这条本身是"通用 IPC 直传"，`type` 完全调用方指定，即便加了同源校验，仍建议在 handler 内部对 `type` 做一次白名单(哪些 command type 允许经这条 HTTP 端点触达)——鉴权解决"谁能调"，不解决"这个端点本身暴露面过宽"，两个问题独立，本票只落鉴权，白名单收窄另开一票，不在本次范围内展开实现 | 立即生效 | 无影响 |
| POST /api/trade/withdraw | trading.js:154 | checkConsoleOrigin OR ingest-secret | 立即生效 | 无影响(核实过) |
| POST /api/defi/aave/withdraw\|borrow\|repay | defi.js:68/89/121 | 同上 | 同上 | 无影响(域推断) |
| POST /api/defi/hyperliquid/order\|close\|withdraw\|deposit, DELETE .../order/:id | defi.js:430/460/530/567/478 | 同上 | 同上 | 无影响(域推断) |
| POST /api/defi/aevo/order, DELETE .../order/:id | defi.js:925/960 | 同上 | 同上 | 无影响(域推断) |
| POST /api/tg-wallet/:tg_user_id/send | tg-wallet.js:152 | 同上 | 同上 | **需要额外核实**：`tg-wallet.js` 已经有 4 个调用点在用 `x-ingest-secret`(见上方 grep 结果)——这条路由若也被 Telegram bot 后端（非浏览器）直接调用，属于"已经在走 secret 通道"的那类，同源校验分支永远不会命中(Telegram bot 没有 Origin)，OR 逻辑天然兼容，但落码时需要确认这条具体路由的真实调用方是 bot 后端还是 `.eta` 前端(`grep` 只找到 UI 命中，不代表没有后端调用点，需要落码时对这一条单独确认) |
| POST /api/polymarket/:relay_node_id/redeem\|exit\|migrate-v2 | stocks.js:1049/1068/1030 | checkConsoleOrigin OR ingest-secret | 立即生效 | 无影响(域推断) |
| POST /api/predictions/order, .../positions/:asset/close | stocks.js:816/870 | 同上 | 同上 | 无影响(域推断) |
| POST /api/trade/order, DELETE .../order/:orderId, POST .../execute-split, .../mm-orders/:id/action | trading.js:1243/1529/1362/2221 | 同上 | 同上 | 无影响(域推断) |
| POST /api/broker/:id/order, DELETE .../order/:orderId | broker.js:210/239 | 同上 | 同上 | 无影响(核实过 `adapter.placeOrder`) |

## 3. Tier 1.4（密钥生命周期开关）— 逐路由落地表

| 路由 | 文件:行 | 闸 | 默认状态 | 现有调用方影响 |
|---|---|---|---|---|
| POST /relays/:id/delete | relay.js:188 | checkConsoleOrigin OR ingest-secret | 立即生效 | 无影响(核实过) |
| POST /api/relay/:id/restart | relay.js:209 | 同上 | 同上 | 无影响(grep 抽查这条在 `.eta` 里没直接命中我用的正则，落码时需要单独确认真实调用方——不排除是内部自动重启逻辑调用，若是则天然走不到 Origin 分支，需要确认那个调用点有没有配 ingest-secret) |
| POST /relays/:id/assign | relay.js:193 | 同上 | 同上 | 无影响(核实过) |

## 4. Tier 1.2（凭据存取）— 新增 `ADMIN_SECRET_ACCOUNT_CREDS` 档

同 T-KEY-EXPORT 先例："未设 = 503 disabled"，**不做同源豁免**（这类操作值得一次显式的操作员决定，不是
"用户随手点一下就该生效"）。

| 路由 | 文件:行 | 闸 | 默认状态(合入即生效) |
|---|---|---|---|
| POST/DELETE /api/broker/accounts(/:id) | broker.js:115/176 | `checkAdminSecretTier(request, 'ADMIN_SECRET_ACCOUNT_CREDS')` | **503**(env 未设)，这个 UI 功能在合入后到操作员显式设置这个 env 之前完全不可用 |
| POST/DELETE /api/defi/aevo/save-credentials\|credentials | defi.js:669/712 | 同上 | 同上 |
| POST/PUT /api/trade/accounts(/:id), POST .../test | trading.js:324/363/425 | 同上 | 同上 |
| POST /api/predictions/setup, .../deposit-wallet/setup | stocks.js:222/257 | 同上 | 同上 |

**这是一个真实的功能可用性代价，不是免费的**——合入这批闸之后，"添加/管理交易所凭据"这个 UI 功能会
立刻对所有用户 503，直到操作员主动在 `kanet.env` 加一行 `ADMIN_SECRET_ACCOUNT_CREDS=<随机值>` 并重启
console。**这个代价是否可接受、由谁来拍**——本设计只指出这是必然结果，不代为决定"该不该现在就这样上"，
留给 Bettor/KANet-UI/Owner 判断节奏（比如是否需要一个过渡期公告，或者先只在日志里 WARN 不 block，
下一批再切 block——那样需要另外设计一个"警告不拦截"的中间态，本票默认给的是分档文档原话"未设=503"
的直接版本）。

## 5. Tier 1.3（自动化武装开关）— 新增 `ADMIN_SECRET_AUTOMATION_ARM` 档

| 路由 | 文件:行 | 闸 | 默认状态 |
|---|---|---|---|
| PUT /api/trade/mode | trading.js:234 | `checkAdminSecretTier(request, 'ADMIN_SECRET_AUTOMATION_ARM')` | 503(env 未设) |
| PUT /api/trade/agent-mode | trading.js:257 | 同上 | 同上 |

用独立于 `ADMIN_SECRET_ACCOUNT_CREDS` 的第二个 env 名（不是同一把钥匙）——理由跟既有 `admin-secret-
tier.mjs` 头注一致："每个端点认自己的 tier 密钥, 拿低风险 tier 的钥匙去打高风险端点必须 403"，凭据
存取跟军火总闸是两类不同的操作员决定，合并成一把钥匙会让"我只想临时开一下自动化"这个动作意外带上
"顺便也能改凭据"的权限，范围没有必要地放大。

## 6. 测试计划

1. **`checkConsoleOrigin` 单测**（新文件，纯函数、不需要真实 HTTP server）：
   - 正向：`Origin` header 等于推导出的 expected origin → `{ok:true}`。
   - 负向①：`Origin` 是一个完全不同的域名（模拟恶意网页跨源打过来）→ `{ok:false, code:403}`。
   - 负向②：`Origin`/`Referer` 都缺失（模拟裸 curl/脚本直打）→ `{ok:false, code:403}`。
   - 正向(fallback)：无 `Origin` 但 `Referer` 以 expected origin 开头 → `{ok:true}`。
   - `_expectedOrigin` 推导：不同 `Host` header 值（模拟不同端口/绑定地址）都能推导出匹配自己的 origin，
     不硬编码端口。
2. **每条路由的接线核实**（同本 session 一贯"接线不是定义就完事"纪律）：对 Tier 1.1/1.4 每条路由至少
   一条集成测试——不带任何 header 直接打路由应该被拒(证明闸真的接上了，不是加了函数没调用)；带一个
   跟 console 自己 origin 相同的 `Origin` header 应该放行到下一步业务逻辑(不需要真的转账，验证到"过了
   鉴权这一关"即可，避免真花钱)。
3. **Tier 1.2/1.3**：env 未设时打路由 → 503；设了但 header 不匹配 → 403；设了且匹配 → 放行到业务逻辑。
4. 全部改动文件跑 `node scripts/lint-kanet.mjs`，0 error。

## 7. 合入后重启计划

**Tier 1.1/1.4（同源校验路径）不需要任何前端改动**——这是本设计特意选择 `checkConsoleOrigin` 而不是
"改前端塞 secret" 的核心原因：合入即生效，`.eta` 页面现有代码不用碰，重启 console 后浏览器刷新页面
（浏览器自动带 Origin，不需要用户或页面做任何新动作）即可继续正常使用。**风险窗口**：重启到浏览器
真正刷新之间的这段时间，如果浏览器还留着旧的已加载页面且用户在这段时间内触发一次旧页面的转账动作
——那次请求仍然会带正确的 Origin(页面本身没变，Origin 是浏览器根据"这个 tab 加载自哪个源"算的，跟
后端有没有重启无关)，**不受影响，可以安全合并进日常的 console 重启窗口，不需要专门协调"先更新前端
再更新后端"的顺序**（这正是同源校验方案相对"改前端注入 secret"方案的一个额外优点：没有"前后端必须
同时上线"这条运维约束）。

**Tier 1.2/1.3（新 admin-secret-tier）**：合入后这两组路由立即 503，直到操作员在 `kanet.env` 显式配置
`ADMIN_SECRET_ACCOUNT_CREDS`/`ADMIN_SECRET_AUTOMATION_ARM` 并重启 console——**这个重启是必须的、有感的
（功能从"能用"变"不能用"直到配置），需要跟 KANet-UI/Owner 提前说清楚这批合入会立刻让"添加交易所账户"
"切换 LIVE 模式"这两个功能在配置之前不可用**，建议合入前先在 `kanet.env` 上把这两个 env 配好、跟这批
代码在同一个重启窗口一起生效，避免"代码合了、功能却断了一段时间没人注意到"的空窗。

## 8. 不在本次范围内的事

- `runInstaller` 白名单绕过（第 0 档，RCE 级）——KANet-UI 已单独处理，不在本设计重复。
- `GET /ingest/pending-handshakes` 改 POST——分档文档已标注"docs-only 本次不展开实现"，本设计延续
  同样的范围排除，留给单独一票。
- `conversations.js` 的 10 条 `/api/test/*`——分档文档建议单独评估是否该在生产路由表完全不注册，
  本设计不展开。
- Tier 2/3（约 200 条状态类/无害类路由）——分档文档明确留给 KANet-UI 按业务判断排期，本设计只覆盖
  Tier 1。
- `POST /api/relay/:id/send-command` 的 `type` 白名单收窄——见 §2 表内该行备注，鉴权和白名单是两个
  独立问题，本票只落鉴权。
