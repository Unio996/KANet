# v0.2.0-test 发布包真实验证 — 证据快照(2026-09-27, KANet-UI)

Bettor 要求：① 绑定文件 sha256 纳入 pin(或纳入仓库跟踪) ② 用打包脚本从合并后主线 commit 打包，
解压到全新目录跑一遍真 Playwright(扫码/到账监视/split/refund/编译器失败降级)。

## ① 绑定文件 pin 收尾

`scripts/kaspa-wasm-web-pin.json` / `scripts/silverc-wasm-pin.json` 各新增 `bindingFiles.files`
字段，记录 `kaspa.js`/`kaspa.d.ts`/`LICENSE`（kaspa-web）与 `silverc_lang.js`/`silverc_lang.d.ts`/
`silverc_lang_bg.wasm.d.ts`（silverc-wasm）的 sha256（silverc-wasm 无独立 LICENSE 文件，如实标注
不是遗漏）。`scripts/build-checkout-release.mjs` 打包前逐个核对，不匹配 fail-closed 拒绝生成发布包
（不是警告）。真跑一次确认：

```
[build] ✓ 全部绑定文件(kaspa.js/kaspa.d.ts/LICENSE/silverc_lang.js/silverc_lang.d.ts/silverc_lang_bg.wasm.d.ts) sha256 均与该 commit 的 pin 文件一致
```

## 打包脚本另一个真实发现：RUNTIME_FILES 清单过期

打包脚本的 `RUNTIME_FILES` 静态清单是 ④ 时写的，此后 ⑤⑥⑦ 往 `checkout-static/` 加了新的运行时
依赖（`monitor.js`/`broadcast-commission.js`/`vendor/qrcode-generator/`/
`vendor/generic-entry-witness-browser.mjs`/`vendor/tx-mass-ub-browser.mjs`）——清单没跟着更新，
之前那版打包出来的包会**缺文件**（checkout.js 会 import 404）。本轮已补全（打包脚本头注"维护提醒"
本来就写了这条纪律，这次是纪律第一次真正被触发），文件数从 27 涨到 33。同时排除了两个新增的
Node 侧 parity 自检脚本（`vendor/generic-entry-witness-browser-parity.mjs`/
`vendor/tx-mass-ub-browser-parity.mjs`）——买家用不到，离开仓库目录结构是死代码，同既有排除惯例。

## ② 打包 + 全新目录真实验证

```
node scripts/build-checkout-release.mjs <合并后主线 commit>
```

- 33 个文件（详见 manifest）
- Python `zipfile` 核过：零反斜杠条目，`testzip()` 返回 `None`（CRC 全过）
- 解压到全新目录（`kasia-console/scratch/_kanetui_release_v2_final/`，与开发树完全隔离），起隔离
  服务器只认这个目录，`/setup/` 前缀单独指向仓库内 `config.html`（商家侧工具，本来就不在发布包内，
  仅用来签一份测试报价，不影响被测对象）

### 真实结果（`results.txt` 完整输出）

| 场景 | 结果 |
|---|---|
| ① 扫码付款 | PASS（jsQR 独立解码，与页面显示文本逐字一致） |
| ② 到账监视 + split | PASS（订单完成，资金离开收款地址） |
| ③ refund | PASS（退款到账 ≈3.99 KAS） |
| ④ 编译器加载失败降级 | PASS（临时把包内 `silverc_lang_bg.wasm` 换成损坏内容触发真实失败路径，
  降级路径正确出订单地址+清楚展示失败原因+三条替代方案，测完立刻换回原文件，sha256 核对与 pin
  逐字节一致，未在正式发布包里留任何痕迹） |

全程零控制台错误。真实独立 simnet（`kaspad v2.0.1`），真实持续挖矿+真实资金，与 ⑥ 交付时用的是
不同的一套全新 simnet 实例（进一步降低"同一个环境状态残留掩盖问题"的可能）。
