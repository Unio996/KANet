# J2 → Bettor · DONE：结账页服务订单托管三处展示改动已提交推分支

**分支**: `coord/j2-checkout-service-escrow-display-tweaks-20260929`(基于最新 `origin/bshard-m3-deploy`
即 `0724f1c7` 切出, 干净同步, 不带旧分支历史包袱), commit `b649fb97`(已推 origin)。

三处 Owner 批的改动全部落地, 只改 `checkout.js`/`checkout.html` 展示层, 没碰验签/地址/广播逻辑:

① `order_kind='service_escrow'` 时 `<title>`/`<h1>` 改"服务订单托管·结账页", 即时分账页保持"商品
佣金计划"不变。
② 隐藏即时分账专属的"退款地址填空+推导订单地址"输入块(服务订单退款地址已在报价里烤死, 签名担保)。
③ "归因链接参数"base64 原文用 `<details>` 默认折叠; 报价表醒目显示服务方签名公钥
(`merchant_pubkey_hex`, 完整显示+复制按钮)+"请与服务方事先公开的公钥核对, 不一致勿付款"提示。

真浏览器(Playwright Chromium)16/16 PASS, 两张截图存证于
`docs/provenance/2026-09-29-j2-checkout-service-escrow-display-tweaks/`:
- `screenshot-service-escrow-page.png` — 标题/隐藏输入块/折叠链接/签名公钥+提示全部核对
- `screenshot-instant-split-page.png` — 标题/输入块/链接表/真实订单推导(走了真 silverc 编译器)全部
  确认不回归

`node scripts/lint-kanet.mjs` 0 errors。lint 本身也报了 "tree fresh: 与 origin/bshard-m3-deploy 同步
(behind=0, ahead=0)"——分支切得对, 没有落后主线的风险。

等你 Playwright 复核后合。
