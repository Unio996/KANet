> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-handshake-extract-v0` 头 `a08e755f`（基线 `338f2496`）；握手开关笔一：`doAcceptHandshake` 抽到 `kasia-relay/src/lib/handshake-accept.mjs`，只搬不改）

# 握手开关笔一审（只搬不改的抽取）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`a08e755f`）。**不信 J2 的夹具**：我自己 `git show 338f2496:kasia-relay/src/relay.mjs` 抽原文，与夹具、与模块函数体三方逐字比较；用 `with`+Proxy 录**抽取前函数运行时真实查找了哪些外部标识符**，对照工厂注入的 8 个名字；读 `relay.mjs` 各注入名的声明位置与是否被重赋值；7 个我自己的接线变异。内存限令期间只跑单文件脚本，没有 npm install / 构建。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN（抽取本身确是只搬不改）；无 MUST；1 条强 SHOULD——`relay.mjs` 的接线只被"子串包含"断言守着，我的 7 个接线变异 6 个存活。请在笔二（会改同一行）里一并钉死。**

### 你让我核的三点
1. **只搬不改**：✅ 三方逐字相同。我从 `338f2496:relay.mjs` 抽 `const _acceptedPeers … 到 poll() 之前` 共 **1501 字符**；J2 的 `BEFORE` 夹具 **1501 字符、与之逐字相同**（夹具没有被改过以迎合测试）；模块函数体经"去两格缩进 + `consoleUrl→CONSOLE_URL` + 去掉工厂包装"后与原文**逐字相同**。原 `relay.mjs` 里 `doAcceptHandshake` 只出现 2 次（定义 + `poll()` 里一处 `await` 调用），抽取不漏调用方。J2 的 25/0 我亲跑复现。
2. **注入的自由变量取值是否与原顶层一致**：✅。我用 `with`+Proxy 在 4 条路径（DB 命中跳过 / 走完发送 / draft 失败 / 无 consoleUrl）× 各 2 次调用上录下**抽取前函数真实查找的外部名**：`CONSOLE_URL, acceptHandshake, fetch, ingestHandshake, ingestTx, localAddress, log, sendKaspa`（外加内建 `Set`、`encodeURIComponent`）——**与工厂注入的 8 个一一对应，没有漏注入、也没有多注入**。取值来源在 `relay.mjs` 里逐个核了：`acceptHandshake` / `sendKaspa` 是第 4 行对 `./chain.mjs` 的原 import；`ingestHandshake` / `ingestTx` 是第 7 行对 `./ingest.mjs` 的原 import；`log` 是顶层 `function log`（提升，无 TDZ）；`CONSOLE_URL`（第 13 行）、`localAddress`（第 44 行）都是 `const`、都在工厂调用（第 237 行）**之前**声明、**没有任何重赋值**（grep 空）；`fetch` 是全局，`kasia-relay/src` 里没有 `globalThis.fetch` / `setGlobalDispatcher` 之类的替换，模块加载时取一次与原来"调用时取全局"等价。`doAcceptHandshake` 从函数声明变成 `const`：唯一调用在 `poll()` 内、`poll` 在其后才被调用，无提升问题。`node --check` 两个文件语法通过。
3. **Set 语义未变**：✅。`_acceptedPeers` 在工厂闭包里，`relay.mjs` 只创建一个 acceptor ⇒ 进程内一份，与抽取前等价；`_acceptedPeers` 在 `relay.mjs` 中已无其它引用（grep 空，其余只在新模块内）。J2 的"工厂实例隔离"对照臂也在。

### 强 SHOULD
| 编号 | 内容 |
|---|---|
| **H1-1** | **`relay.mjs` 的接线只由子串断言守着，而它恰恰是"只搬不改"里唯一没有轨迹对照的一段（J2 自陈：relay.mjs 顶层读钱包起监听，无法在测试里 import）**。J2 的结构断言是 `call.includes('sendKaspa')` 这类子串包含 + 工厂调用恰一处。我做了 7 个与 J2 M13–M15 **不同**的接线变异（`outputs.txt` §3，`nwt-mutate-wiring.cjs`），**只被抓 1 个**（h5 写死空 `consoleUrl`，1 FAIL；我推断是因为它让子串 `consoleUrl: CONSOLE_URL` 消失，没有逐条核是哪一项红）：<br>• h1 `sendKaspa: custodialSendKaspa`（同文件已导入的另一个发送函数）——**存活**<br>• h2 `ingestHandshake: ingestTx, ingestTx: ingestHandshake` 互换——**存活**<br>• h3 `const doAcceptHandshake = (p) => createHandshakeAcceptor({…})(p)`（每次调用新建 acceptor ⇒ 内存去重 Set 每次清空）——**存活**（"恰一处工厂调用"仍成立）<br>• h4 `localAddress: CONSOLE_URL`——**存活**<br>• h6 `log: console.log`（丢时间戳前缀）——**存活**<br>• h7 `acceptHandshake: sendMessage`——**存活**<br>它们都改的是**当前代码里已经正确的那一行**，所以本笔没有错；但下一笔（开关笔二）**要改同一行**（加开关依赖），接线一旦在笔二里被写歪，这 25 项测试一个都不会红。**修法（便宜）**：把这一行钉成**精确文本**而不是子串——断言 `relay.mjs` 去注释后含**恰好这一行** `const doAcceptHandshake = createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl: CONSOLE_URL, localAddress });`（且在行首、即模块顶层，不在任何函数里）；并断言 `acceptHandshake, sendKaspa` 来自 `from "./chain.mjs"` 那条 import、`ingestHandshake, ingestTx` 来自 `from "./ingest.mjs"`、`function log(`、`const localAddress =`、`const CONSOLE_URL =` 各恰一处声明。笔二改这一行时同步改这条精确文本（这本来就是设计 v0.4 §V9 白名单"确切形状"要的东西，这里只是提前落地）。加上后我的 h1–h4 / h6 / h7 应全红。 |

### 没做 / 未证
- **没有实跑 `relay.mjs`**（它一 import 就读钱包起监听；不动生产 relay）。接线是"读码 + 上面的机械核对"，不是运行验证——这正是 H1-1 想补的那块。
- J2 自报的 15 个变异我没有重跑（内存限令）；M13–M15 的"只被结构断言杀"与我的 h5 一致，H1-1 是它的延伸。
- 没有测 `fetch` 在极端情形下（进程内有人替换全局 fetch）的等价性——grep 显示 `kasia-relay/src` 没有这种替换。
- `f5x_*` 输入文件（`git show 338f2496:kasia-relay/src/relay.mjs` / `a08e755f:…/handshake-accept.mjs` / 夹具）是我在 scratch 里现抽的，脚本读当前目录的这三个文件；复跑：`git show 338f2496:kasia-relay/src/relay.mjs > f5x_before_relay.mjs` 等，再 `node nwt-body-compare.cjs`（脚本里的输入名沿用了 `f5x_`）。
