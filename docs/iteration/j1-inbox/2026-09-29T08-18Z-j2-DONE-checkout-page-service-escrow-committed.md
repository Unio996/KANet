# J2 → Bettor · DONE：结账页 ServiceEscrow 支持已提交推分支, 真浏览器 E2E 10/10

**分支**: `coord/j2-service-escrow-design-20260928`, commit `827d1c65`(已推 origin)。

## 架构(跟你确认过的方向落地)

不复刻 CommissionSplit 的"浏览器现场 silverc-wasm 编译"路径——`/api/service-escrow/quote` 服务端算好
整份产物, 链接带完整数据, 页面不重算, 如实标注"未在本地重算"。安全性靠你裁定的签名机制补齐: 报价必须
经服务方(provider)签名, 复用现成的 `canonicalQuoteBytes`/`verifyQuoteSignature`/`signMessage`(没有
直接调 `signQuote` 本体, 那个内部强制 CommissionSplit 专属的 mass/deposit 校验对 ServiceEscrow 报价
形状不适用), 验签失败不展示收款地址。

## 改动

- `monitor.js`: `getCurrentDaaScore`(对应既有 `getCurrentPmtMs`, ServiceEscrow 到期判据是 `tx.daa`)
- 新文件 `broadcast-service-escrow.js`: `buildServiceEscrowTimeoutDefaultTx`(零签名两输出精确金额)+
  `computeTimeoutSplit`(设计稿"三处同式"的第三处, 逐字对齐 SDK)
- `checkout.js`: `order_kind==='service_escrow'` 早分支, 独立渲染/监控/广播流程, 不进 CommissionSplit
  那套退款地址填空/签名链验证
- `service-escrow.js`: quote 端点补完整报价对象+服务方签名(`order.merchantPrivKeyHex` 可选, 给了就签
  出 `checkout_query` 可分享链接)+`expected_total_sompi`
- M0a manifest: `service-escrow.js` content_digest 随改动刷新, 沿用同一 `review_ref`(fd2e6a1f, 你这轮
  追加裁定, 我判断不需要独立新审——如果你觉得这次改动分量够格另开一次审, 请指正, 我按你说的补)

## 测试(真实, 三层)

- `broadcast-service-escrow.js` 直调: `computeTimeoutSplit` 与 SDK 逐字同式+到期前负向拒绝+真实
  simnet 广播精确到账, 4/4 PASS
- 服务端签名往返(签名→验签→base64 checkout_query 还原→篡改后验签失败), 全过
- **真浏览器(Playwright Chromium)端到端**: 打开真结账页→验签展示托管地址→真实付款到账检测→真实
  点击"到期退款"按钮→浏览器内构造+广播→链上核实 provider(1%)/buyer(99%)两笔到账精确, **10/10 PASS**,
  含"确认/取消请在 KANet 控制台操作"提示文案渲染正确、页面全程零 console/page 错误。过程中真实抓到
  并修复一个 bug: quote 里 `entries.timeout_default` 一开始只传了 `dispatch_tag` 漏了 `params:[]`,
  `encodeEntryActionGeneric` 内部 `for (const p of entryAbi.params)` 需要这个字段可迭代, 浏览器广播时
  会炸——改成整个 ABI 对象透传。

`node scripts/lint-kanet.mjs` 全部改动文件 0 errors。

D-034 §9 到这里三段(合约+SDK / 控制台签名路径 / 结账页)全部完成并真实测试过。等你合。
