# J2 → 接位者 · STATUS：结账页 ServiceEscrow 支持进行中(Owner 令会话重启前的快照)

**分支**: `coord/j2-service-escrow-design-20260928`(worktree `D:\kanet-tn12\scratch\_j2_wt_service_escrow_design`)。
**最后已推 commit**: `9b0e02e5`(control 签名路径本体, 已合并等待/已 Bettor 批)。

## 架构决策(已跟 Bettor 确认, 2026-09-29 会话重启前敲定, 未落码前先记下来防丢)

结账页(`kasia-console/src/lib/checkout-static/`)现有 CommissionSplit 订单是靠浏览器端真实
silverc-wasm 编译器现场编译推导地址/redeem script(报价 `q=` 参数只带原始 ctor 参数, 不带算好的
产物)。**ServiceEscrow 订单走不同的、更轻的路径**：不复刻这套"浏览器现场编译"管线(那样要把
ServiceEscrow.sil 也 vendor 进 checkout-static + 写一个 `RW.deriveServiceEscrowOrderAddress`
等价物, 工作量大、也不是"最小改动")——而是**服务端(`/api/service-escrow/quote`)预算好整份产物,
链接直接嵌完整数据**(redeemScriptHex/entries 的 dispatch_tag/deadlineDaa/timeoutBuyerBps/
maxRefundFeeSompi/providerPayoutSpk/buyerRefundSpk), 页面收到就能用, 不用现查/现算, 不碰
silverc-wasm。这跟 buyer_confirm/provider_cancel 的"服务端算, 页面不重算"纪律一致。

## 已完成(未提交)

1. `kasia-console/src/lib/checkout-static/monitor.js`: 新增 `getCurrentDaaScore(rpc)`(对应既有
   `getCurrentPmtMs`, ServiceEscrow.timeout_default 的到期判据是 `tx.daa` 不是 PMT, 见 D-034 §9
   建议-4)。
2. 新文件 `kasia-console/src/lib/checkout-static/broadcast-service-escrow.js`: 逐字照抄
   `broadcast-commission.js::buildCommissionRefundTx` 的骨架, 写了 `buildServiceEscrowTimeoutDefaultTx`
   (零签名, 两输出精确金额, lockTime 用订单自己的 deadlineDaa 不用现查值, 同 relay 侧
   `unlockServiceEscrowTimeoutDefault` 头注那条施工期纪律)+ `computeTimeoutSplit`(逐字对应
   `commission-plan-sdk.mjs` 同名函数, 设计稿 v0.2 建议-5"三处同式"的第三处)。**尚未跑过任何测试**
   (刚写完就被会话重启打断)。

## 还没做(下一步, 按顺序)

1. **`checkout.js` 加 order_kind 分支**：目前 `main()` 无条件走 CommissionSplit 推导流程(第
   386-488 行)。需要在 quote 解析后判 `quote.order_kind === 'service_escrow'`——是则跳过
   `resolveRulesForOrder`/`RW.deriveCommissionOrderAddress`/退款地址输入框那一整段(ServiceEscrow
   订单在建单时买家/服务方身份已经定死, 不需要买家在结账时临时填退款地址), 直接用
   `quote.service_escrow` 里已经算好的字段渲染订单信息(地址/应付总额/截止 DAA)+ 收款二维码(复用
   `renderQrSvg`/`buildKaspaPaymentUri`, 逻辑相同)+ 一段静态提示文字"确认/取消请在 KANet 控制台
   操作"(不需要按钮, buyer_confirm/provider_cancel 走 console API 不在这个页面做)+ 一个"到期退款"
   按钮(零签名, 用 `getCurrentDaaScore`+`buildServiceEscrowTimeoutDefaultTx`, 跟现有
   `triggerBroadcast('refund', ...)` 同样的 mass 预检+广播+轮询模式, 但判据是 DAA 不是 PMT)。
2. **`/api/service-escrow/quote`(`kasia-console/src/api/service-escrow.js`)要补一个"生成可分享
   链接"的能力**——目前这个端点只返回 JSON(给自动化/后端调用方用), 没有产出`checkout.html?q=...`
   这种可分享链接。需要把返回的字段编码成 base64 塞进 `q=` 参数(同 CommissionSplit 订单当前的
   `atob(quoteRef)` 解析方式), 外加 `order_kind:'service_escrow'` 标记字段。
   🔴 **待定点(需要跟 Bettor / NWT 确认, 我还没问)**: CommissionSplit 的 quote 走
   `verifyQuoteSignature`(商家签名验证), ServiceEscrow 的 quote 要不要走同一套签名机制？
   现在 `/api/service-escrow/quote` 端点完全没有签名——如果链接内容被篡改(比如收款地址被换成
   攻击者的), 页面会照单全收展示。CommissionSplit 场景下这条由 `signQuote`/`verifyQuoteSignature`
   兜底, ServiceEscrow 场景目前没有对应机制。这不是"最小改动"范围内能顺手做的(涉及谁来签、私钥在哪),
   建议先问清楚再动, 或者 V1 明确标注"链接内容未签名, 结账前请通过可信渠道核对收款地址"这类免责声明
   作为临时权宜。
3. 写完后要跑真实测试(同合约/relay 那两层的纪律: 真 simnet 广播, 不只是本地断言)——需要一个真实的
   ServiceEscrow 订单(用现有 `test_service_escrow_v2.mjs`/`test_relay_handlers_direct.mjs` 的构造
   模式)+ 一个真实浏览器环境(Playwright, 这个仓库已有先例, 见 checkout-static 其他真机测试)跑一次
   到期退款按钮点击 → 真实广播 → 到账验证。

## 接位提醒

M0a manifest/CONTROLLED_FUNNEL_ALLOWLIST 那道闸(`MRC-service-escrow-console-sign`)已经落地在
`9381c887`/`9b0e02e5` 里, 不用重做。这次结账页改动(纯前端 checkout-static, 不 import
relay-manager.js)不会触发 M0a。

停在这里, 等会话恢复后继续按上面顺序做。
