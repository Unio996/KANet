# 设计稿：数字商品「付款后交付」v0.4 勘误（步 3 实测发现 + Bettor 账本1879/1880 裁定落笔）

> **Status**: CURRENT（勘误页，只设计/记录，不含密钥与真实地址）。作者 J2 · 2026-10-07。接 v0.3（`docs/2026-10-07-j2-digital-goods-delivery-design-v0.3.md`）；与 v0.1–v0.3 冲突处以本页为准。
> **写作依 D-021**：全部为占位/协议常量，不含真实密钥、地址、持仓。

## 0. 勘误一览

| # | 原稿说法 | 实测/裁定 | 影响 |
|---|---|---|---|
| E1 | v0.2/v0.3：发票片段里的"nonce"同时是订单合约 ctor 的 `order_nonce` 与全部密钥来源 | 🔴 **订单合约的 `order_nonce` 烤在 redeem 里，订单 UTXO 被花(split/退款)时 redeem 作为 sigScript 公开上链** ⇒ 若它就是秘密，split 一落链任何人都能解密交付物、清扫信箱与退款。**合约 nonce 必须是秘密的单向派生** | 步 3 已修（`deriveOrderNonce`，见 §2）；冻结线格式不变 |
| E2 | v0.3 §4：商家"按订单地址监视"，订单地址需买家回话（退款地址） | Bettor 账本1879 裁定：**发票模式退款地址 = 由秘密派生的 P2PK**，商家建单时订单地址即可完全算出；"买家回话 + `/address` 登记"保留为备选路径 | 步 3 已落地（`deriveRefundKey`） |
| E3 | 买家"应付总额"= 角色合计 | 🔴 simnet 实测：split 是单输入零签名，**差额全部作矿工费**，只付角色合计 ⇒ 手续费 0 被 mempool 拒（`0 fees … required 972800`）。**应付 = 角色合计 + `max_split_fee`**（与 InstantSplit 设计 v0.2 §2.3「充值口径」一致） | 已修；买家页/路由/watcher 的"应付"一律用该口径 |
| E4 | v0.2 §4.B 信箱面值估算 ≥0.02–0.03 KAS | 步 2 simnet 实测：relay `sendKaspa`(Generator)通路下 **最小可行 0.15 KAS**，默认 0.2；网络费 ≈0.032 KAS（3M 优先费下限为主） | 已写入步 2 交件与代码常量 |
| E5 | v0.2/v0.3 的"取货端点" | 已被"链上加密信箱 + 买家页读链解密"取代（v0.2）；读后端实测只有 api.kaspa.org 一家（spike #1） | 无新增入站端口 |
| E6 | split 的 relay 入口形态 | 不收调用方序列化的整笔 tx（v1 tx 的 SafeJSON 需要 UTXO 条目，且整笔 tx 是更大的信任面）；改为收**组件**，relay 本地构造并按订单 ctor 校验输出 | 步 3 已落地（`delivery_split_submit`） |

## 1. 术语（避免再次混淆）

- **交付秘密（secret）**：发票链接片段 `#n=` 里的 128 位随机值（代码里沿用参数名 `orderNonceHex`，**语义 = 秘密**）。
- **合约 nonce**：订单合约 ctor 的 `order_nonce` = `HKDF(秘密, 盐 "kanet-delivery-v1|order-nonce", info "kanet-delivery-v1/order-nonce", 16B)`。**公开可见**（redeem 公开），单向，推不出秘密。
- **派生密钥**（全部只从秘密派生）：AEAD 密钥（`…/aead`，盐=订单地址）、信箱私钥（`…/mailbox/<ctr>`，盐=订单地址）、退款私钥（`…/refund/<ctr>`，盐=`"kanet-delivery-v1|refund|"+network`，**盐不含订单地址**——订单地址由退款地址烤进 ctor，含了即循环）。冻结项（KDL1 线格式与前两个 info）不动。

## 2. 「秘密」的全部出现位置（允许）与不得出现的位置（禁止）——Bettor 账本1880 ①

**允许出现（且仅限这些）**

| 位置 | 形态 | 约束 |
|---|---|---|
| 发票链接的 URL 片段 `#n=<秘密>&dl=<deadline>` | 明文 | 只在片段；买家页读完立即 `history.replaceState` 抹掉；商家经自己的渠道交给买家 |
| 商家 console 建单路由的响应体（`invoice_link`） | 明文，**只此一次** | 回环 + `ADMIN_SECRET_DELIVERY` tier；fastify `logger:false`；路由不 `console.*` |
| 商家 console 库 `delivery_orders.nonce_encrypted` | `services/crypto.js` AES-GCM 信封（`CONSOLE_ENCRYPTION_KEY`） | 对外视图列显式枚举，永不含该列；watcher 只在加密交付物时内部解封 |
| 买家页内存（`startBuyerFlow` 闭包） | 明文 | 不进任何返回给 UI 的字符串字段；UI 只拿地址与金额 |
| 买家下载的凭据文件 `kanet-delivery-credential`（含 `n`） | 明文，**仅本地文件** | 页面只把它交给 Blob 下载，不发送；kind 与既有 `order-receipt` 不同，现有"凭据救援退款"流程拒收（见 §4） |

**绝不允许出现**

| 位置 | 为什么 / 怎么守 |
|---|---|
| URL **查询串/路径**、任何请求 URL | 会进静态托管访问日志、聊天链接预览、转发链。lint `R-DELIVERY-NONCE-IN-QUERY` + `buildInvoiceLink` 守卫 + 真实 Chromium 拦截所有请求（断言 b） |
| 任何网络请求的 `Referer` / POST 体 / 自定义头 | 页面 `<meta name="referrer" content="no-referrer">`；真浏览器测试逐请求断言 |
| 服务端日志、`events` / `chain_events` / 审计表、`delivery_*` 明文列 | watcher 日志只打订单末 8 位；断言 e（全流程后扫日志与表，带阳性对照） |
| **链上** redeem / witness / payload 明文 | redeem 只含派生的合约 nonce（断言：订单 redeem 与链上 split 的 sigScript 里无秘密的任何 8 位窗口）；payload 只有 AEAD 密文 |
| relay 命令字段 | watcher 只发密文 payload 与组件；秘密从不进 relay（relay 窄命令的字段表里没有它） |
| 页面 DOM 文本 / 商家后台 | 断言 g（后台响应零 nonce 片段、无 `nonce_encrypted` 字段名）；买家页文本零秘密（真浏览器断言） |
| 本仓库文档/示例/测试夹具的真实值 | D-021：只用占位 |

## 3. 其它实测落笔
- **E3 的后果**：quote 里的 `max_split_fee_sompi` 就是每单实际烧掉的上限（差额全是矿工费）。示例报价里的 `0.4 KAS` 过大；真实报价应按实测下限（本机 2.0.1 simnet：compute mass 9,728 ⇒ 972,800 sompi）留 ≈1.3×。"应付"展示给买家的数字 = 角色合计 + 该上限。
- **E1 的测试**：`delivery-invoice.test.mjs`（商家侧推导）与 `delivery-buyer.test.mjs`（买家页推导）各有一条"redeem 不含秘密、含派生合约 nonce"；买家页变异"合约 nonce=秘密"使 8 条测试变红。

## 4. 凭据文件与既有「凭据救援退款」流程（Bettor 账本1880 ②）
- 既有 `order-receipt.js` 的凭据 `kind='kanet-checkout-order-receipt'`，只在结账页本地解析（`checkout.js` 中凭据处理行无任何 `fetch`/XHR/WebSocket/sendBeacon），且其 `order_nonce_hex` 本就是**合约 nonce**（公开信息，非秘密）。
- 本设计的凭据 `kind='kanet-delivery-credential'`（含秘密）与之**不可互换**：`parseOrderReceipt` 对它抛 `凭据类型不符`（单测断言）；买家页只把它交给 Blob 下载，不发送（单测+真浏览器逐请求断言）。
- 文案红线（占位文案已体现，正式文案须保留）：凭据含秘密、等同于取货与退款的钥匙，只存自己设备，不发给任何人（包括"客服"）。

## 5. 本页之外仍待定（步 3 交件时一并给 Bettor）
1. watcher 的 `sendCommandAsync` 注入点：M0a 门要求新钱路模块不裸 import relay-manager；`index.js` 里对 `sendCommandAsync` 的那一次 import 需要经审 manifest 条目（`review_ref` 须为真实审核引用，J2 不能自编）。当前 `index.js` 只调 `startDeliveryWatcherCron(process.env, {})`，未注入则服务拒绝启动 ⇒ 零运行时影响。
2. 买家页文案（占位在 `delivery-copy.js`）→ Bettor → Owner 批；批准前只用占位。
3. 主网小额测试（步 4）的首笔花费：Bettor 单点 GO。
