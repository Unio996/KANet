# J2 交件：KTT 指定数量铸币（第一步）+ 商家建报价页面（第三步）

分支 `coord/j2-ktt-mint-amount-20261002`（worktree `scratch/_j2_wt_ktt_mint`）。第二步设计稿另交。

## 第一步（0287a77d，Bettor 已审零 MUST，账本 1785）
- `/api/ktt/mint` 加 `amount`（整数字符串/BigInt/≤2^53-1，顺带关 Codex R11 ②）；代币 UTXO 只锁 0.7 KAS，其余找零；relay mint 支持找零 + mass-aware 手续费；transfer 的 State 数量与 KAS 面值解耦。
- 真 simnet：铸 1,000,003 与 2^53-1 KTT，mint→transfer→再转，多 1 被共识拒。详见 `docs/provenance/2026-10-02-j2-ktt-mint-amount/README.md`。

## 第三步（本次提交）
- 控制台新页 `/merchant/quote`（侧边栏“商家建报价”）+ `POST /api/merchant/quote` 等三个端点（`api/merchant-quote.js`）。
- 复用：即时分账 = config.js 同款报价组装 + `signQuote`；服务订单 = 内部调既有 `/api/service-escrow/quote`；金额拆分 `feeSplit`；地址/网络 `kaspa-network.mjs`；二维码 = 结账页同款。无新表、无新 relay 命令、不碰链。
- 支付币种下拉预留，KTT 置灰；API 层非 KAS 直接 400。
- 验收：真 Chromium + 真结账页，建两种报价→打开链接→验签通过、金额比例对，反例全拒，28/28；路由级单测全绿；lint 0 error。证据 `docs/provenance/2026-10-02-j2-merchant-quote-page/`。

## 请 Bettor 注意
1. 私钥经本机 API 传入（同 service-escrow/quote、resolver /sign-quote 先例），不落库不记日志；页面提供“生成新钥匙”。比浏览器本地签名（⑩）弱，沿用已知票。
2. 结账页网址由商家填（或 env `CHECKOUT_BASE_URL`），控制台不托管结账页。
3. 服务订单 V1 的确认/取消仍靠专用托管 relay 代签；签名钥匙不是它时页面会警告。
4. 验收用的是最小控制台（真路由+真模板），不是整个 console；页头两个 `/api/system/*` 轮询在其中 404，属测试夹具缺端点。
5. 本机 npm install 产生的 node_modules 在 worktree 内（gitignored），已按 (1785) 规矩删除过指向生产的 junction。
