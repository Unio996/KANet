> **Status**: CURRENT（2026-09-20，NWT；对象 = 握手自动接受开关设计 v0.2 §6（`docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md`，主线头 `d2ab6fa2`）；Bettor 要求**只看落点 4 与 V9 是否够**；审的是缓解设计）

# 握手自动接受开关设计 v0.2 §6 复审 —— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`d2ab6fa2`）读 §6；对它依赖的三处代码事实逐个核：`chain.mjs` 的 `acceptHandshake` 实现、三个调用点对"无 payload"的处理、`relay.mjs` 是否可 import、`POLL_MS` 默认值、repo 里其它是否引用这条 relay 链。只读，不动任何进程。D-021：只写开关设计层面的事实。

## 结论：**落点 4（位置与内容）GREEN；V9 与 V2c 按 §6 现写法不够 / 写不出来——1 条 MUST（小）+ 3 条 SHOULD，出 v0.3 的这一节再看。**

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST（小）** | **M2-1** | **V2c 在现有代码结构下写不出来**：`kasia-relay/src/relay.mjs` **没有任何 `export`**，且顶层直接 `import` 钱包 / 索引器、`const RELAY_MODE = …`、末尾按模式起 `startRpcListener()` 或 `setInterval(poll, POLL_MS)`（`:300-311`）——**import 它就会真的启动 relay**。所以"`indexer` / 回落模式下 `acceptHandshake` 0 次、`sendKaspa` 0 次"无法对 `doAcceptHandshake`（脚本内的非导出函数）直接驱动；§6.4 的 V2c"变异：删落点 4 ⇒ 红"就成了无法执行的验收。v0.3 必须写明**抽取**：把 `doAcceptHandshake`（连同 `_acceptedPeers` 与两级去重）抽成一个**可 import 的模块**（如 `kasia-relay/src/lib/handshake-accept.mjs`，依赖 `acceptHandshake` / `sendKaspa` / `fetch` / `log` 由参数注入），`relay.mjs` 只保留一行调用；`handshakeAutoAcceptEnabled` 同样独立成文件。V2c 就是"用注入的桩驱动这个模块，关闭态 `acceptHandshake` / `sendKaspa` 桩零调用"。这是对 `relay.mjs` 的**结构性小改**，要在设计里写出来、让实现者与审 diff 的人都知道。 |
| SHOULD（强建议） | **S2-1** | **把闸下沉到 `acceptHandshake` 本身，作为 chokepoint**。我核了 `chain.mjs:136-146`：`acceptHandshake` **只构造草稿** `{ to, amount, payload }`（`isResponse: true` 的握手载荷），**不花钱**；花钱发生在调用点的 `sendKaspa`。**三个调用点全都是"有 `payload` 才发"**：`rpc-listener.mjs:986` 之后 `if (draft?.payload) {…} else { log('HANDSHAKE: accept draft failed — will retry…') }`；`relay.mjs:256` `if (!draft?.payload) { log("Accept draft failed:", draft); return; }`；`rpc-listener.mjs:582` `if (draft?.payload) {…}`。所以让 `acceptHandshake` 在关闭态**返回 `null`**（不构造载荷），**三个现有点与任何将来的第四、第五个调用点都自动不花钱**——这是**结构性**保护，不依赖有人记得在每个新调用点加闸。M-H1 恰好证明"逐个调用点列举"会漏（v0.1 就漏了一个）。v0.1 §2.3 写"不动 `chain.mjs`"是为了最小改动，我理解；但**一处 3 行的早退**换来"对未来调用点免疫"，值。调用点各自的早退**保留**（为了不做无谓的去重 / claim / 日志、并让日志说得清"是开关关了，不是构造失败"）——两层：调用点早退负责**语义清晰**，chokepoint 负责**兜底**。残余：有人绕过 `acceptHandshake` 自己拼一个 `isResponse: true` 的载荷——由下面 S2-2 的扫描覆盖。 |
| SHOULD | **S2-2** | **V9 的"受保护"必须定义成可机检的规格，并重新定位它的角色**。§6.4 写"每处 `acceptHandshake(` 都在受保护函数内"，但文本扫描能证明的只是"名字出现在哪"，**不是**"闸支配调用"。具体漏洞：① "函数体内出现 `handshakeAutoAcceptEnabled(`"这种判据**不等于支配**——出现在日志字符串里、注释里、或写在调用**之后**都能通过；② **别名导入绕过**：`import { acceptHandshake as ah }` / `const { acceptHandshake: ah } = await import(…)`，之后 `ah(…)` 不含 `acceptHandshake(`；③ 非调用引用：`const f = acceptHandshake` / 作回调传出去。**建议的规格**：(a) **标识符 `acceptHandshake` 在 `kasia-relay/src` 出现的每一处**（去注释、去字符串后）除 `chain.mjs` 的定义外，必须落在**白名单的确切 3 个（文件, 函数）**里，任何别的出现（含别名 / 非调用引用）⇒ 红；(b) 白名单里每个调用点，其所在函数文本中必须有**守卫子句**——`if (!handshakeAutoAcceptEnabled(` … `return`——且它的位置在 `acceptHandshake(` **之前**；(c) 另扫 `isResponse: true`：除 `chain.mjs:acceptHandshake` 外出现即红（覆盖"绕过 `acceptHandshake` 自己拼载荷"）；(d) 用 F2-1 的共享扫描器（它已有去注释与对照臂自测）并自带对照臂：无守卫 ⇒ 红、守卫在调用后 ⇒ 红、别名 ⇒ 红、守卫只出现在字符串 / 注释里 ⇒ 红。**角色**：V9 在有了 S2-1 之后是**清单钉住**（新增任何出现处就红、逼评审看一眼），**不是**保护本身——保护是 chokepoint。 |
| SHOULD | **S2-3** | **轮询路径的日志会失控**：`relay.mjs:11` `POLL_MS` 默认 **2000 ms**；在 indexer / 回落模式下，一个 `pending_incoming` 会话因为永远不被接受，**每个 tick 都会再次命中** `doAcceptHandshake`——落点 4 的关闭态日志 `HANDSHAKE auto-accept disabled (poll) — left pending for <last12>` 就会**每 2 秒每个待处理会话打一行、永不停**（`poll()` 本身已经每 tick 打 `TICK` / `CONV:`，这行是在此之上再加）。要求：**每个 peer 每个进程生命周期只打一次**（`Set` 去重），必要时再每 N 分钟打一行汇总计数；V2c 加断言"同一 peer 连续 3 个 tick 只出现 1 行"。实时路径（rpc）是事件驱动、每笔握手一次，不需要。 |
| SHOULD | **S2-4** | 启动日志放在 `relay.mjs`（共同入口）我同意——但请写明**放在 `relay.mjs` 模块顶层、读一次**（`RELAY_MODE` 分支之前），且日志里带 `RELAY_MODE=<值>`，这样 V6 的 `grep -c` 既能对上进程数，也能一眼看出哪个 relay 在哪种模式下。 |

## 一、落点 4 我核对了什么（GREEN 的依据）
- **位置**：`doAcceptHandshake(peer)` 入口，在去重与 `sendKaspa` 之前——正确（它是 `poll()` 里 `pending_incoming` 分支的唯一接受点，`relay.mjs:285-286`）。
- **语义**：关闭态 return 且**不写 `_acceptedPeers`**、不 `sendKaspa`——与实时 / 追赶路径"不 markSeen、留待将来"的语义一致；`poll()` 的 `handleActiveConversation` 分支（对**已建立**会话的回复）不是接受路径，不受影响。
- **repo 里没有第四处**：我 grep 了 `kasia-relay/src` 之外对 relay `chain.mjs` 的引用——没有（其它命中都是无关的 `broker-fee-chain.mjs` 等同名片段）；`acceptHandshake` 的定义只在 `chain.mjs`，引用只在 `relay.mjs` 与 `rpc-listener.mjs`。**console 侧另有一个同名函数** `relation-state.js:acceptHandshake(localAddress, peerAddress)`——那是**数据库状态推进**、不发链上交易；V9 的扫描范围限定在 `kasia-relay/src` 即可，但**实现者要注意别把二者混淆**（测试里加一句注释）。
- §6.1 对主网现状的表述（config 无 `relay_mode`、env 无 `RELAY_MODE`、stdout 未见回落字样、历史无数据）与我的"没有历史数据"一致，不是新增断言。

## 二、§6 其余部分
- 6.2 五点采纳的措辞与我的意见一致；**6.2-②"每次调用读"** 请顺带写明：`handshakeAutoAcceptEnabled` 的三个调用点（实时、追赶、poll）与 chokepoint（S2-1）**每次都传当前 `process.env`**，不缓存。
- 6.3（S-H1 积压处置）与我的原文一致；建议在"打开前必读读数"里把**读数命令**写出来（一条只读 SQL：`SELECT COUNT(*) FROM pending_actions WHERE action_type='handshake_accept' AND status='pending'`），免得执行人自己拼。
- 6.4 V10（汇总行 `handshakes: DISABLED`）同意。

## 没做 / 未证
- 没起 relay、没在回落模式实跑（不动生产 relay）；S2-1 的"三个调用点都按无 payload 不发"是**读码**结论（三处我都读了上下文），未运行验证——实现 diff 到了我会用注入桩实测。
- V9 的扫描器细节（去字符串 / 去注释对模板字面量的处理）我没重审 F2-1 扫描器本身——它在 F4 里我会一并看。
