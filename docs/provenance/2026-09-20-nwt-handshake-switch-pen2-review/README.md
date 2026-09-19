> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-handshake-switch-v0` 头 `ff15de56`（父 `6635ff89`）；Bettor 令中途暂停，以下是暂停前已完成的部分；一轮、只报 MUST）

# 握手开关笔二审 —— NWT：**GREEN，无 MUST**（暂停前已做完的部分）

- 生产代码改动我逐行读了（chain.mjs chokepoint、rpc-listener 落点 2/3、handshake-accept 落点 4、relay.mjs 启动行、handshake-switch.mjs）：开启态路径文本上一字未动（被删的 4 行只有两条注释、`try {`→`else try {` 的那个 `try {`、追赶汇总行）；`else try {…} catch` 结构成立；五个改动文件 `node --check` 通过；所有新标识符都有对应 import。
- 六份测试亲跑：switch 13 / scan 31 / accept 35 / rpc 落点 46 / chokepoint 14 / console V2b 9，全绿。测试取钱包安全：`getWallet` 只认环境变量，测试先删环境里的密钥、用进程内一次性密钥，并用"钱包此刻不可用"证明关闭态没碰钱包（C0）。
- relay 子进程环境 = `...process.env` 展开（`relay-manager.js:229`），开关能传到。
- **我自己的 27 个变异**（`nwt-mutate-pen2.cjs`，钱路 / 启动崩溃 / 开关语义 / H1-1 接线）：**26 被抓，1 存活**。钱路类（chokepoint 闸失效或不 return、实时落点不 return / 闸失效 / 挪到 claim 之后 / 挪到 acceptHandshake 之后、追赶 `else try` 改顺序 try / 闸失效、轮询落点闸失效或不 return）**全部被抓**；开关语义类（宽松相等、缓存成常量、默认参数删掉、Set 无上限、非 0 即开）全部被抓；**H1-1 的 w1–w7 接线变异全被抓**（笔一审我要求的钉死已落实）。
- 存活的一个：**l1 `relay.mjs` 的 `handshakeStartupLine` import 被删**（relay 一启动就 ReferenceError）——当前代码没有这个问题，是未来编辑的回归风险，结构断言只查启动行存在、不查 import。记后续票，非 MUST。
- 没做：J2 自陈五项诚实项里 ①（从磁盘源码逐字截函数 + 桩环境求值，非 import）我用"读 diff 全文 + 变异"替代验证；⑤ 已核；③④ 认同为固有 / 上线读数项。
