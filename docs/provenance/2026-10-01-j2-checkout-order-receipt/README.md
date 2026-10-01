# 结账页订单凭据（Owner 2026-10-01 批「修」，D-034 结账页范围）

背景：订单#1 的 1.0 KAS 因浏览器端出单时随机 orderNonce 没存、无法重建地址而退不回（账本 1778/1779，Codex R11 ①）。

改动（只这些）：
- `resolve-order-wasm.js` / `resolve-order-browser.js`：拆"出单 deriveCommissionOrderAddress"与"重建 rebuildCommissionOrderAddress"。重建必须传 `orderNonceHex`(32 位小写 hex) + `deadlineMs`(正整数)，缺参/非法即抛错；重建内部不调随机数、不用 Date.now() 兜底。出单行为不变。
- 新 `order-receipt.js`（纯函数）：凭据构造/解析校验/链接比对。已加入 `scripts/build-checkout-release.mjs` RUNTIME_FILES。
- `checkout.js` / `checkout.html`：出单后醒目展示 nonce、截止时间与"不保存就无法退款"，提供"下载订单凭据(JSON)"；新增"导入凭据并重建订单"，重建地址与凭据地址逐字一致才进入订单监控（分账/到期退款按钮），不一致/缺字段/错链接/错网络/错类型一律拒绝且不放出按钮。

验收证据（同目录）：
- `verify_rebuild_node.mjs/.log` — 验收①：干净子进程、`crypto.getRandomValues` 与 `Date.now` 已毒化，按凭据重建，地址与赎回脚本字节和出单时逐字一致；缺参报错；篡改 nonce/deadline 得不同地址。12/12。
- `e2e_receipt.mjs/.log` — 验收②：真 Chromium + 真 simnet，出单→下载凭据→关页→新页导入→同一地址→到期退款真广播并入账；9 个反例被拒。32/32。静态服务器见 `static_server.mjs`（指向本 worktree；vendor 里 gitignored 的 wasm 二进制从 KANet-UI worktree 拷入，未入库）。
- `regression_broadcast_5scenarios.log` — 验收③：KANet-UI 既有五场景（分账无找零/有找零/到期退款/未到期拒绝/重复触发拒绝）在本分支结账页上 ALL PASS。
- `regression_3way_split.log` — 既有三方分账（含 channelSpks 修复）10/10。

说明：funders 余额有限，回归时对 funder 编号做过重映射（不影响被测逻辑）。ServiceEscrow 订单分支在 main() 早 return，本次未改其代码，未单独重跑其 provenance 用例。
