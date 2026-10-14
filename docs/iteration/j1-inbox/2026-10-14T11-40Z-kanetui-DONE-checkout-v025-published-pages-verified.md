# 结账页 + 取货页 v0.2.5-test 已发布到 Pages，线上核对通过

> **Status**: CURRENT · KANet-UI · 2026-10-14 · 派工：Bettor（Owner 10-14 批 README 两段原文）
> 全部时间为 UTC，date -u 核过。

## 1. 发布结果

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Unio996/kanet-checkout （public） |
| Pages | https://unio996.github.io/kanet-checkout/ ；结账页 `checkout-static/checkout.html`，取货页 `checkout-static/delivery.html` |
| 提交 `05e70f7` | 追加取货页 6 个文件（`delivery.html`、`delivery-page.js`、`delivery-buyer.js`、`delivery-crypto.js`、`delivery-read.js`、`delivery-copy.js`），内容原样来自已核过的 v0.2.5-test 包；其余 34 个文件不动 |
| 提交 `fa2f757` | 只替换 `README.md`（包外改动）：Owner 批准的第 3 点与隐私段原文，版本改 v0.2.5-test，sha 清单扩到 40 个文件 |
| 历史 | 新提交叠在 `5676ab1` 之上，没有改写历史 |
| 主仓 tag | `checkout-static-v0.2.5-test` → `d758bdb1eb99c17f330fc45f952aee971ed9e4fd`，已推到 `Unio996/KANet` |
| 发布包 zip | 存的那份，sha256 `6ad92207b2030efa7a2726747470064f48b4b458b72a63a6bfeaeff7d1c0133a`，未重打包 |

两段原文逐字使用（第 3 点里的「…」处填入草稿里的 5 个节点列表原样，并去掉旧句末的括号，因为批准原文已含「这些服务的运营方都不是 KANet」）：

- 第 3 点：「**只连公共服务**：主网结账页只读取下列公共 Kaspa 节点：`sara.kaspa.red`、`nina.kaspa.blue`、`eva.kaspa.green`、`vivi.kaspa.blue`、`isla.kaspa.red`；取货页另外从 `api.kaspa.org` 读取链上交易。页面不接受订单链接指定的其他地址，这些服务的运营方都不是 KANet。」
- 隐私段（替换了「【待 Owner 批准原文】」占位）：「取货页会从 api.kaspa.org（Kaspa 公共区块浏览器接口，运营方不是 KANet）读取链上交易，该服务能看到你的 IP 和所查询的订单地址。取货页同样不使用 cookie 和浏览器本地存储。」

提交前先核：提交内 40 个文件的 blob 逐个对 manifest，40/40 一致（`core.autocrlf=false`，避免上次的 CRLF 问题）。

## 2. 一处要说明

动手时账本里还没有这次「Owner 10-14 批 README 两段」的记录（最新是 1897）。我按你的派工和原文执行了，请你补记账本。

## 3. 线上核对

脚本 `scratch/_kanetui_verify_live_v025.mjs`（取原始字节）：

- 41 个路径逐个 GET：除 README 外 **40/40 的 sha256 与字节数 = manifest**，含 `delivery.html`。
- README：用 `gh api repos/Unio996/kanet-checkout/contents/README.md` 取，sha256 `e4591a5b…`，17,993 字节，= 本地提交版；Pages 上的 README 也一致。
- 两个 wasm 对 pin（`732bdaa3…`、`868e3f1b…`），`application/wasm`。
- `RESULT ALL OK`。

真 Chrome（只读，不付款不广播；一次性随机密钥签的主网报价，带恶意 `?rpcUrl=ws://evil.example:17110` 和 `&api=http://evil.example:9`）：

- **取货页无 `#n=`、无 `q`**：标题「数字商品取货」，页面显示「链接里没有订单凭据，请用商家发给你的完整链接打开。」，没有报错。
- **取货页带订单**：渲染订单地址、应付 10.4 KAS、截止时间，状态「等待付款…」；`#n=…&dl=…` 加载后已从地址栏抹掉；外连 host 只有 `api.kaspa.org`（订单与信箱地址各一次 `full-transactions`，加两次 `virtual-chain-blue-score`）；没有 evil host；任何请求都不含 nonce（≥8 位 hex 子串扫描）；cookie 为空，localStorage 无键。
- **结账页**：验签并推导通过；外连 host 只有 `sara.kaspa.red`；没有 evil host，`?rpcUrl=` 仍被忽略；cookie 为空，localStorage 无键。
- 脚本里「evil 请求: true」是误报：它匹配的是页面自身 URL（查询串里带 evil.example），不是外发请求。

## 4. 这台机器的一个测试环境说明

在这台机器上，浏览器看到的 HTTPS 证书签发方是 **「NordVPN S.A. -ThreatProtection」**（本机有 TLS 拦截）。它会往页面里注入几条请求，发往 `unio996.github.io` 根下的一串随机长路径（脚本、样式、HEAD/204 检查）。依据：服务端原始 HTML 只有 1 个 `<script>`（用 curl 和浏览器 request API 都核过），DOM 里的页面脚本也只有 `delivery-page.js`；同样的页面在本机 http 服务（无 TLS 拦截）上没有这些请求。所以这些请求不是页面发的，也不是 Pages 注入的，是本机安全软件造成的，只影响本机的测试读数，不影响真实访客。我上面报的外连 host 以页面自身发出的请求为准。

## 5. 没做 / 未改

没有建 Release；没有改 Pages 设置（仍是 main/root）；没有改打包脚本；没有重打包；真实取货、到期退款、清扫三条路径没有在真浏览器里点（会广播）。
