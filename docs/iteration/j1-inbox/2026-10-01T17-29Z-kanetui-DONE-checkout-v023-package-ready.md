# KANet-UI 交付：checkout-static v0.2.3-test 打包 + 全新目录订单凭据回归（等你"发"）

## ① 合并
- 生产检出 bshard-m3-deploy，fetch 后与 origin 同步、无已跟踪改动；`git merge --no-ff coord/j2-checkout-order-receipt-20261001`（头 23d5abce）。
- **merge commit = `9a0cb4d6135840694095df389a78625311a26cf5`**，已推 origin（208e559d..9a0cb4d6）。生产检出只做 merge，未编辑文件。

## ② 打包（从 9a0cb4d6）
```
commit     = 9a0cb4d6135840694095df389a78625311a26cf5
zip sha256 = 1f10df6e5fa913f3d7d5a82135c2f40b16a6b78d80ef2c32cde775c920785ad0
zip bytes  = 6904577
文件数     = 35（v0.2.2 为 34，多出 order-receipt.js；清单已含，zip 内 checkout-static/order-receipt.js 在）
```
两份 wasm + 全部绑定文件 sha256 对该 commit 的 pin 文件 fail-closed 核对通过。

## ③ 全新目录真浏览器（simnet，零主网花费）
zip 解到全新目录，独立静态服务器(8996)托管，复用 J2 的 e2e_receipt.mjs（原样，只改 BASE/OUT 环境变量）：**32 PASS / 0 FAIL**。
- 出单 → 凭据面板出现（含"不保存就无法退款"、nonce 32hex、截止时间）→ 下载凭据 → 关页 → 新页导入 → 重建出**同一订单地址**、显示"逐字一致" → 到期退款按钮出现 → 真广播 → 页面"订单已完成" → 退款地址真收到≈4.99 KAS；两页零 console 错误。
- 反例 9 个全拒且不放出按钮：改 nonce / 改 deadline / 改地址 / 改退款地址 / 缺 nonce / 缺 deadline / 错链接 / 错网络 / 错类型。"改 nonce 的凭据须被拒"满足。
- 未重跑 KANet-UI 既有五场景与三方分账（J2 交件已附 ALL PASS 日志，本次按派工只测凭据流）。

## 其他
- 为让 simnet 出块我重起了矿工（约 90 分钟时长），测完已停；静态服务器已停。
- 现场：`kasia-console/scratch/_kanetui_checkout_v023_test_20261002/`（zip、manifest、e2e_run.log、凭据样本）。
- 未做 GitHub Release；等你核对回"发"。release 说明我会写"出单后务必下载订单凭据"。
