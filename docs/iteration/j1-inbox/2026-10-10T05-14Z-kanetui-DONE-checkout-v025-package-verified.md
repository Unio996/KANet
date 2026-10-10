# 取货页 v0.2.5-test 打包与核对结果（未打 tag、未发布）

> **Status**: CURRENT · KANet-UI · 2026-10-10 · 派工：Bettor（账本 1890）
> 只打包和核对。没有打 tag、没有推 kanet-checkout、没有改线上任何东西。

## 1. 打包

| 项 | 值 |
|---|---|
| 源 commit | `d758bdb1eb99c17f330fc45f952aee971ed9e4fd`（J2 补取货页 6 文件的合并点） |
| 命令 | `node scripts/build-checkout-release.mjs d758bdb1` |
| zip | `kanet-checkout-static-v1.zip`，6,923,689 字节，**41 个文件**（含 README.md） |
| **zip sha256** | `6ad92207b2030efa7a2726747470064f48b4b458b72a63a6bfeaeff7d1c0133a` |
| 存放 | `kasia-console/scratch/_kanetui_checkout_v025_pkg_20261010/`（zip、manifest、SHA256SUMS.txt、独立解压目录 `x/`；gitignored） |
| 核对脚本 | `scratch/_kanetui_verify_pkg_v025.mjs`、`scratch/_kanetui_pkg_browser_v025.mjs`（gitignored，可重跑） |

zip 不是字节可复现的（同 v0.2.4 的结论），逐文件 sha256 才是锚点；发布请用上面存放的这一份。

## 2. 核对结果（全部通过）

1. 独立解压逐文件对 manifest：**41/41** sha256 + 字节数一致，解压目录没有 manifest 之外的文件。
2. 仓库内文件对 `git show d758bdb1:<path>`：**32/32** 逐字节一致。
3. wasm：`kaspa_bg.wasm` = pin `732bdaa3…`，`silverc_lang_bg.wasm` = pin `868e3f1b…`；6 个绑定文件全部对 pin；`checkout.js` 里硬编码的两个 wasm sha 与 pin 一致。
4. **对 v0.2.4-test 的差异**：`~README.md` 加 6 个新文件（`delivery.html`、`delivery-page.js`、`delivery-buyer.js`、`delivery-crypto.js`、`delivery-read.js`、`delivery-copy.js`）。**`checkout.js`、`monitor.js` 等其余 34 个文件与 v0.2.4-test 逐字节相同，无需列出的额外差异。**
5. 外部地址扫描（排除 .wasm 二进制）：相对 v0.2.4 **新增的只有 `api.kaspa.org`**（`delivery-read.js`），其余与 v0.2.4 相同（5 个主网公共节点 + 注释/许可证里的文档链接）。新增 6 个文件里：无 `<script src>` 外链（只有 `./delivery-page.js` 同源）、无 `XMLHttpRequest`/`sendBeacon`/cookie/`localStorage`/`sessionStorage`/`indexedDB`；`fetch` 只有同源的 `./vendor/...` 与 `delivery-read.js` 的 api.kaspa.org。`delivery.html` 带 `<meta name="referrer" content="no-referrer">`。
6. 代码层读到的设计点（读过 `delivery-page.js`/`delivery-buyer.js`/`delivery-crypto.js` 相关段，不是通读全部）：nonce 和截止时间在 URL 片段（`#n=…&dl=…`）里，读后立即 `history.replaceState` 抹掉，片段本来就不会发给托管方；主网忽略 `?api=` 与 `?rpcUrl=`，只用 `https://api.kaspa.org` 与公共节点池。

## 3. 真 Chrome 验收（只读，不付款不广播）

解压目录起本机静态服务，用一次性随机密钥签的**主网**报价，分别带恶意 `?rpcUrl=ws://evil.example:17110`（delivery 还带 `&api=http://evil.example:9`）打开：

- **delivery.html**：标题「数字商品取货」；页面推导出订单地址、应付 10.4 KAS（含 max_split_fee）、截止时间，状态「等待付款…」；凭据下载、粘贴解密、退款、清扫四块都渲染；地址栏的 `#n=…&dl=…` 加载后已被抹掉（`hash=""`）。外连 host **只有 `api.kaspa.org`**（4 个请求：订单地址和信箱地址各一次 `…/full-transactions`，两次 `…/info/virtual-chain-blue-score`，路径里只有地址）；**没有任何请求含 nonce（任意连续 ≥8 位 hex 子串扫描）**；没有 evil host 请求；cookie 为空、localStorage 无键。
- **checkout.html**：报价验签通过，填随机退款地址点「确认并推导订单地址」，监控连上；外连 host **只有 `sara.kaspa.red`**；没有 evil host 请求；cookie 为空、localStorage 无键。
- 我的脚本里「evil 请求」一项报 true，是误报：它匹配了页面自身 URL（查询串里带 evil.example），不是外发请求；以上「外连 host」两行才是依据。

**没测的**：取货页的真实取货（需要真有交付物的信箱）、到期退款与清扫（要广播，按派工不做）。这两条路径只验证了页面渲染和按钮存在，没有在真浏览器里点过。

## 4. kanet-checkout 的 README 增量（已备好，未推送）

草稿：`2026-10-10T05-14Z-kanetui-README-v025-draft-for-kanet-checkout.md`（同目录；就是将来替换 kanet-checkout 根 README.md 的整份文件）。相对线上现行 README 的改动：

- 标题和版本改为 v0.2.5-test，源 commit `d758bdb1…`，说明只增 6 个取货页文件、其余 34 个文件逐字节不变，写入新 zip sha256 并保留 v0.2.4 的 zip sha；页面入口加 `delivery.html`。
- sha 清单从 34 行扩为 40 行（除本 README）；包内说明树和「取货页的外部连接」一节随包带入；已批准的 br 部署要求原文保留。
- **隐私披露里 api.kaspa.org 一条是占位**：`【待 Owner 批准原文】取货页（delivery.html）会向 api.kaspa.org 读取链上数据，请求只含地址；该服务运营方能看到你的 IP 以及你查询的地址。`——括号前缀要等 Owner 批了原文再去掉/替换。
- 提醒：「请先读这几条」第 3 条「主网结账页只连公共节点」目前只描述结账页；取货页还会连 api.kaspa.org，Owner 批准的这条原文是否要随之补充，请你一并带给 Owner。我没动。
- 发布时的做法（待派工）：kanet-checkout 里先提交 6 个新文件原样内容（对 manifest 逐文件核对），再单独一个提交替换 README；仍然 `core.autocrlf=false`。

## 5. 另一个观察

`delivery.html` 的静态 `<title>` 在这个包里已是「数字商品取货」（不是「(占位)」），页面运行后由 `delivery-copy.js` 的 `COPY.title` 再设置同名标题；我没追踪是谁、哪个提交改的，只报告包内现状。
