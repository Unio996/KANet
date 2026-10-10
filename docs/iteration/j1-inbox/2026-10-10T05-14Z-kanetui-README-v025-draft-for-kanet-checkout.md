# KANet 结账页（测试版 v0.2.5-test）

纯静态网页，在浏览器本地验签、推导订单地址并监视付款，不依赖我们的任何服务器。

页面入口：`checkout-static/checkout.html`（结账页，订单信息由商家生成的链接携带）；`checkout-static/delivery.html`（数字商品取货页，买家凭发票链接取货/到期退款）。

## 请先读这几条

1. **测试版**：版本号带 `-test`，功能与安全性未经公开审计，不应用于大额付款。
2. **没有我们的服务器**：页面只做浏览器本地计算，不向我们的任何服务器发送数据。
3. **主网结账页只连公共节点**：主网订单的链上状态只读取下列公共 Kaspa 节点，页面不接受订单链接指定的节点地址：`sara.kaspa.red`、`nina.kaspa.blue`、`eva.kaspa.green`、`vivi.kaspa.blue`、`isla.kaspa.red`（这些节点的运营方不是 KANet）。
4. **订单凭据**：出单后务必下载订单凭据，凭据丢失将无法退款。
5. **完整性自检**：本 README 末尾附全部 40 个文件（除本 README 外）的 sha256 清单，两个 wasm 另有来源 pin；可自行逐文件核对线上字节。
6. **不是什么**：不是托管服务，不提供退款客服。资金直接进入订单合约地址，按规则自动分账或到期退款，KANet 不经手资金（退款走页面内的到期退款按钮）。
7. **反馈渠道**：请在本仓库的 GitHub Issues 提交。

## 隐私披露

- 打开页面时，你的浏览器会从托管方（GitHub Pages）下载页面文件，GitHub 会按其隐私政策记录访问者 IP；我们看不到也无法关闭这些记录。
- 订单信息在链接的查询串里（`q`、`ch`、`sc` 参数：签名报价引用、渠道地址、签名链），因此会出现在托管方的请求日志里。这些内容不含私钥。
- 页面运行后会直接连上面第 3 点列出的公共节点读取链上状态，节点运营方能看到你的 IP 以及你查询的订单地址。
- 【待 Owner 批准原文】取货页（delivery.html）会向 api.kaspa.org 读取链上数据，请求只含地址；该服务运营方能看到你的 IP 以及你查询的地址。
- 页面自身代码未发现使用 cookie 或浏览器本地存储，也没有统计脚本或第三方脚本。（依据：对页面自身文件的文本搜索，没有 `cookie`/`localStorage`/`indexedDB`；随附的 `kaspa.js` 胶水里有钱包存储接口的绑定，本页未调用，但我们没有逐行通读验证。）

## 版本与来源

- 版本：`checkout-static-v0.2.5-test`（主仓 `Unio996/KANet` 的同名 tag），源 commit `d758bdb1eb99c17f330fc45f952aee971ed9e4fd`。相对 v0.2.4-test 只增加取货页的 6 个文件（delivery.html 与 5 个 delivery-*.js），其余 34 个文件逐字节不变。
- 本仓库第一个提交是 v0.2.4-test 发布包原样内容；v0.2.5-test 在其上追加 6 个新文件（原样自 v0.2.5-test 发布包），README 为包外改动，其余文件未改动。
- 自带说明的第 2 条（br 压缩）已按 GitHub Pages 实测改写。
- v0.2.5-test 发布包 zip 的 sha256：`6ad92207b2030efa7a2726747470064f48b4b458b72a63a6bfeaeff7d1c0133a`（v0.2.4-test 的 zip 为 `d35f1eaa6113f617aca077b9d86249731b0e333d9bd44b2b7c1dd92d66e687e1`）。注意 zip 本身不是字节可复现的（打包时间写入 zip 头），可复现的锚点是 manifest 里每个文件的 sha256。

---

以下为发布包自带的说明（原文，下文提到的"本包"即上述发布包）。

## 这个包里有什么

```
checkout-static/
├── checkout.html              买家打开的页面
├── checkout.js                页面胶水层（解析链接/展示进度/驱动收款+监视+触发流程）
├── verify-core.js             验签/验证链逻辑
├── resolve-order-browser.js   订单地址推导（角色解析）
├── resolve-order-wasm.js      订单地址推导主路径（真 silverc 编译器）
├── order-template.js          订单地址推导备选路径（固定偏移覆写，silverc-wasm 加载失败时自动降级）
├── monitor.js                 订单地址到账状态/确认深度/节点 PMT 只读监视（浏览器直连节点 wss）
├── broadcast-commission.js    触发分账/退款交易组装（零签名，covenant 脚本本身是判据）
├── delivery.html              数字商品取货页（买家凭发票链接取货/退款）
├── delivery-page.js           取货页胶水层（读链接、展示订单、轮询状态、粘贴密文、退款与清扫入口）
├── delivery-buyer.js          取货页买家流程（推导订单地址与派生密钥、读链解密、到期退款、清扫）
├── delivery-crypto.js         取货页密码学（链接片段解析、HKDF 派生、AES-GCM 解密，零依赖）
├── delivery-read.js           取货页读链适配器（api.kaspa.org 只读）
├── delivery-copy.js           取货页全部用户可见文案（单表）
└── vendor/
    ├── kaspa-web/              浏览器版 kaspa-wasm（sha256 见下）
    ├── silverc-wasm/           浏览器版 silverc 编译器（sha256 见下）
    ├── noble-hashes/           vendored blake2b（浏览器原生 ESM 需要，MIT 协议，见目录内 LICENSE）
    ├── qrcode-generator/       扫码付款二维码编码器（MIT，Kazuhiko Arase，未改动上游代码）
    ├── generic-entry-witness-browser.mjs  covenant 签名 witness ABI 编码器（触发分账/退款用）
    ├── tx-mass-ub-browser.mjs  广播前三维 mass 预检
    ├── sil-source/             .sil 合约源码（订单地址推导需要读源码文本）
    └── fee-split-browser.mjs   分成计算逻辑（与仓库内 fee-split.mjs 逐字节同步）
```

**不在这个包里**（如实说明为什么）：
- `config.html`/`config.js`（商家生成签名报价链接的工具）和 `resolver.mjs`（商家侧签名服务）——
  这两者是**商家侧**工具，仍需要一个本机 Node 进程（`resolver.mjs` 监听 `127.0.0.1`，只在本机内网
  可达，私钥仅内存中用一次不落盘）来对商家私钥签名，跟这个包"买家侧纯静态、零后端"的定位不同。
  商家如需生成报价链接，用仓库内 `kasia-console/src/lib/checkout-static/config.html` + 起
  `resolver.mjs` 的既有流程。（⑩：商家侧改成浏览器内 kaspa-wasm 本地签名后会并入下一版发布包。）
- `wasm-pin-check.mjs`、`fee-split-browser-parity.mjs`、
  `vendor/generic-entry-witness-browser-parity.mjs`、`vendor/tx-mass-ub-browser-parity.mjs`——
  仓库内部的开发期自检脚本，买家打开页面时用不到（离开仓库目录结构就是死代码：裸 import
  `kaspa-wasm` + 相对路径指回仓库内其他模块）。

## 取货页（delivery.html）的外部连接

取货页从 `https://api.kaspa.org`（REST，只读）读取订单地址的链上交易，用来找到加密信箱里的交付物；该服务当前对跨域请求放行（响应 CORS 头为 `*`，开发期实测）。读到的只是链上公开数据，请求路径只含地址与链高度，不含任何订单秘密。到期退款、清扫的广播仍走浏览器直连公共节点 wRPC（同 checkout.html）。api.kaspa.org 是单点依赖：不可达时页面提示稍后自动重试，买家也可把商家给的密文粘贴进页面在本机解密。

## 编译器加载失败时怎么办

silverc-wasm 加载失败（网络/浏览器兼容性问题）时，页面会自动降级到固定偏移覆写路径继续完成订单
地址推导（该路径独立验证过），并展示清楚的失败原因 + 三条替代方式（换浏览器重试 / 自行托管这份
发布包 / 自行运行 `resolver.mjs`）——降级路径下触发分账/退款功能不可用（需要真编译器才有
covenant entry ABI）。

## 产物指纹（部署前校验，`checkout.js` 运行时也会自己核对一次 sha256）

| 文件 | sha256 |
|---|---|
| `vendor/kaspa-web/kaspa_bg.wasm` | `732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51` |
| `vendor/silverc-wasm/silverc_lang_bg.wasm` | `868e3f1b247a02b2a2eb39350dfcdd2fe03157c57d99b803b7e9ab2d7bfdc325` |
| `checkout-static/vendor/kaspa-web/kaspa.js` | `d0f14833f2db9c2fb4145a40e68d6221862a667eef15512e1994c02a5e588b04` |
| `checkout-static/vendor/kaspa-web/kaspa.d.ts` | `78628cf0abe112d4103e3c66499e49e12881be1cd24f0953076de55f021e1b5d` |
| `checkout-static/vendor/kaspa-web/LICENSE` | `929edb70a6ba89ae05689d3ee33453fdd63717a9f592038bf3d9420e35b434e6` |
| `checkout-static/vendor/silverc-wasm/silverc_lang.js` | `d67a0977cb97e74f9ed4f2808b29bb1182397aec7267c967528d6af0a535aaf1` |
| `checkout-static/vendor/silverc-wasm/silverc_lang.d.ts` | `f03750534beb4916cef57a070f3f77aee11786eb87042d8ae8fe2431bedfef05` |
| `checkout-static/vendor/silverc-wasm/silverc_lang_bg.wasm.d.ts` | `9cc7c87aff66a4a68bda5f1847bc532d75efc6ce4f10f096a63da318af7c53c1` |

来源、构建命令、goldenSample 同源判据见各自 `vendor/*/README.md`。以上全部指纹(含绑定文件)锚定在
仓库内 `scripts/kaspa-wasm-web-pin.json`/`scripts/silverc-wasm-pin.json`，本发布包由打包脚本
fail-closed 逐个核对过，不匹配不会生成包。

## 部署要求（真实实测，非估算）

1. **`Content-Type: application/wasm`** — 现用代码路径（`fetch()` + `WebAssembly.compile(bytes)`，
   非 `instantiateStreaming`）对这个头不敏感，但仍建议显式配置对，为将来切换到流式编译留余地。
2. 建议托管时开启 br 压缩。网络很差时首次打开的实测：开 br 约 2 分钟，GitHub Pages 约 2.7 分钟，完全不压缩约 6 分钟。
3. **长效不可变缓存**（`Cache-Control: public, max-age=31536000, immutable`）— 两个 wasm 文件用内容
   sha256 锚定，文件不变则可以放心长期缓存；升级版本必须同时改 pin 常量 + 发新文件（不能只换文件
   不改 pin，会被运行时校验拒绝，这是设计如此，不是需要绕过的限制）。
4. **CSP（若宿主环境设置了严格 Content-Security-Policy）**：`script-src` 需要带
   `'wasm-unsafe-eval'`（Chrome 90+/Firefox 79+）以允许 `WebAssembly.compile`/`instantiate`。
5. **必须走 `http(s)://` 托管**，不支持 `file://` 直接双击打开。
6. **下载进度反馈已内置**（本发布包版本）：`checkout.js` 会实时显示"下载中… X.X / Y.Y MB (NN%)"，
   压缩传输下（Content-Length 反映压缩前字节、与解压后收到字节不可比）自动降级为"已收到 X.X MB"
   文案，不会出现进度超 100% 的情况。

## 浏览器直连公共节点（可选，用于查询链上数据；广播交易仍走 `submitTransaction` 走 RPC）

真实测试确认可用、无 CORS 问题、按直连延迟排序：

| 端点 | 直连耗时 | `getServerInfo` 耗时 | 版本 |
|---|---|---|---|
| `wss://sara.kaspa.red/kaspa/mainnet/wrpc/borsh` | 405ms | 189ms | 2.1.0 |
| `wss://nina.kaspa.blue/kaspa/mainnet/wrpc/borsh` | 400ms | 185ms | 2.1.0 |
| `wss://eva.kaspa.green/kaspa/mainnet/wrpc/borsh` | 459ms | 218ms | 2.0.1 |
| `wss://vivi.kaspa.blue/kaspa/mainnet/wrpc/borsh` | 532ms | 249ms | 2.1.0 |
| `wss://isla.kaspa.red/kaspa/mainnet/wrpc/borsh` | 609ms | 294ms | 2.1.0 |

确认不可用（CORS 拦截）：`noah.kaspa.blue`、`sean.kaspa.stream`、`adam.kaspa.green`。

**⚠️ 已知信号，部署前请知悉**：上表 5 个端点的域名命名模式（`<人名>.kaspa.<red/blue/green/stream>`）
提示它们可能来自同一个或一小撮协同的运营方，而不是 5 个互相独立的信任源——如果这个运营方的基础
设施出问题，5 个候选可能同时失效。**建议**：① 把这份清单当加速用的默认候选池，不要当"5 个独立
故障域"意义上的冗余；② 保留 `Resolver` 自动发现作为兜底（这份清单里的端点连不上时才用），不要
因为直连快就完全弃用自动发现；③ 这份清单需要定期人工复核，公开节点的可用性/版本/CORS 配置会变
（`eva.kaspa.green` 当前版本 2.0.1 比其他几个的 2.1.0 略旧）。

## 如实标注的覆盖缺口

- 真 Safari(macOS/iOS)、真 Android/iOS 设备、Telegram/WhatsApp/微信内置浏览器：本轮开发环境是
  Windows 桌面机，没有这些设备/App，未测试，需要有对应设备的人补测。
- 严格 CSP 环境下的实际行为：未起过带 CSP header 的测试服务器验证。
- ⑧d 的耗时数字是单次真实运行，非多轮统计中位数。
- ⑨ 只采样验证了 5 个可用端点，公开节点池可能还有更多未穷举。


## 全部文件 sha256（发布包 manifest，除本 README 外 40 个）

| 文件 | 字节数 | sha256 |
|---|---|---|
| `checkout-static/checkout.html` | 3073 | `f71437e6957d310ebded1a420d895de509994784a575c59ca580386cc66c53a3` |
| `checkout-static/checkout.js` | 55382 | `cb140f8e0256c2714284de3e428bc68fada9cc07a7f5ad03e5b73706ee070533` |
| `checkout-static/verify-core.js` | 4817 | `98dd3f477fa3b176f6063af4419c97c43defa026c3b356b6512fe0fbad12784f` |
| `checkout-static/resolve-order-browser.js` | 9378 | `cb286ed27db0bb8358f6c066d12a2ac206eddd4d2938faa7e2c2f38a4df831c5` |
| `checkout-static/resolve-order-wasm.js` | 7987 | `8b1483d52a7425c4d759613f0f78727dd439398ebe215133cbe750d859582672` |
| `checkout-static/order-template.js` | 12806 | `1c94ad830b51f4a516579939714f9996ad3e1f927172ef97fa8d6ddebdd04323` |
| `checkout-static/monitor.js` | 6995 | `146b69518fac5e73d85dfa31a8cb88ea89661044124c53beb6ba2ec4d2ddb46e` |
| `checkout-static/broadcast-commission.js` | 6565 | `127f48d6b6e5e2f0799dee7a75ee540ee1b856429c383a967c8b92594eca2eca` |
| `checkout-static/broadcast-service-escrow.js` | 5385 | `d7c9ab2b0abb5f7fb9cc4cbd5e96b06a5175da710660a3b616271979199dd217` |
| `checkout-static/order-receipt.js` | 3118 | `8f1f486dda5a13aba02990a62ba6787089766295f48c0c5e9a0f3f0f3a829393` |
| `checkout-static/vendor/fee-split-browser.mjs` | 17917 | `a5737f465b746077eb3f844790e6303e8515c1988190c9dac3e1d94a09be2794` |
| `checkout-static/vendor/generic-entry-witness-browser.mjs` | 7022 | `e65d67a4567a0e433845e2e70e81304e1f0700ef9f02975f199a4e244d7a72b7` |
| `checkout-static/vendor/tx-mass-ub-browser.mjs` | 6910 | `30d80a81cab8f33004a8a24480f0cae0f85a05d15de270146feed320c5a18234` |
| `checkout-static/vendor/qrcode-generator/qrcode.mjs` | 51907 | `ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0` |
| `checkout-static/vendor/qrcode-generator/LICENSE` | 1071 | `3a850fa5f08101db6f40676c2786e10bd2cd5fff7b12ffdf1e0c434d4e49d90c` |
| `checkout-static/vendor/noble-hashes/LICENSE` | 1109 | `4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec` |
| `checkout-static/vendor/noble-hashes/blake2b.js` | 7600 | `6121b81288588c937124d2a85881de2650f5392477f8ec08b45afb65c3f488f1` |
| `checkout-static/vendor/noble-hashes/blake2-internal.js` | 4646 | `19e1238beed57581fb0c78d99d67a3cf5d4ef4411a8b1dd7864feae040ac6388` |
| `checkout-static/vendor/noble-hashes/assert-internal.js` | 1367 | `bd2a0bc5053296f825380b684bdd0d1ee1df149c179cdc53a4442a10838547d8` |
| `checkout-static/vendor/noble-hashes/crypto.js` | 146 | `9211d026c5d21e60e0126dd6f01150d87da5ba7261b8f468215c1264372ff5a5` |
| `checkout-static/vendor/noble-hashes/u64-internal.js` | 2967 | `25a28c13f59b354b981f44c647a35e69df7775fbae5e549d966f7b1d519ea22e` |
| `checkout-static/vendor/noble-hashes/utils.js` | 6003 | `17ab1a3bb1ae013393394f8b0517d1978a2fa0dc0cb443e410c8e70d34f79c0a` |
| `checkout-static/vendor/sil-source/ChannelDeposit.sil` | 2015 | `7333a59c7a615b67faa7570c1d1f283145686e07437ca18d2452c4b12c954a78` |
| `checkout-static/vendor/sil-source/CommissionSplit.sil` | 14571 | `72bc6bf978ca240dcd6714c8c42acea88f8b04cc4026ba8ab3a8725ff49fe83a` |
| `checkout-static/vendor/kaspa-web/README.md` | 2135 | `cd3d6124c9309b3b0e2425c5051cee6ab10bc9ef2db1da23eb986441d2696895` |
| `checkout-static/vendor/silverc-wasm/README.md` | 4317 | `2dce9c00a3e404e3871bc806bf140594bef8fcb6aff8868f0fbf57a83d09a903` |
| `checkout-static/delivery.html` | 1123 | `7f6d269180932a67560673f394de73565eb406b194fb51e23b76f6f7e81b127f` |
| `checkout-static/delivery-page.js` | 7089 | `cca584f5468e17f24799a710ea3dbac0c2744f2083961dab2ff532c7a20fe5a4` |
| `checkout-static/delivery-buyer.js` | 10660 | `7aa51cfdb006814f12b271eec2766b9b0c76406e9ee6d4ee5963f236facb9ed6` |
| `checkout-static/delivery-crypto.js` | 13741 | `5e1e10232f6188d402b98ab65bdfb98b1ef18a8e33ef2d2cb1c00d957ae6db7b` |
| `checkout-static/delivery-read.js` | 4512 | `7254c35c1d91cf63a51dfc835474da8ee074c384b7b923c3eb71e4b7e7c089ac` |
| `checkout-static/delivery-copy.js` | 2553 | `d9d26db73835dee1f9102ce93e8b7ce10735d7c9880796bae4e87c78a2f60781` |
| `checkout-static/vendor/kaspa-web/kaspa.js` | 537625 | `d0f14833f2db9c2fb4145a40e68d6221862a667eef15512e1994c02a5e588b04` |
| `checkout-static/vendor/kaspa-web/kaspa_bg.wasm` | 11467355 | `732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51` |
| `checkout-static/vendor/kaspa-web/kaspa.d.ts` | 285627 | `78628cf0abe112d4103e3c66499e49e12881be1cd24f0953076de55f021e1b5d` |
| `checkout-static/vendor/kaspa-web/LICENSE` | 764 | `929edb70a6ba89ae05689d3ee33453fdd63717a9f592038bf3d9420e35b434e6` |
| `checkout-static/vendor/silverc-wasm/silverc_lang.js` | 38195 | `d67a0977cb97e74f9ed4f2808b29bb1182397aec7267c967528d6af0a535aaf1` |
| `checkout-static/vendor/silverc-wasm/silverc_lang_bg.wasm` | 5346113 | `868e3f1b247a02b2a2eb39350dfcdd2fe03157c57d99b803b7e9ab2d7bfdc325` |
| `checkout-static/vendor/silverc-wasm/silverc_lang.d.ts` | 15094 | `f03750534beb4916cef57a070f3f77aee11786eb87042d8ae8fe2431bedfef05` |
| `checkout-static/vendor/silverc-wasm/silverc_lang_bg.wasm.d.ts` | 7872 | `9cc7c87aff66a4a68bda5f1847bc532d75efc6ce4f10f096a63da318af7c53c1` |
