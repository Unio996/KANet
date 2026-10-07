# 设计稿：数字商品「付款后交付」v0.3 — spike #1 结果落地 + nonce 只走 URL 片段（只设计，未写码）

> **Status**: CURRENT（DRAFT v0.3·待 Bettor 审）。接 v0.2（已合 0f39c6dd）。冲突处以本页为准。作者 J2 · 2026-10-07。
> **写作依 D-021**：不含密钥、真实地址、内网坐标。spike 证据在 `docs/provenance/2026-10-07-j2-delivery-spike1/`，报告 `docs/iteration/j1-inbox/2026-10-07T-j2-REPORT-delivery-spike1-payload-read-path.md`。

## 0. 变更摘要

1. **读路径改为"按信箱地址取交易历史"**（spike #1 实测）：买家页一次 `GET /addresses/{信箱地址}/full-transactions`，不再"先取 UTXO 再逐笔取交易"；信箱被扫走也不丢信。（v0.2 §4.B 步骤 4 替换。）
2. **读后端抽象成接口**，生产只有 1 家可用公共读服务（实测）；V1 缓解全部不新开入站端口（§2）。
3. **MUST（Bettor 追加）：`orderNonce` 从商家到买家只许走 URL 片段（`#`）或页面内交付，绝不进查询串或任何服务端日志**，实现须有断言（§3）。
4. 澄清 V1 的订单发起方式：**商家发票模式**（§4），回答"console 只听回环，订单从哪来"。
5. V1 实施计划与测试梯度（§5）。

## 1. 读路径（替换 v0.2 §4.B 步骤 4 与 §7-1）

接口（浏览器与测试共用同一契约）：
```
ReadBackend.listAddressTxs(address) -> [{ txid, payloadHex, isAccepted, acceptingBlueScore }]
ReadBackend.currentBlueScore()      -> number
```
- 生产实现：`api.kaspa.org` 的 `/addresses/{addr}/full-transactions`、`/info/virtual-chain-blue-score`（实测可用，`access-control-allow-origin: *`）。
- 买家页逻辑：对信箱地址取历史 → 只看 `isAccepted` 且 `currentBlueScore − acceptingBlueScore ≥ 20`（与 `REORG_SAFE_MIN_DEPTH` 同值）的交易 → 逐条 AEAD 解密，**第一条解密成功者即交付物**，其余忽略（垃圾/他人 payload 自然失败）。深度判定由页面自己算，不信读服务的"已确认"。
- simnet 测试实现：自己节点上扫区块的适配器（同一接口），生产与测试跑同一套契约测试。
- 可用性单点（实测只有 1 家可用）：退避重试 + 明示提示"货在链上不丢，稍后重试" + 商家后台展示 `mailbox_txid` 供买家**手填 txid**（走 `/transactions/{id}` 或 `/transactions/search`，同主机另两条路由）。第二后端：**自建 `kaspa-rest-server`**（同 API，开源）——给浏览器直读需要公网入口，**届时按"新开对外端口"单独报，本稿不带**。

## 2. 对 §6 端口清单的影响
V1（方案 B + 上述缓解）新开入站端口：**0**。不变。

## 3. MUST：`orderNonce` 只走 URL 片段（含断言清单）

**威胁**：密文永久公开，nonce 一旦泄露 = 货被取走（且不可撤销）。查询串会进：GitHub Pages / 反代访问日志、聊天软件链接预览（unfurl 会 GET 整个 URL）、浏览器历史同步、`Referer`、转发链。**片段（`#…`）不随 HTTP 请求发送**，也不进 `Referer`。

**规则**
1. 商家（console，回环）生成 nonce；给买家的链接形如 `…/order.html?q=…&ch=…&sc=…#n=<nonce>`——公开的报价/渠道参数仍可走查询串（它们本来公开、且参与归因核验），**nonce 只在 `#` 后**。
2. 买家页读取后**立即** `history.replaceState` 抹掉地址栏里的片段；nonce 只存页面内存与用户下载的凭据文件（凭据文件不上传）。
3. 页面代码**永不**把 nonce 拼进任何 `fetch/XMLHttpRequest/WebSocket/img/script` 的 URL；读后端请求只带**信箱地址**（nonce 的哈希派生物，不可反推）。
4. console 侧：订单创建接口（回环）响应体含 nonce，但**请求/响应日志不记 body**；任何 `console.log`/events/chain_events/审计表**不得**出现 nonce（只记订单地址末 8 位）。
5. 凭据文件（`order-receipt.js` 的 `order_nonce_hex`）按现状只在本地；**不得**加入任何自动上传/遥测。

**断言覆盖（实现时必须有，变异后变红）**
| # | 断言 | 方式 |
|---|---|---|
| a | 商家发票链接构造函数产出的 URL：`new URL(link).search` 中**不含** nonce 的任何 ≥8 位 hex 子串；`hash` 含 `n=<nonce>` | 单测 + 变异（把 nonce 放进 query ⇒ 红） |
| b | 买家页逻辑（注入 stub 的 `fetch`/`WebSocket`/`XMLHttpRequest`）走完"读片段→派生→读链→解密"全流程，**记录的所有请求 URL 均不含 nonce hex** | 单测（拦截器），变异：把 nonce 拼进读后端 URL ⇒ 红 |
| c | 页面读取片段后 `location.hash` 为空（`replaceState` 已调用） | 单测（jsdom/最小 location stub） |
| d | 静态扫描：`checkout-static/` 下**不得**出现把 `orderNonce`/`order_nonce` 与 `?`、`searchParams.set`、`encodeURIComponent` 同表达式拼接的代码（lint 规则，同 R-FEE-SPLIT-PKG-DRIFT 一类封闭式防护） | lint 规则 + 变异 |
| e | console 集成：创建订单→交付全流程后，**扫描 console 日志输出与 events/chain_events/审计表**，nonce hex 零命中（带对照臂：先把 nonce 故意写进一行日志，扫描必须命中，证明扫描器有力） | 集成测试（simnet） |
| f | `receiptLinkMismatch` 只比 `q/ch/sc`（现状）——加一条断言：给链接附加 `#n=…` 不影响比对结果，且比对函数从不读取 `hash` | 单测 |
| g | 商家后台展示/导出：不展示 nonce，仅展示订单地址与 `mailbox_txid` | 单测 |

> 注：对照臂（e）是必须的——"扫描 0 命中"在没有阳性对照时无信息量。

## 4. V1 订单发起：商家发票模式（回答"订单从哪来"）

console 只听回环，买家无法向 console 提交订单。V1（裁定①：方案 A 商家发号）= **商家（运营者）在本机 console 里创建订单**，得到带 `#n=` 的发票链接，经商家自己的渠道（聊天/邮件/自己的网站）交给买家；买家付款、取货全部发生在买家浏览器 ↔ 链上/公共读服务之间，**不需要买家访问 console**。商家 watcher 在 console 内按订单地址监视（读链走 relay，现成）。
- 这与"第②档自跑节点、数字分身也走这档"一致：数字分身把发票链接发给买家即可。
- 买家自发起（纯静态页、买家自带 nonce）属方案 B/V1.1：那时 console 不知道订单，需要"买家把凭据交回商家"的通道，另议。

## 5. 实施计划（V1 ≈ 3 天，按 Bettor 裁定：先 simnet，再主网小额）

| 步 | 内容 | 梯度 |
|---|---|---|
| 1 | 派生函数（HKDF → K / 信箱私钥种子）、AEAD 封装（浏览器 WebCrypto 与 Node 同一实现可测）、凭据与发票链接构造、单测（§3 a–c,f,g + v0.2 §8） | 零链 |
| 2 | relay 加性 payload 转账入口（三层注册、不进只读白名单）+ 卖家 watcher（照 `broker-buy-completion-watcher`）+ 交付/库存表与迁移 + `DATABASE.md` | simnet |
| 3 | 读接口契约 + simnet 扫块适配器；买家页取货逻辑（用户面，须 Owner 批） | simnet 端到端：付款→split→信箱→凭据取货；watcher 中途杀掉→到期可退；换 nonce 取不到；§3 e 带对照臂的日志扫描 |
| 4 | 主网小额：≤ 2 KAS、**仅我们自己的地址**、真实 api.kaspa.org 读路径；先只读复核 → 再由 Bettor 单点 GO 才做第一笔花费 | 主网 |
| 实测项 | 信箱输出最小面值、payload 转账实际网络费（沿用"节点拒绝文本取下限"法）；WebCrypto 打包与 pin | simnet |

## 6. 仍待 Bettor 定
| # | 问题 | 默认 |
|---|---|---|
| 1 | V1 接受"读服务单点 + 手填 txid 兜底"？ | 是；第二后端（自建）进 V1.1，若需入站端口另报 |
| 2 | 买家页取货属用户面，是否由 Bettor 统一送 Owner 批？ | 是，step 3 前拿到批 |
| 3 | 主网小额测试的"首笔花费"单点 GO 由谁给 | Bettor（J2 不自发起任何主网花费） |
