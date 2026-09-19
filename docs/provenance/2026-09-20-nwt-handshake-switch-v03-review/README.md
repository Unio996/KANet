> **Status**: CURRENT（2026-09-20，NWT；对象 = 握手自动接受开关设计 v0.3 §7（`docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md`，主线头 `bec11048`）；审的是缓解设计）

# 握手自动接受开关设计 v0.3 §7 复审 —— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`bec11048`）读 §7；对它的三处新断言逐个核：§7.1 抽取与 §7.3 V9 规格能否同时成立、§7.2 chokepoint 的读入方式、§7.6 V2d / V4 的"逐字节不变"能否成立（读 `chain.mjs` 与 `lib/crypto.mjs` 的实现）。只读；不动任何进程。D-021：只写开关设计层面的事实。

## 结论：**方向 GREEN（抽取、chokepoint、日志去重、启动行都对）；1 条 MUST（小）——§7.1 与 §7.3(a) 自相矛盾，V9 按现写法会误红正确代码；2 条 SHOULD。出 v0.4 的这几句即可，不必整份重审。**

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST（小）** | **M3-1** | **§7.1（抽取 + 依赖注入）与 §7.3 V9(a) 互相矛盾**。§7.1 要求把 `doAcceptHandshake` 抽到 `lib/handshake-accept.mjs`，`acceptHandshake / sendKaspa / fetch / log` **由参数注入**；那么：① `relay.mjs` 里**必然出现**一处把 `acceptHandshake` **作为值**传进去的引用（`{ …, acceptHandshake, … }` 之类）以及一条 `import { … acceptHandshake … } from './chain.mjs'`；② 抽出的新模块里，`acceptHandshake` 是**参数名 / 解构出的局部变量**，调用形态是 `acceptHandshake(` 或 `deps.acceptHandshake(`。而 V9(a) 写的是"`acceptHandshake` 在 `kasia-relay/src` 每处出现……必须落在白名单确切 3 个（文件, 函数），**其它出现含别名 / 非调用引用 ⇒ 红**"——①里的注入引用恰恰是"非调用引用"，②里的参数名不是 `import`。按现写法，**抽取完成后的正确代码会让 V9 变红**（或者实现者被迫把规格放宽成"出现即可"，那就把它变成空判据）。**v0.4 要把白名单写成确切形状**：(i) `chain.mjs`：定义；(ii) `relay.mjs`：**恰一条** `import { … acceptHandshake … } from './chain.mjs'` 与**恰一处**作为属性传给 `handshake-accept` 的注入（写出允许的精确文本形态）；(iii) `lib/handshake-accept.mjs`：函数内的调用 `acceptHandshake(` / `deps.acceptHandshake(`，其守卫子句在前；(iv) `rpc-listener.mjs`：两处调用（`processHandshake`、`catchUpHistory`）各自的守卫子句在前。任何不在这四类里的出现（别名、别的文件、别的引用形态）⇒ 红。测试对照臂相应加：`relay.mjs` 里多一处第二次注入 ⇒ 红。 |
| SHOULD | **S3-1** | **V2d / V4 的"开启态草稿逐字节不变"无法字面成立**：`acceptHandshake`（`chain.mjs:136-146`）构造的握手 JSON 含 `timestamp: Date.now()`，加密用**每次新生成的临时 ECDH 密钥 + `crypto.randomBytes` 随机 nonce**（`lib/crypto.mjs:84-97` 的 `encrypt`）——**同一输入两次调用，`payload` 每次都不同**。所以"逐字节不变"的断言要么永远红、要么被写成空判据。改成**结构性等价**：断言 `{ to, amount }` 相等；`payload` 以握手前缀开头且长度落在预期范围；**用接收方私钥解密 `payload`**（relay 已有 `decrypt`），断言 JSON 的 `type / version / isResponse / alias / theirAlias` 与抽取前一致（`timestamp` 只断言"是最近的毫秒数"）。BEFORE / AFTER 对照也同理：对比的是解密后的字段，不是密文字节。 |
| SHOULD | **S3-2** | **§7.4 的每 peer 去重 `Set` 需要上限**：进程生命周期内不同对端地址的数量没有上限（它们来自外部），`Set` 会无界增长。给一个大小上限（如 1000，满了就**停止新增**并打**一行**"suppressing further disabled-peer logs"），与既有 `_acceptedPeers` 的无界先例区分开——后者是"只增不减"的旧问题，新代码不要再复制它。 |

## 一、§7 各节核对
- **7.1 抽取**：同意，`BEFORE / AFTER` 行为对照（同 F3 拆 `leaf-state-encode` 的做法）恰当；补一条：抽取笔**只搬代码不改行为**（不与开关 diff 混在一笔，或至少在同一笔里能单独 cherry-pick 抽取部分），便于对照。
- **7.2 chokepoint**：同意（我提的）。补两点实现提示：① `chain.mjs` 读 `handshakeAutoAcceptEnabled` 时要**每次调用取当前 `process.env`**（§6.2-② 已写）；② 关闭态返回 `null` 时，三个现有调用点都按"无 payload ⇒ 不发"处理（我上轮已逐个读过上下文），但**日志措辞不同**（"accept draft failed — will retry on next startup" 等）——因为各调用点自己的早退在前，这些措辞在正常情况下不会出现；若出现，说明某个调用点漏了早退，正好是一个可被 V9 之外的运行期信号——建议 chokepoint 返回 `null` 时**自己打一行**带调用者标识的 `HANDSHAKE auto-accept disabled (chokepoint)`，这样漏掉早退的调用点在日志里一眼可见（同样按 peer 去重）。
- **7.3 V9**：见 M3-1；另外 (d) 用 F2-1 的共享扫描器——**前提**是先做掉我 F4 审的 F4-1（`stripComments` 过度剥离，字符串 / 模板里含 `//` 或 `/*` 会漏报）：V9 是安全相关的钉住测试，不该建立在一个已知会漏报的扫描器上。请在实现 V9 之前完成 F4-1。
- **7.4 poll 日志去重**：同意，见 S3-2。
- **7.5 启动行与只读读数**：同意；只读 SQL 写得对。
- **7.6 验收表最终版**：V1–V10 + V2d 齐全；除 M3-1 / S3-1 涉及的 V9 / V2d / V4 外，其余同意。

## 没做 / 未证
- 没起 relay、没实跑；S3-1 的"payload 每次不同"我除了读 `encrypt` 实现（临时密钥 + 随机 nonce），还**直接跑了 `encrypt()` 两次**（一次性私钥推出的地址、无需钱包）：同一明文、同一接收方，两次输出**字节不同**（长度同为 113）——所以"逐字节不变"确实不可断言。整个 `acceptHandshake` 我没有跑（需要 relay 钱包），实现 diff 到了我会用注入桩实测。
- 设计稿没有实现，V1–V10 的变异我未审（等实现 diff）。
