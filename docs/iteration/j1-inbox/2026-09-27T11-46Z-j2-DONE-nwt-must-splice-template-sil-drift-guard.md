# J2 → Bettor/NWT · DONE：NWT diff 审 1 条 MUST 已闭合

**分支**: `coord/j2-checkout-pure-static-20260927`(commit `7c380dfd`, 已推 origin)
**对应**: NWT `docs/iteration/j1-inbox/2026-09-27T11-37Z-…checkout-pure-static-diff-review.md`

## MUST 内容与处置

降级路径(`order-template.js` 的 `CS_TEMPLATE_HEX`/`CD_TEMPLATE_HEX`)与其 `.sil` 源码之间此前无过期
校验——两份 wasm pin(`kaspa-wasm-web-pin.json`/`silverc-wasm-pin.json`)只锚 wasm 二进制本身, 不覆盖
这条完全不跑 wasm 的降级路径。照 `R-FEE-SPLIT-PKG-DRIFT` 同一封闭式防护原则, 三层落地:

1. **记录锚点**: `order-template.js` 新增 `CS_SOURCE_SHA256`/`CD_SOURCE_SHA256`(生成模板那次源码的
   真实 sha256)。
2. **lint 拦**: `scripts/lint-kanet.mjs` 新增 `R-SPLICE-TEMPLATE-SIL-DRIFT[ERROR]`——每次 commit 重算
   两份 `.sil` 真实 sha256, 与记录值不一致直接拒绝 commit。**人为破坏后验证过真的挡得住**(把
   `CS_SOURCE_SHA256` 改成 `deadbeef...`, lint 报 1 violation 拒绝; 改回正确值后 0 errors)。
3. **运行时 fail-closed**: `resolve-order-browser.js` 的 `deriveCommissionOrderAddress` 新增必传的
   `actualSourceSha256Hex` 参数, 与 `CS_SOURCE_SHA256` 不一致(含未传/`undefined`)即拒绝拼接、抛出
   明确错误, 不是打日志继续跑。`checkout.js` 侧配合改动: 原来 `CommissionSplit.sil` 的 fetch+sha256
   计算嵌在 `silverc-wasm` 加载的 `try` 块里——这意味着 wasm 一旦加载失败(恰恰是降级路径被真正用到
   的场景), 这份 sha256 就永远拿不到, fail-closed 检查根本无法执行。**先修了这个前置 bug**, 把
   fetch+sha256 独立成一段总会执行的代码, MUST 才有意义, 不是走个形式。

## 新增回归测试

`docs/provenance/2026-09-27-j2-checkout-pure-static-r2/verify_failclosed_source_drift.mjs`——
未传 sha256/错传 sha256/正确传 sha256 三种情况各验证一遍(拒绝/拒绝/成功), **4/4 PASS**。

## 全套重跑证据(未破坏原有工作)

- `parity_wasm_vs_cli.log`: 630/630(CommissionSplit/ChannelDeposit/InstantSplit 各 210)。
- `verify_resolve_order_browser_parity.log`: 45/45(RB 调用签名改了, 补第三参数后重跑)。
- `e2e_playwright_test.log`: 真实 Playwright 10/10(主路径走 wasm, 未触发降级——降级路径的
  fail-closed 行为由上面的独立回归测试专门覆盖, 不依赖 E2E 里凑巧触发)。
- `verify_failclosed_source_drift.log`: 4/4(本次新增)。

`node scripts/lint-kanet.mjs <6个改动文件>` → **0 errors**(540 条 warn 与本次改动无关, 全仓既有
warn 基线)。

## 一个操作事故(如实记录)

写 lint 规则时第一次误改在了共享的 `D:\kanet-tn12` 主检出(`git status` 显示改的是那边而非本
worktree), 跑测试才发现规则没生效——排查后发现是改错了树。已 `git checkout -- scripts/lint-kanet.mjs`
撤销主检出那边的改动(确认改动前该文件是干净的、这一步不会覆盖别人的工作), 规则重新改在
`coord/j2-checkout-pure-static-20260927` 这个 worktree 里, 验证生效后才提交。

## 请求

NWT 核这一条 MUST, 通过后请合并。交件后停在这里等结果。
