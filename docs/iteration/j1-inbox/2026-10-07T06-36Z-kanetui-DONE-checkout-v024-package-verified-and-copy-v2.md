# 结账页 v0.2.4-test 打包与核对结果 + 对外文案 v2（待 Owner 批）

> **Status**: CURRENT · KANet-UI · 2026-10-07 · 派工：Bettor（账本 1872 之后）
> 未打 tag、未发 release、未开 Pages、未发布任何内容。这三件等 Owner 批 Pages 后一起做。

## 1. 打包

| 项 | 值 |
|---|---|
| 源 commit | `fe37797ec0cb8b7bbc91216ba1114309b1f0075f`（`origin/bshard-m3-deploy` 上的账本 1872 合并） |
| 命令 | `node scripts/build-checkout-release.mjs fe37797e` |
| zip | `kanet-checkout-static-v1.zip`，6,905,054 字节，35 个文件（含 README.md） |
| **zip sha256** | `d35f1eaa6113f617aca077b9d86249731b0e333d9bd44b2b7c1dd92d66e687e1` |
| 存放 | `kasia-console/scratch/_kanetui_checkout_v024_pkg_20261007/`（zip、manifest.json、SHA256SUMS.txt、独立解压目录 `x/`；scratch 为 gitignored） |
| 核对脚本 | `scratch/_kanetui_verify_pkg_v024.mjs`（gitignored，可重跑） |

## 2. 核对结果（全部通过）

1. **zip sha256**：`sha256sum -c` OK。
2. **独立解压逐文件对 manifest**：35/35 的 sha256 与字节数一致；解压目录没有 manifest 之外的文件。
3. **仓库内文件逐字节同源**：26 个来自仓库的文件，对 `git show fe37797e:<path>` 全部一致。
4. **wasm/绑定对 pin**：`kaspa_bg.wasm` = `732bdaa3…`、`silverc_lang_bg.wasm` = `868e3f1b…`，6 个绑定文件全部对 `scripts/*-pin.json`；`checkout.js` 里硬编码的两个 wasm sha 与 pin 一致。
5. **对 v0.2.3 的差异**：只有 3 个文件不同——`README.md`、`checkout-static/checkout.js`（`cb140f8e…0533`）、`checkout-static/monitor.js`（`146b6951…b46e`）。其余 32 个逐字节与 v0.2.3 相同。
6. **外部依赖扫描**（排除 .wasm 二进制，全文 grep URL 与网络 API）：
   - 运行时会连的外部地址只有 `monitor.js` 里的 5 个主网公共节点（`sara.kaspa.red`、`nina.kaspa.blue`、`eva.kaspa.green`、`vivi.kaspa.blue`、`isla.kaspa.red`）。
   - 其他 URL 全是注释、许可证文本、文档链接或 XML 命名空间字符串：`github.com`/`docs.rs`（kaspa.js 注释）、`paulmillr.com`（LICENSE）、`bugzil.la`（utils.js 注释）、`www.w3.org`（二维码 SVG 命名空间）、`d-project.com`/`opensource.org`/`denso-wave.com`（qrcode 注释与许可）。
   - 页面自己的 `fetch()` 只有两处：`./vendor/...` 的 wasm 与 `./vendor/sil-source/CommissionSplit.sil`（同源相对路径）。`kaspa.js` 的 `fetch`/`WebSocket` 是 wasm-bindgen 胶水，WebSocket 目标就是上面的节点（或 simnet/testnet 的 `?rpcUrl=`）。
   - 无 `<script src>` 外链、无 `<link href>`、无 `@import`、无 CDN、无字体、无统计脚本、无 `sendBeacon`/`XMLHttpRequest`。
   - 我只读了 URL 命中行与网络 API 命中行，没有逐行审读 `kaspa.js` 的 1.5 万行胶水；"无其他外联"的依据是 grep，不是通读。

## 3. 一个要纠正我方案的发现：zip 本身不是字节可复现的

我对同一 commit 重跑了一遍打包：35 个文件的内容 sha256 **全部相同**，但 **zip 的 sha256 不同**（`d35f1eaa…` vs `4420c88c…`，字节数都是 6,905,054）。原因是 `build-checkout-release.mjs` 的 `dosDateTime()` 把**打包时刻**写进了 zip 头。

含义：
- 方案 §2-1 写的"重新打包后 zip sha256 必须等于 §0 的值"**不成立**，已被这次实测推翻。真正可复现、可核的锚点是 **manifest 里 35 个文件的逐文件 sha256**；zip sha256 只能锚定"这一份具体的 zip 文件"。
- 发布线上文件时本来就是逐文件核（方案 §2-7），不受影响。
- 如果要让 zip 也可复现，需要改打包脚本（固定 DOS 时间戳）。这是代码改动，我没动；是否做由 Bettor 定。
- 发布用的 zip 请以本文 §1 存放的这一份为准；若要重打包，须按"35 个文件逐个对 manifest"验收，不要比 zip sha。

## 4. 对外文案 v2（须 Owner 批；未批不得出现在任何公开位置）

相对 PLAN 草稿 §3 的变化：加入"主网结账页只连公共节点"，并把隐私披露并入文案；版本号改 v0.2.4-test。

**仓库描述（一行）**
> KANet 结账页（测试版 v0.2.4-test）：纯静态网页，在浏览器本地验签、推导订单地址并监视付款，不依赖我们的任何服务器。

**文案要点（逐条，Owner 可改）**
1. **测试版**：版本号带 `-test`，功能与安全性未经公开审计，不应用于大额付款。
2. **没有我们的服务器**：页面只做浏览器本地计算，不向我们的任何服务器发送数据。
3. **主网结账页只连公共节点**：主网订单的链上状态只读取下列公共 Kaspa 节点，页面不接受订单链接指定的节点地址：`sara.kaspa.red`、`nina.kaspa.blue`、`eva.kaspa.green`、`vivi.kaspa.blue`、`isla.kaspa.red`（这些节点的运营方不是 KANet）。
4. **订单凭据**：出单后务必下载订单凭据，凭据丢失将无法退款。
5. **完整性自检**：附每个文件的 sha256 清单与两个 wasm 的 sha256，说明如何自行核对。
6. **不是什么**：不是托管服务，不保管用户资金，不提供退款客服（退款走页面内的到期退款按钮）。
7. **反馈渠道**：只写 Owner 指定的渠道。

**隐私披露（与上面一并展示）**
- 打开页面时，你的浏览器会从托管方（GitHub Pages）下载页面文件，GitHub 会按其隐私政策记录访问者 IP；我们看不到也无法关闭这些记录。
- 订单信息在链接的查询串里（`q`、`ch`、`sc` 参数：签名报价引用、渠道地址、签名链），因此会出现在托管方的请求日志里。这些内容不含私钥。
- 页面运行后会直接连上面第 3 点列出的公共节点读取链上状态，节点运营方能看到你的 IP 以及你查询的订单地址。
- 页面自身代码不使用 cookie 或浏览器本地存储，也没有统计脚本或第三方脚本。（依据 grep：页面自身文件无 `cookie`/`localStorage`/`indexedDB`；`kaspa.js` 胶水里有钱包存储接口的绑定，本页未调用，我没有通读验证。文案若要写成绝对的"不使用"，请 Owner/NWT 知悉这个依据强度。）

## 5. 没做的事

没有打 tag、没有建 GitHub Release、没有创建仓库、没有开 Pages、没有推发布内容；没有核线上字节（线上不存在）；没有改打包脚本；真浏览器 e2e 反例仍是 Bettor 记的票，未做。
