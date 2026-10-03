# J2 交件（部分）：主网报价页冒烟通过；KTT 三笔等资金合并

派工 (1804)。本件只含不花钱的报价页部分；KTT 铸币/转账尚未执行，原因见 §2。

## 1. 商家建报价页（对主网 console :3202，不花钱）
| 项 | 结果 |
|---|---|
| GET /api/merchant/quote-defaults | network=mainnet，quote_network=mainnet |
| POST /api/merchant/keygen | 200，生成一次性新钥匙（私钥只在脚本内存，未落盘、未写入本件） |
| POST /api/merchant/quote（instant_split，KAS，12.5 KAS，渠道 10%，3 层，收款方=J2 relay 地址） | 200 ok；roles：provider 保底 1,125,125,000 sompi（90.01%）+ 渠道 125,000,000 sompi（10%）；有二维码 |
| 反例：currency=KTT | 400「目前只支持用 KAS 付款」，符合预期 |
| 结账页（checkout.html，本机静态服务，wasm 取自 pin 校验过的 sha256 732bdaa3… 副本） | 浏览器原生验签：商家签名✓；价格 1250000000 sompi；mass 校验✓；要求渠道押金：否；控制台错误 0 |
| 点「确认并推导订单地址」（真 silverc 编译器，零网络请求） | 收款地址 kaspa:prhva9lt2nex5uqlxfcdg9m2mhm5qvg2aes6feq5zs6d0qnrecrzz7wz0q5zn；应付 12.5 KAS；角色金额 provider 12.5000 KAS（无渠道推广时渠道份额并回收款方，符合设计）；截止 2026-10-06T12:56:33Z |
| 付款 | 未付款，实花 0 |
截图（本机，未入库）：scratch/_j2_quote_checkout_20261003.png。
注意：生产检出的 checkout-static/vendor 缺 wasm 二进制（gitignored），本次借用 scratch/_j2_wt_checkout_static 的同 sha256 副本做静态服务；控制台本身不托管结账页（与 (1786) 已知缺口一致）。

## 2. KTT 铸币：卡在资金门槛（零花费）
- 铸币 relay 0044cfbd（KANet-UI）三个 UTXO：0.989 / 0.488 / 0.11995586 KAS，最大 0.989 < 门槛 1.2 KAS（tokens.js:188）。
- 一次 POST /api/ktt/mint（1000003）返回 ok:false 资金 UTXO 不足；无广播。
- 解法：同地址自转 1.25 KAS 合并。我这边工具权限拒绝了该命令（需读 ADMIN_SECRET_FUNDS），Bettor 已升 Owner 终端执行；拿到 txid 后我继续 KTT 三笔。
- 实花合计：0 KAS。
