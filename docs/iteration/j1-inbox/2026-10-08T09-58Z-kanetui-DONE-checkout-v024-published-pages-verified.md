# 结账页 v0.2.4-test 已发布（独立公开仓库 + Pages），线上逐文件核对通过

> **Status**: CURRENT · KANet-UI · 2026-10-08 · 依据：账本 1885（Owner 批文案 v2 + 方案 A）

## 1. 发布结果

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/Unio996/kanet-checkout （public，描述 = v2 一行描述，Issues 开启） |
| Pages | https://unio996.github.io/kanet-checkout/ ；结账页入口 `.../checkout-static/checkout.html` |
| Pages 设置 | main / root，无自定义域名；构建方式 legacy（分支直发，没有我方 workflow；仓库 Actions 里只有 GitHub 自带的 pages-build-deployment 1 次） |
| 提交 1 `d99530c` | zip 解压原样 35 个文件 + 空 `.nojekyll`，说明写了 tag / fe37797e / zip sha |
| 提交 2 `8331744` | 仅替换 `README.md` 为批准文案（说明标注「包外改动」） |
| 主仓 tag | `checkout-static-v0.2.4-test` → `fe37797ec0cb8b7bbc91216ba1114309b1f0075f`，已推到 `Unio996/KANet` |
| zip | 存放的 `d35f1eaa6113f617aca077b9d86249731b0e333d9bd44b2b7c1dd92d66e687e1`（未重打包） |

文案：按 1885 定稿。第 6 条用正面说法（资金直接进订单合约地址，按规则自动分账或到期退款，KANet 不经手资金），第 7 条反馈渠道 = 本仓库 GitHub Issues，隐私披露最后一条保持「依据 grep、未通读 kaspa.js」的措辞，写成「未发现使用」而非绝对的「不使用」。README 末尾附除自身外 34 个文件的 sha256 清单（manifest 本身不在仓库里，所以把清单写进 README）。

## 2. 发布过程中我自己出的一个错（已在推送前纠正）

本机 git 的 `core.autocrlf=true`，第一次提交把 `vendor/kaspa-web/LICENSE`（原文含 CRLF）转成了 LF，我提交后用 `git show HEAD:<path>` 逐文件比 manifest 发现 1/35 不一致。当时尚未推送：设 `core.autocrlf=false`、重新 add、amend 本地唯一提交后复核 35/35 一致，之后才 push。线上核对（下节）证明推上去的是对的版本。

## 3. 线上逐文件核对（脚本 `scratch/_kanetui_verify_live.mjs`，Accept-Encoding: identity 取原始字节）

- 35 个路径逐个 GET：**34/34 的 sha256 与字节数 = manifest**（README 除外）。
- **README 单列**：线上 sha256 `082cd289fa37…` = 本地批准版 README（与包内自带 README 不同，这是预期的包外改动）。
- **两个 wasm 对 pin**：`kaspa_bg.wasm` = `732bdaa3…`，`silverc_lang_bg.wasm` = `868e3f1b…`，均等于 `scripts/*-pin.json`；`Content-Type: application/wasm`。
- 结果 `RESULT ALL OK`，无不一致。

## 4. 真浏览器验收（真 Chrome，只读，不付款不广播；脚本 `scratch/_kanetui_live_browser.mjs`）

用一次性随机密钥签了一份**主网**报价（商家/收款/退款地址都是新随机地址，未注资），带上恶意 `?rpcUrl=ws://evil.example:17110`，打开线上页，填退款地址点「确认并推导订单地址」：

- 商家签名验证通过，页面加载 kaspa-wasm（sha256 核对通过）和 silverc 编译器，推导出订单地址，状态监控「未到账——等待买家扫码付款」。
- **全部外连只有两类**：`unio996.github.io`（29 个页面文件请求）和 **1 条 WebSocket → `wss://sara.kaspa.red/kaspa/mainnet/wrpc/borsh`**（公共池第一个节点）。**没有任何对 `evil.example` 的请求**，`?rpcUrl=` 在主网被忽略，这是 v0.2.4-test 修复在线上真浏览器里的实证。
- 这次只连到池里第 1 个节点；其余 4 个节点没被触发，所以「外连只有那 5 个节点」我能证明的是「只出现了池内节点，没有池外地址」，不是 5 个都实际连过。
- cookie 为空，localStorage 无键（本次页面流程内）。
- 唯一的 404 是浏览器自动请求的 `/favicon.ico`（curl 确认站点根和仓库根都没有 favicon），不影响功能。

## 5. 与 README 部署要求的两处差异（如实记录，需 Bettor/Owner 知悉）

包内说明把「br 压缩」写成硬性部署要求、把 `immutable` 长缓存列为要求。GitHub Pages 实际给的是：

- `Content-Encoding: gzip`（不是 br），wasm 与 js 都是；
- `Cache-Control: max-age=600`（不是长效 immutable）。

我没有测 Pages 上两个 wasm 的 gzip 后体积和弱网加载时长；包内「br 开 117.7 秒 vs 关 347.2 秒」是在 br 条件下测的，**不能直接套用到 Pages 的 gzip**。弱网用户首次打开可能比 README 里的数字慢。Pages 无法自定义响应头，要改只能换托管。我没改任何东西，只报告。

## 6. 没做 / 未改的事

没有建 GitHub Release；没有加自定义域名；没有启用任何我方 Action；没有改打包脚本；没有重打包；没有碰主网 console、没有链上花费。真浏览器的反例验收我只做了「恶意 rpcUrl 被忽略」这一条，池节点全挂、Safari/手机等覆盖缺口仍如包内 README 所述。

## 7. 下一步（等派工）

v0.2.5-test：J2 的取货页文案已合（账本 1886），待你派工后我把 `delivery.html` 追加进同一仓库；追加时仍须：打包脚本出包、逐文件对 manifest、README 单列。
