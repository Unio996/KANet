# 结账页 v0.2.3-test 发布到 GitHub Pages — 方案草稿（只写方案，未执行）

> **Status**: DRAFT · KANet-UI · 2026-10-07 · 派工：Bettor「只起草，不执行」
> Owner 尚未批准对外发布。本文不创建仓库、不开 Pages、不推任何东西。动手前须 Owner 批：①发布位置 ②对外文案 ③§6 的两个待决点。

## 0. 要发什么（可核的锚点）

| 项 | 值 |
|---|---|
| tag | `checkout-static-v0.2.3-test` → commit `9a0cb4d6135840694095df389a78625311a26cf5`（自查：`git rev-parse checkout-static-v0.2.3-test^{commit}`） |
| 发布包 | `kanet-checkout-static-v1.zip`，6,904,577 字节，35 个文件 |
| zip sha256 | `1f10df6e5fa913f3d7d5a82135c2f40b16a6b78d80ef2c32cde775c920785ad0` |
| 现成文件 | `kasia-console/scratch/_kanetui_checkout_v023_test_20261002/`（zip、manifest.json、SHA256SUMS.txt；scratch 为 gitignored，发布前须重出一份并核 sha256 相同） |
| 构建 | `node scripts/build-checkout-release.mjs 9a0cb4d6`（包内仓库文件全部 `git show <commit>:<path>` 原样取；wasm 与绑定文件对 `scripts/kaspa-wasm-web-pin.json`、`scripts/silverc-wasm-pin.json` fail-closed 核 sha256） |
| 两个 wasm | `kaspa_bg.wasm` `732bdaa3…9e51`、`silverc_lang_bg.wasm` `868e3f1b…c325`（`checkout.js` 里也硬编码了这两个值，运行时自检） |

## 1. 发布位置（Owner 选）

GitHub Pages 只托管静态文件；这个包本来就是纯静态，所以只需要"放文件"。

- **方案 A（推荐）：新建独立公开仓库**（例 `Unio996/kanet-checkout`），main 分支根目录就是解压后的 `checkout-static/` 内容。优点：16.7 MB wasm 不进主仓 `Unio996/KANet` 的永久历史；撤回 = 关 Pages 或删仓，不碰主仓；仓库内只有发布包文件，核对面最小。
- 方案 B：主仓 `Unio996/KANet` 建孤儿分支 `gh-pages`。优点：不用新仓库；缺点：二进制永久进入主仓对象库，且主仓是公开仓（D-021），历史不可抹。
- URL 形如 `https://unio996.github.io/<repo>/checkout.html`（用户名站点/自定义域名本方案不涉及，不加 CNAME）。

## 2. 发布步骤（Owner 批后由有账号的一方执行；本机只出材料）

每步都是可核的，不靠"我保证"。

1. **出包并核对**：从 9a0cb4d6 重新打包，`sha256sum kanet-checkout-static-v1.zip` 必须等于 §0 的值；不等则停（wasm 非完全确定性构建，见 pin 文件 sha256Note，不等不代表被调包，但必须停下由 J2 判 goldenSample 同源，不得直接发）。
2. **逐文件核对**：解压到全新目录，对 `manifest.json` 里 35 个文件逐个算 sha256，全部相等。
3. **扫外部依赖**：对解压目录全文 grep `https\?://`、`wss\?://`、`src=`、`import(`。已知的外部连接只有 `monitor.js` 里的 5 个主网公共节点（见 §4），无 CDN 脚本、无字体、无统计脚本。结果与 §4 不一致即停。
4. **发布仓库内容 = 解压目录原样**，不改任何一个字节。允许额外加入且仅允许加入：一个空文件 `.nojekyll`（让 Pages 不跑 Jekyll 处理；它不属于发布包，在提交说明里声明）。不加 README 以外的任何文件；如需 README，只放 §3 批准的文案。
5. **提交**：一个提交，提交说明写 tag、commit `9a0cb4d6`、zip sha256。
6. **开 Pages**：Settings → Pages → Deploy from branch → main / root。不启用自定义域名，不启用任何 Action。
7. **发布后核对（线上字节 = 包内字节）**：对 manifest 里每个文件 `curl -s <PagesURL>/<path>`（不带 `Accept-Encoding`，拿原始字节）算 sha256，35 个全部等于 manifest；其中两个 wasm 的 sha256 另列出对 pin。
8. **真浏览器验收**：新浏览器配置文件打开 Pages 上的页面，复用 v0.2.3 已有 e2e（`e2e_receipt.mjs`，只改 BASE）；通过标准同 v0.2.3 打包时的 32 PASS / 0 FAIL。Pages 上的 e2e 需要 simnet 节点走 `?rpcUrl=`，只能在本机或隔离环境对 Pages URL 跑，且须先决 §6-②。

## 3. 对外文案（须 Owner 批；以下为拟稿，未批不得出现在任何公开位置）

仓库描述（一行）：
> KANet 结账页（测试版 v0.2.3-test）：纯静态网页，在浏览器本地验签、推导订单地址并监视付款，不依赖我们的任何服务器。

页面/README 须如实说明的要点（逐条，写成最终文案前 Owner 改）：
1. **测试版**：版本号带 `-test`，功能与安全性未经公开审计，不应用于大额付款。
2. **没有我们的服务器**：页面只做浏览器本地计算；但会直连第 4 节列出的第三方公共 Kaspa 节点读取链上状态。
3. **订单凭据**：出单后务必下载订单凭据，凭据丢失将无法退款（v0.2.3 的机制；订单 #1 事故的教训，见 `project-checkout-order1-stuck-1kas-refund-20261001`）。
4. **完整性自检**：附 zip sha256、两个 wasm 的 sha256，说明如何自行核对。
5. **不是什么**：不是托管服务，不保管用户资金，不提供退款客服（退款走页面内的到期退款按钮）。
6. **反馈渠道**：只写 Owner 指定的渠道（本草稿不替 Owner 决定写哪个联系方式）。

## 4. 对用户隐私的如实披露（文案里不能漏）

- 页面不经我方服务器，但**会连这 5 个公共节点**（`monitor.js` MAINNET_ENDPOINT_POOL）：`sara.kaspa.red`、`nina.kaspa.blue`、`eva.kaspa.green`、`vivi.kaspa.blue`、`isla.kaspa.red`。这些节点运营方能看到买家 IP 与所查询的地址。
- **订单数据在 URL 查询串里**（`q`、`ch`、`sc` 参数，见 `checkout.js` parseAttributionLink）。托管在 GitHub Pages 时，这些查询串会出现在 GitHub/其 CDN 的请求日志里（我们看不到，也无法关闭）。订单链接里是签名报价引用与渠道地址，不含私钥；是否可接受须 Owner 判。如不可接受，需要改成 `#` 片段（片段不发给服务器）——这是代码改动，不属于本发布。
- 访问页面本身，GitHub 会按其隐私政策记录访客 IP。

## 5. 撤回方案

分层，按严重程度选：

1. **下线（分钟级）**：仓库 Settings → Pages → Unpublish（或把 Pages 源改为 None）。站点停止服务，仓库与历史仍在。
2. **下线并删内容**：删除仓库（方案 A 的好处）。方案 B 则删 `gh-pages` 分支并强推空——主仓对象库里已推过的二进制仍可由旧 commit SHA 取到，需要联系 GitHub 做 GC，**不能保证清除**。
3. **缓存**：GitHub Pages/CDN 与买家浏览器会缓存，撤回后短时间内仍可能被访问到；wasm 已被浏览器缓存的买家页面在其本机仍可运行到缓存过期。无法远程使已打开的页面失效。
4. **已被分发的链接**：已发出的订单链接指向该域名，撤回后买家无法用该页面退款——因此撤回前须先通知有未完成订单的买家，让其用离线订单凭据 + 自托管发布包（zip 仍可从 GitHub Release/本机取得）完成退款。**这是撤回的真实代价，Owner 批发布时须知。**
5. 撤回动作本身 = 一次 Owner 或有账号一方的手工操作；我们的服务器无任何状态需要清理（因为本方案不加服务端）。

## 6. 发布前须 Owner/NWT 判的两点（我发现的，不是已有结论）

① **版本号 `-test`**：对外是否挂测试版，或先内测再改名。
② **`?rpcUrl=` 参数**：`checkout.js:261/480` 允许订单链接用 `rpcUrl` 覆盖连接的节点（simnet 测试用）。放到公开页面上，一条被人构造的链接可以让页面连到攻击者控制的节点、显示假的"已到账"。**必须二选一**：(a) 发布一个把该参数限定为 localhost/仅 simnet 的新版本（那就不再是 v0.2.3-test 的逐字节同源，需新 tag、重走打包与测试）；(b) 明确接受该风险并在文案写明"不要点击来源不明的订单链接"。我倾向 (a)，但这是代码+对外决策，我不替 Owner 定。

## 7. 本方案没有做的事

- 没有创建仓库、开 Pages、推送任何内容；没有重新打包；没有核对线上字节（线上还不存在）。
- 没有验证 GitHub Pages 对 `.wasm` 的 MIME 类型与压缩行为（`checkout.js` 的进度条已兼容压缩传输，见 NWT 复现修复）；§2-8 的真浏览器验收会覆盖，但属于发布后才能确认。
- §1 的"推荐"只是工程判断，仓库位置与账号由 Owner 定。
