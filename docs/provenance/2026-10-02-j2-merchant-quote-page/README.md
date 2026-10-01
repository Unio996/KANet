# 商家建报价 / 生成推广链接（Bettor 2026-10-02 派工第三步，Owner 批）

目标：不懂技术的人在控制台点几下就出一张签名报价 + 结账链接（可复制、附二维码）。

## 新增（全部复用现成，不另起报价格式/签名机制）
- `kasia-console/src/api/merchant-quote.js`：`GET /api/merchant/quote-defaults`、`POST /api/merchant/keygen`、`POST /api/merchant/quote`。
  - 即时分账：报价字段逐字照 `checkout-static/config.js`（canonical_rules、渠道均分、余数并入 provider）+ `network`；签名 = `commission-plan-sdk.mjs signQuote`（含 mass 可行性与押金条款校验，不过不产生签名）。
  - 服务订单托管：`fastify.inject` 内部调用既有 `POST /api/service-escrow/quote`，不复制建单/签名逻辑。
  - 金额拆分 `fee-split.mjs feeSplit`；地址校验 `kaspa-network.mjs`（网络只取 env `KASPA_NETWORK`，不接受请求体覆盖）；二维码 = 结账页同款 vendored qrcode-generator。
- `kasia-console/src/ui/merchant-quote.eta` + `/merchant/quote` 路由 + 侧边栏“商家建报价”：样式沿用 /tokens 页（card/btn/Alpine）。
- 支付币种下拉已预留，KTT 置灰；API 层 `currency != KAS` 直接 400（等第二步设计审过再接）。
- 无新表、无新 relay 命令、不碰链、不花钱（服务订单只读一次节点 DAA）。

## 私钥（如实标注）
签名需要商家私钥，经本机 API 一次性传入、只在内存里签名、不落库、不写日志、不回显——与 `/api/service-escrow/quote` 的 `merchantPrivKeyHex`、`resolver.mjs /sign-quote` 同形先例；页面明示“建议用专门生成的新钥匙”，并提供“生成新钥匙”按钮。本代码不读取/解密控制台里任何 relay 的存量私钥。比“浏览器本地签名”（⑩ 票）弱，仍是已知票。

## 已知局限（如实）
- 服务订单 V1：买家确认/卖家取消由控制台的专用托管 relay 代签；若签名钥匙与该 relay 不是同一把，页面会警告“确认/取消无法由控制台代签，只剩到期退款（零签名）”。买家公钥留空 = 用专用 relay 公钥。
- 结账页网址需要商家自己填（或设 env `CHECKOUT_BASE_URL`）：结账页是纯静态包，控制台不托管它（仓库里没有 wasm 二进制，控制台托管不了一个能跑的结账页）。
- 服务订单报价带完整合约数据，链接常超二维码容量：此时不出二维码并提示复制链接（即时分账链接较短，附二维码）。
- 渠道（推广人）追加 `&ch=地址` 仍是链接上的手工步骤，沿用现有归因链接机制。

## 验收
- `e2e_merchant_quote.mjs/.log`：真 Chromium 打开控制台页（`serve_merchant_quote.mjs` 起的最小控制台：真 Fastify + 真 @fastify/view + 真路由与模板，非整个 console）→ 生成钥匙 → 建两种报价 → 复制链接 → 在真结账页（checkout-static，simnet 配置）打开：验签通过、价格 10 KAS / 2.5 KAS 对、provider 9.5 + partner 0.5（渠道未推广折回）、服务订单展示托管地址与 2.53 KAS（2.5 + max_split_fee）。反例：价格太低、渠道占比过高、缺私钥、KTT 币种、地址网络前缀不符。28/28。（日志里两条 404 `/api/system/*` 是页头轮询，最小控制台没挂那两个端点。）
- `kasia-console/src/api/merchant-quote.test.mjs`：路由级单测（解析/签名独立验过/q= 还原/各反例）全绿。
