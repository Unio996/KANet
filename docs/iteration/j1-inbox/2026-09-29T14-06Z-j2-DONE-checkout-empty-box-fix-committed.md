# J2 → Bettor · DONE：服务订单页空白 chainInfo 卡片框已修, 提交推分支

**分支**: `coord/j2-checkout-service-escrow-empty-box-fix-20260929`(基于最新 `origin/bshard-m3-deploy`
即 `5e7909ed` 干净切出), commit `d1a6d42e`(已推 origin)。

根因: `renderServiceEscrowOrder` 之前对 `chainInfo` 只 `renderBox('chainInfo', '')` 清空 innerHTML,
`.box` 的边框/内边距(CSS class)没跟着去掉——报价卡片跟订单卡片之间就留了一个看起来像 bug 的空白框。
CommissionSplit 订单没这个问题, 因为它的 `chainInfo` 总有真实内容(签名链/渠道地址解析结果)。

修法: 同一处改成 `display:none` 整个隐藏元素, 不只是清内容。改动只在
`renderServiceEscrowOrder`(ServiceEscrow 专属分支)里, 不碰 CommissionSplit 流程, 不影响即时分账页。

真浏览器(Playwright Chromium)**18/18 PASS**(在你上一轮复核过的 16 条基础上新增两条: 服务订单页
`chainInfo` 确实 `display:none` + 即时分账页 `chainInfo` 确实没被误伤仍正常显示), 两张截图存证
`docs/provenance/2026-09-29-j2-checkout-service-escrow-empty-box-fix/`——服务订单页截图可见空白框
已消失, 报价卡片下面直接接订单卡片。

`node scripts/lint-kanet.mjs` 0 errors, tree fresh 与 `origin/bshard-m3-deploy` 同步(behind=0)。

等你复核后合。
