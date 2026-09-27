# D-034 §8 后续票⑦ 编译器加载失败提示 — 证据快照(2026-09-27, KANet-UI)

真实验证方法: 部署一份故意损坏的 `silverc_lang_bg.wasm`(内容替换成任意字节，sha256 必然对不上
`scripts/silverc-wasm-pin.json` 的 pin 值)，触发浏览器版编译器加载失败的**真实代码路径**（不是伪造
一个错误对象模拟）。

## 结果(`e2e_compiler_fail.mjs`)

```
降级路径成功给出订单地址: true
展示了加载失败的原因: true
展示了三条替代方案(换浏览器/GitHub Release/resolver.mjs): true
没有建议依赖我们自己的服务: true
monitorInfo 指向上方说明而非重复整段: true
consoleErrors: 0
OVERALL: PASS
```

真实展示文案节选:

```
⚠ silverc 编译器(真实合约编译器)加载失败：silverc_lang_bg.wasm sha256 不符 pin(期望
868e3f1b…, 实际 e37d05fe…) — 拒绝使用, 降级到 order-template.js 路径
本页已自动降级到固定偏移覆写路径继续完成订单地址推导(...)，但触发分账/退款需要真编译器，
这个功能这次不可用。
如果你想用主路径(真编译器 + 可触发分账/退款)，有这几个办法：
  1. 换一个支持 WebAssembly 的浏览器，或检查网络连接后刷新页面重试
  2. 自己从这个项目的 GitHub Release 下载发布包，托管到任何你信得过的地方——不依赖我们的服务器
  3. 在自己的电脑上运行这仓库自带的 resolver.mjs——任何人都能自己跑，不依赖我们运营任何东西
```

## 顺带验证：正常路径不受影响

同一份改动（只在 `!usedWasmCompiler` 分支追加提示，未碰 `usedWasmCompiler===true` 分支）下，用真实
（未损坏）的 `silverc_lang_bg.wasm` 重跑一次：订单文本包含"真 silverc 编译器"、不含"加载失败"字样、
零控制台错误——确认这次改动没有影响正常路径。
