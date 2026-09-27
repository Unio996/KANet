# D-034 §8 商品佣金计划 — 实现期证据(J2, 2026-09-27)

设计稿：`docs/2026-09-27-j2-commission-plan-attribution-design-v0.4.md`（NWT 2026-09-27T09-22Z 合并审：1 MUST + 1 强 SHOULD，均在实现中落地，见下）。

## 文件

- `sdk_unit_tests.mjs` / `sdk_unit_tests_final.log` — 31 项纯函数单测（quote 签名/验签、O2 三维 mass 预检、O4 最小订单额、N2/N3 去重与上限、O1 签名链 5 种攻击、§3.3 声明机制、MUST（`resolveRulesForOrder` 只认 `verifyChain()` 输出）、O3 押金条款）。31/31 PASS。
- `simnet_real_tests.mjs` / `simnet_run4_final_9of9_pass.log` — 真实 simnet 广播（独立全新节点，同 InstantSplit PMT 修复那轮"不用共享 simnet"的教训）。9/9 PASS：3 角色 split（有/无找零）、7 角色（满编）split、篡改渠道地址拒绝、C26 五渠道 dosage 边界（真实二分搜索 + 真实广播，含 broker）、边界以下 1 sompi 拒绝（真实 storage mass 超限）、refund（deadline 已过）、ChannelDeposit 正确签名人取回接受、错误签名人拒绝。
- `independent_third_party_signature_chain_test.mjs` — 零 import `commission-plan-sdk.mjs` 的独立第三方复现，从零手写签名链构造/验证逻辑，验证 §3.4 的核心密码学声明（根摘要域分隔、位置绑定、5 种攻击抵抗）。7/7 PASS。

## 实现期发现的真实 bug（均已修复，逐条见 commission-plan-sdk.mjs 对应函数头注）

1. `fee-split.mjs` 的 `validateFeeRules` 要求 `provider` 角色**不带** `address` 字段（该库自己的 prediction-market 语境设计），而本设计报价里 provider 一直带真实地址——两套 schema 期望冲突，直接喂入会立刻报错。修法：真实地址进 `payoutSpks` side-table，喂给 `validateFeeRules`/`feeSplit` 的地址一律替换成占位值，不改 `fee-split.mjs` 本身。
2. 同一问题不止 provider：`broker`/任何具名固定角色的真实 kaspa 地址（bech32，非 64-hex pubkey）同样会被 `validateFeeRules` 的 `HEX64` 校验拒绝——同一套修法覆盖到所有角色。
3. 十六进制占位符字节数写错（`'00'.repeat(64)` = 128 hex 字符 = 64 字节，而 `validateFeeRules` 要求恰好 64 hex 字符 = 32 字节）——已修为 `.repeat(32)`。
4. `fold_to` 字段（本设计新增，`fee-split.mjs` 不认识）在 `fullyUnfoldRoles`（mass 校验路径）里没有被剥离，会撞 `validateFeeRules` 的未知键白名单拒绝——已修。
5. `resolveRulesForOrder` 早期实现试图用 `feeSplit` 返回的占位 pk 反查角色名，但占位 pk 对所有角色相同，永远查不到——改用 `feeSplit` 顶层 `result.feeLeaves[].type`（角色名原样透传）+ `result.winners[0]`（provider）。
6. `mkSpkOut`（构造广播用 `TransactionOutput`）把完整 `version+script` 字节整体当 script 传给 `ScriptPublicKey(0, ...)`，产生"non-standard script form"——链上真实广播才暴露；已修为正确拆分 version/script。
7. `ChannelDeposit.withdraw` 硬编码只付回押金人自己的 P2PK 地址，`buildChannelWithdrawTx` 早期版本却接受一个任意调用方指定的目的地地址——导致真实签名也过不了 `checkSig`（因为输出根本不是押金人自己的地址）；已修为内部固定算出押金人地址，移除该参数。
8. C26 边界二分搜索脚本用"输出总和+1"近似真实 `inputAmt`，比真实交易实际需要覆盖矿工费的更大 `inputAmt` 低——storage mass 公式的输入侧折扣项反比于 `inputAmt`，导致本地估算比真实链上 mass 低了 3（本地估 500,000，真实 500,003）；已修为与 `buildCommissionSplitTx` 同一套 `inputAmt` 计算方式，重新二分搜索后本地/真实一致。
9. `dedupAndCapChannelSpks` 原本假设"全大写 bech32 地址"会被 kaspa-wasm 正常解析（只是文本不同、字节相同），真实测试发现 kaspa-wasm 的 `Address` 构造器对非规范大小写直接 wasm panic（`'unreachable'`）——N2 设计稿设想的"大小写变体蹭槽位"攻击因此在触达本函数之前就已被地址库结构性拒绝；已修为优雅捕获并清晰拒绝，不让未捕获异常穿透。

## 范围声明（如实标注，非回避）

- ChannelDeposit 的押金人身份 V1 只支持标准 Schnorr（P2PK），未做 ECDSA 变体（设计稿 §6.2/§7.3 允许 P2PK-ECDSA 押金，但需要额外的摘要构造步骤，本轮未实现，留作后续独立小改动）。
- 开源纯静态结账页/配置页：本仓 `node_modules/kaspa-wasm` 是 `wasm-bindgen --target nodejs` 构建（真实读源码确认），无法直接在浏览器运行——签名验证/签名链验证/地址推导/交易构造这几步委托给本机常驻小型 HTTP 服务 `checkout-static/resolver.mjs`（任何人可在自己机器上 `node resolver.mjs` 启动，不是"我们的服务器"，但也不是纯浏览器零进程）。浏览器原生 wasm 构建是独立的后续基础设施工作，本轮未做，已在 `checkout-static/resolver.mjs`/`checkout.html` 头部注释中写明。
