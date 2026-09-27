# D-034 §8 收尾票：让结账页真正纯静态 — 实现期证据(J2, 2026-09-27)

Bettor 派工三项：① 浏览器端订单地址推导不再调 silverc（预编译模板+固定偏移拼接 ctor 参数）；② 浏览器 kaspa-wasm 纳入锁版本清单；③ 去掉 checkout-static 对 resolver.mjs 的剩余依赖，实测一次。

**结果：② 完成。③ 部分完成（真实 E2E 通过，但 resolver.mjs 依赖因①受阻无法完全去掉）。① 经源码级验证判定为当前工具链下不可安全达成，建议不再往这个方向投入，理由与证据如下。**

---

## ①「预编译模板 + 固定偏移拼接」—— 源码级验证：不可安全达成，建议关闭此方向

**先查了什么（D-031）**：Bettor 提到的 `spliceLeafState`/`convergeShardLeafOwnRedeemLen`（`pool-shard-register.mjs`）。读了两者全部实现 + 调用点 + `docs/provenance/2026-09-15-j2-shardleaf-direct-self-splice-offset-fix/`（本仓自己的真实事故记录）。

**结论（这次探查的核心发现）**：这两个函数不是"splice 任意变长 ctor 字段"的先例——是**同一个问题的两个不同解法，且都印证了"不能对原生 `int` 类型做固定偏移拼接"**：

- `spliceLeafState` 能安全 splice，**只因为**它 splice 的 4 个字段在 ShardLeaf 的**协议里被约定为 `byte[8]` 固定宽度**（覆盖率 100% 的调用点自己在 JS 侧用 `_i64LE`/`_push8` 手工编码，不是 SilverScript 编译器给的什么特殊保证）。
- `convergeShardLeafOwnRedeemLen` 处理的正是**原生 `int` ctor 字段变长编码**这件事——但它的解法是**真的重新调用 silverc**（不动点收敛循环），不是不用编译器。
- 那份事故记录本身就是"曾经假设 ctor 全 fixed-width，真实主网翻车"的第一手记录。

**本轮独立复现同一条边界（不是重述文档，是自己动手测的）**：

1. 把 `CommissionSplit.sil`/`ChannelDeposit.sil` 的全部数值 ctor 字段从 `int` 改成 `byte[8]`（模仿 `spliceLeafState` 的思路，让每个字段编码定长），entry 内用 `int(...)` 转回——这是最直接的"照抄已证明安全的模式"路径。
2. 真实编译失败：`silverc compile ... fail: compile error: unsupported feature: array literal element type mismatch`（见 `int-byte8-cast-failure-repro.sil`/`.mjs`/`.log`，最小 4 行复现）。
3. 去读了 silverc 自己的源码（`D:\silverscript\silverscript-lang\src\compiler\compile.rs`），不是猜——`"int" | "byte" | "bool" | ... => compile_passthrough_cast_call(...)`，而 `compile_passthrough_cast_call` 的实现就是 `compile_call_arg_with_context(ctx, &args[0])`：**纯透传，不做任何字节重解释**。也就是说即使绕过上面那个编译错误，`int(byte8Value)` 语义上也不是把一个 8 字节缓冲区解析成 Kaspa Script 的最小编码整数——它只是把这坨字节原样推上栈，而算术操作符（`>=`/`+` 等）预期的是脚本自己的最小编码数字表示，两者不是一回事。
4. 搜了整个 `silverscript-lang/` 仓库（源码 + 全部测试），**没有一个真实的 `byte[N] → int` 转换用例**——所有 `int(...)`/`as byte[8]` 的真实用法全部是**反方向**（int → bytes，用于构造 witness/state 编码），跟 TUTORIAL.md 里那句泛化的 `int number = int(someData);` 对不上。

**判断**：这不是"我还没找到正确语法"，是**这个编译器版本没有实现"把一段字节按脚本数字语义解析成 int"这个能力**，`int(...)` 唯一真实工作的用法是"这坨字节本来就已经是目标类型的正确 wire 格式，只是换个静态类型标签"（`sig(sigBytes)`/`pubkey(keyBytes)` 那种），对 `int` 不成立，因为 Kaspa Script 的整数是变长最小编码，不是任何固定宽度的字节缓冲区。

**已把 CommissionSplit.sil/ChannelDeposit.sil 的实验性改动还原到合入 bshard-m3-deploy 的原样**（`git checkout --` 两个文件），生产分支上的合约没有被这轮探索改动过。

**建议**：不要再往"固定偏移 splice ctor 参数"这个方向投入——除非把 `silverc` 本身的 ctor 编码逻辑完整移植成一份独立 JS/WASM 实现（这是量级远超"splice 一下"的工作，等同于"给 SilverScript 写第二个编译器后端"，如果 Bettor/Owner 认为这值得做，需要单独立项，不应该在"结账页收尾"这个票的量级下继续摸索）。真正想要浏览器原生订单地址推导，现实路径只有：(a) 把 silverc 编译成 wasm32-unknown-unknown（需要 silverc 自己支持那个 target，未调研）；(b) 认可 resolver.mjs（本机小进程）是这条路径不可避免的一部分。

## ② 浏览器 kaspa-wasm 锁版本清单 —— 完成

`scripts/kaspa-wasm-web-pin.json`（同 D-019 pin 格式）：上游 commit `90dbf074275d60c1fe74a3491883196f110970c0`（如实记录该 checkout 有 2 处与 wasm/ crate 无关的本地改动）、构建命令（含 `CC=clang` 修正说明）、产物 sha256、goldenSample 同源判据（固定私钥→固定 pubkey/地址，独立于非确定性构建）。

启动期校验两处独立核（不是只核一边就信另一边）：
- Node 侧 `resolver.mjs` 启动时调 `wasm-pin-check.mjs`（`node:crypto` sha256）。
- 浏览器侧 `checkout.js` 用 `crypto.subtle.digest('SHA-256', ...)`，sha256 不符直接拒绝初始化（不静默降级），常量值硬编码在文件里而不是 fetch 权威 JSON——理由是③"整个文件夹能搬到任意静态托管"，相对路径指回仓库根目录会在脱离本仓目录结构时断掉；人工纪律是改 pin 文件时同步改这个常量，两处不一致会在下次加载时被 `wasmPinStatus.ok===false` 立刻发现。

## ③ 去掉 checkout-static 对 resolver.mjs 的剩余依赖 —— 部分完成，真实 E2E 通过

**做到的部分**：报价验签、签名链验证、渠道地址去重与上限——`checkout.js` 现在完全走浏览器原生 kaspa-wasm + vendored blake2b，一次网络请求都不发给 resolver.mjs。

**做不到的部分（因①受阻，非独立问题）**：订单地址推导仍然需要 resolver.mjs（`silverc.exe` 原生编译器）；提交/广播交易同样需要它连节点 RPC（这条本轮未去尝试用浏览器原生 WebSocket 直连 RPC，因为地址推导这一步已经绕不开本机进程，去掉 RPC 这一半不会让"完全脱离 resolver.mjs"这句话成立，优先级让位给下面的真实测试）。

**真实测试一次（`e2e_playwright_test.mjs`，本机已装的真实 Chromium，不是模拟）**：起本机 HTTP 静态文件服务器只从 `checkout-static/` 目录读文件（模拟"这个文件夹被丢到任意静态托管"），起 `resolver.mjs`，用 Playwright 驱动真浏览器走完整链路——`config.html` 填表建报价并签名 → 生成归因链接 → 打开 `checkout.html` 并附加一个渠道地址 → 浏览器原生验签/验证渠道地址 → 填退款地址 → 推导订单地址。**7/7 通过，全程零 console/page 错误**（`e2e_playwright_test_final_7of7_pass.log`）。

**这一轮真实测试过程中发现并修复了 2 个真 bug（Node 模拟测试測不出来，只有真浏览器才会暴露）**：

1. **`WebAssembly.Instance` 在主线程对大模块（本产物 11.4MB）同步实例化被 Chrome 禁止**（`initSync` 内部用的是这个同步构造函数）——之前的 Node 侧验证一直用 `initSync`，Node 环境没有这条限制，测不出来；真 Chromium 直接报错拒绝执行。改用官方导出的异步 `init()`（内部走 `WebAssembly.instantiate` 异步路径，无此限制），仍然用同一份已经校验过 sha256 的 `WebAssembly.Module` 对象，不重新走一次未经校验的 fetch。
2. **`CommissionSplit` 的 ctor 结构上要求"付款人退款地址"，而这个值只有消费者自己知道、报价里不可能预先填好**——第一版代码直接用一个不存在的报价字段兜底成 `null`，传给 resolver 在 `spkBytesFromAddress(null)` 这一步真实崩溃。修法：`checkout.html` 新增一个"你的退款地址"输入框，消费者填完后点按钮才触发订单地址推导（不是页面加载后自动跑）——这是设计稿本来就该有、但 v0.1-v0.4 从未画出来的一个真实必需的 UI 步骤，本轮 E2E 测试才把它测出来。

## 文件

- `int-byte8-cast-failure-repro.sil` / `.mjs` / `.log` — ①的最小失败复现。
- `e2e_playwright_test.mjs` / `e2e_playwright_test_final_7of7_pass.log` — ③的真实浏览器端到端测试，7/7。
