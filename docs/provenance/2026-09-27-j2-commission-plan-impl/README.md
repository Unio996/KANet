# D-034 §8 商品佣金计划 — 实现期证据(J2, 2026-09-27)

设计稿：`docs/2026-09-27-j2-commission-plan-attribution-design-v0.4.md`（NWT 2026-09-27T09-22Z 合并审：1 MUST + 1 强 SHOULD，均在实现中落地，见下）。

**diff 审第二轮**（NWT `2026-09-27T10-11Z-nwt-VERDICT-j2-commission-plan-impl-diff-review.md`）追加 2 条 MUST + 3 条 SHOULD，本轮全部闭合，见文末"diff 审第二轮闭合记录"。

## 文件

- `sdk_unit_tests.mjs` / `sdk_unit_tests_final.log` — **38** 项纯函数单测（quote 签名/验签、O2 三维 mass 预检、O4 最小订单额、N2/N3 去重与上限、O1 签名链 5 种攻击、§3.3 声明机制、MUST（`resolveRulesForOrder` 只认 `verifyChain()` 输出）、O3 押金条款、**MUST-2 反例(C10/C11)**、**SHOULD C6/C12/C13**、**SHOULD② 签名链超 5 环拒绝**）。38/38 PASS。
- `simnet_real_tests.mjs` / `simnet_run5_final_10of10_pass.log` — 真实 simnet 广播（独立全新节点，同 InstantSplit PMT 修复那轮"不用共享 simnet"的教训）。**10/10 PASS**：3 角色 split（有/无找零）、7 角色（满编）split、篡改渠道地址拒绝、C26 五渠道 dosage 边界（真实二分搜索 + 真实广播，含 broker）、边界以下 1 sompi 拒绝（真实 storage mass 超限）、refund（deadline 已过）、ChannelDeposit 正确签名人取回接受、错误签名人拒绝、**C9 附加第二输出拒绝**（真实 simnet 广播）。
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
- **开源纯静态结账页/配置页（SHOULD③闭合后更新，见下方"diff 审第二轮闭合记录"④）**：报价验签/签名链验证/渠道地址解析三步已改为浏览器原生 kaspa-wasm + vendored blake2b，**不再依赖 resolver.mjs**。订单地址推导（`createCommissionSplitProtocol`）与实际广播仍需 resolver.mjs——真实原因是 `silverc.exe`（独立原生编译器，与 kaspa-wasm 编译成什么 target 无关），不是"独立后续基础设施"这种笼统措辞（NWT 2026-09-27T10-11Z③ 指出的原措辞问题，本轮已更正）。

## diff 审第二轮闭合记录（NWT `2026-09-27T10-11Z-nwt-VERDICT-j2-commission-plan-impl-diff-review.md`）

①**MUST-1**（`fee-split.mjs` 错误信息破坏既有回归）：标签恢复大写常量名 `PROVIDER_MIN_BPS=`/`ROLE_MAX_BPS=`（值仍是运行时覆盖值），`packages/fee-split` 镜像重新同步，既有 `fee-split.test.mjs`（①-⑧全部断言）本机重跑全绿。

②**MUST-2**（C10/C11 拒绝路径反例未测）：新增单测，构造 provider+broker+9渠道（共 11 输出，与设计稿已实测的"6 渠道结构性 mass=700,078"同族场景）的真实 mass 超限报价，断言 `validateQuoteMassFeasibility` 真 `ok:false`、`signQuote` 真拒签。

③**SHOULD①**（覆盖缺口）：补 C6（报价过期字段可判定）/C12（裸字节地址拒绝，含 `spkBytesFromAddress` 与 `validateRoleAddressSpk` 两处）/C13（ScriptHash 识别为不可绑定押金）单测；C9（`ChannelDeposit.withdraw` 附加第二输出）补真实 simnet 广播（同 T4 模式，正确签名+2 输出仍被 `require(tx.outputs.length==1)` 拒绝）。

④**SHOULD③**（浏览器构建措辞）：真实跑通 `D:\rusty-kaspa\wasm\build-web --sdk`（首次因缺 `clang` 失败——`clang.exe` 装在 `C:\Program Files\LLVM\bin` 只是不在 PATH，加 `CC=clang` 环境变量后编译成功，约 3 分钟）。产物 `kaspa_bg.wasm` sha256 = `732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51`（是否纳入 D-019 pin 待 Bettor/Owner 决定，不入 git 历史，操作者按 `checkout-static/vendor/kaspa-web/README.md` 自行构建）。新增 `checkout-static/verify-core.js`（零浏览器全局依赖的纯逻辑层，浏览器与测试共用同一份代码）承载报价验签/签名链验证/渠道地址解析，`checkout.js` 改为薄胶水层调用它，**不再经 resolver.mjs**；`verify_core_parity_test.mjs` 用真实浏览器版 kaspa-wasm 逐项对比 `commission-plan-sdk.mjs`（Node 版）的输出，9/9 byte-equal/一致（含签名/验签/地址解析/去重/完整签名链验证/篡改拒绝）；另用真实 HTTP 服务器验证了 `fetch()` 流式加载 wasm 的真实浏览器代码路径（不只是 Node `initSync` 走后门）。订单地址推导仍需 resolver.mjs，原因见上方"范围声明"，已在 `checkout.js`/`resolver.mjs` 文件头注释准确说明（不是"独立基础设施"，是"另一个独立原生依赖"）。

⑤**一致性 SHOULD**（签名链超 5 环静默截断）：`verifyChain` 新增 `entries.length > MAX_CHANNELS` 结构性拒绝，与 N3 对原始 `ch=` 地址列表"拒绝不截断"同一纪律；单测验证一条 6 环全部签名正确的合法链被结构性拒绝，不再被 `resolveRulesForOrder` 静默截断到 5 环。
