# J2 交件：结账页订单凭据（Bettor 2026-10-01 派工，Owner 亲批「修」）

- 分支 `coord/j2-checkout-order-receipt-20261001`，worktree `scratch/_j2_wt_order_receipt`，代码提交见本文件所在提交的上一笔 `1291317c`。
- 改动与证据全文：`docs/provenance/2026-10-01-j2-checkout-order-receipt/README.md`。

## 四项要求对照
1. 拆出单/重建：`rebuildCommissionOrderAddress`（wasm 主路径与降级路径各一）必须传 `orderNonceHex`(32 hex)+`deadlineMs`，缺参/非法抛错；内部不调随机数、不用 Date.now()。复用现成：沿用既有 `orderNonceHex` 返回值与 SDK 同款传参，未另起新构造逻辑。
2. 出单后醒目展示 nonce/截止时间/订单地址，红框"不保存就无法退款"，按钮"下载订单凭据(JSON)"（含报价链接原文、退款地址、nonce、截止、地址、网络）。
3. 页面新增"导入凭据并重建订单"：校验类型/版本/网络/链接(q、ch、sc)，重建地址与凭据地址逐字一致才启动订单监控（分账/到期退款按钮）；不一致即拒，页面无按钮。
4. 新文件 `order-receipt.js` 已补入 `scripts/build-checkout-release.mjs` RUNTIME_FILES。

## 验收
- ① 干净子进程（随机数与 Date.now 毒化）按凭据重建：地址与赎回脚本字节逐字一致，12/12。
- ② 真 Chromium + 真 simnet：出单→下载→关页→新页导入→同一地址→到期退款真广播，退款地址收到 ≈4.99 KAS；9 个反例（篡改 nonce/deadline/地址/退款地址、缺 nonce、缺 deadline、错链接、错网络、错类型）全部被拒且无按钮。32/32。
- ③ 回归：KANet-UI 既有五场景 ALL PASS；三方分账（channelSpks 修复）10/10。lint-kanet 0 error。

## 需要 Bettor 知道的
- 本机 simnet 的 funders 余额有限（9.9–46 KAS），回归时重映射了 funder 编号，不影响被测逻辑；测试用的矿工已自行结束，静态服务器已停。
- ServiceEscrow 订单分支在 main() 早 return、本次未改其代码，未单独重跑其 provenance 用例。
- 凭据 JSON 含退款地址与订单地址（公开信息），不含私钥；用户须自行保管，页面已明示。
- 订单#1 本身的 nonce 已丢，本修复不能挽回它（账本 1778），只防以后。
- 本分支未合并、未动生产检出、未改 env、未花主网钱。
