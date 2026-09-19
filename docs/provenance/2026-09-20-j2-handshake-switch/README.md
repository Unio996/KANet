# 握手自动接受开关·笔二(开关本体): `RELAY_HANDSHAKE_AUTO_ACCEPT`

> **Status**: CURRENT(证据目录; 设计见 `docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md` v0.4 §6–§8)
> 分支 `coord/j2-handshake-switch-v0`,基线 = 主线 `6635ff89`(笔一已在主线: merge `0782d94c`)。
> **只做代码与测试;不起 relay、不碰主网 env、不动驱动开关、不碰私钥值。** relay 是 console 子进程,新代码随下一次 console 重启生效(设计 §4)。

## 语义(一句话)
只认字面 `'1'` 才"自动接受入站握手";未设 / `'0'` / `'on'` / `'true'` / `' 1'` / `''` … 一律关。关闭态:入站握手照常登记(ingestTx / ingestMessage / pending_actions 不变),**不 claim、不接受、不发交易、不发问候、不 markSeen**;每次调用读 env,不缓存。

## 改了什么
| 文件 | 变化 |
|---|---|
| `kasia-relay/src/lib/handshake-switch.mjs` | 新增,零 import。`handshakeAutoAcceptEnabled(env = process.env)`(只认 `'1'`,每次调用读)、`handshakeStartupLine(env, relayMode)`、`createOncePerKeyLogger(log, {cap})`(每 key 每进程一行,Set 上限 1000,满后恰一行 `suppressing further disabled-peer logs`)。 |
| `kasia-relay/src/chain.mjs` | **chokepoint**(§7.2/§8.4):`acceptHandshake` 关闭态在函数体最前 `return null`(不碰钱包、不加密);自己打一行 `disabled (chokepoint, caller=<函数名@文件:行>)`,按 peer 去重、同上限。调用者标识取自调用栈(只带文件名:行,无目录)。 |
| `kasia-relay/src/rpc-listener.mjs` | **落点 2**:`processHandshake` 守卫在 step 4 `ingestMessage` 之后、step 5 claim 之前,关闭态一行 `HANDSHAKE auto-accept disabled — left pending for <后12位>` 后 return(不 markSeen)。**落点 3**:`catchUpHistory` 第 1 段整段跳过(连 pending 查询也不做),一行 `catch-up handshakes: DISABLED …`;汇总行写 `handshakes: DISABLED`(不写 0);开启态第 1 段的 `try` 整段一字未动(`if … else try` 形态,与既有 `KANET_CATCHUP_COMM` 闸同形)。 |
| `kasia-relay/src/lib/handshake-accept.mjs` | **落点 4**(索引器 / 回落模式的 `poll()` 路径):入口守卫,关闭态一行 `HANDSHAKE auto-accept disabled (poll) — left pending for …`,**每 peer 每进程一次**(§7.4);不查 console 去重、不接受、不发送。因此本模块现在 import `handshake-switch.mjs`(纯函数)。 |
| `kasia-relay/src/relay.mjs` | 顶层一行启动日志 `log(handshakeStartupLine(process.env, RELAY_MODE))`,在 `RELAY_MODE` 分支**之前**(回落 / 索引器模式同样打,V6 计数才等于 relay 子进程数)。接线行(`createHandshakeAcceptor({…})`)一字未动。 |
| `kanet.env.example` | 一段注释掉的键 + 说明。 |
| 测试 | 见下表。 |
| `kasia-relay/test-fixtures/handshake-switch/*.BEFORE-6635ff89.txt` | 基线里 `processHandshake` / `catchUpHistory` / `acceptHandshake` 三个函数的**逐字原文**,由 `extract-before-fixtures.mjs` 从 git 对象程序化截取(不手打)。 |

## 验收对照(设计 §7.6 / §8)
| 判据 | 测试(单文件) | 结果 |
|---|---|---|
| V1 纯函数取值(未设/'0'/'on'/'true'/' 1'/'"1"'/''/'01'/全角'１'/'1\n'…全 false,'1' true;键名钉死;每次调用读) | `src/lib/handshake-switch.test.mjs` | 13 / 0 |
| V5 启动行(关闭 raw 原样显示 / 开启 ENABLED / 单行 / 带 RELAY_MODE)+ 去重器上限 | 同上;结构(顶层、分支之前、恰一处)在 scan 测试 | |
| V2 实时路径关闭态零 claim/接受/发送/markSeen/问候,登记调用不变;闸位置在 step 4 之后 | `src/rpc-handshake-gate.test.mjs` | 46 / 0 |
| V3 追赶第 1 段零调用 + 一行 DISABLED;第 2/3 段与基线逐条相同 | 同上 | |
| V4 开启态与基线原文全部外部调用轨迹逐条相同(processHandshake 11 场景 / catchUpHistory 5 场景)+ 阳性对照 sendKaspa 计数 | 同上 | |
| V10 汇总行含 `handshakes: DISABLED`,不含 `0 handshakes accepted` | 同上 | |
| V2c 落点 4 关闭态零调用 + 同 peer 3 tick 1 行 + 日志上限 + 每次调用读 | `src/lib/handshake-accept.test.mjs` | 35 / 0(含笔一 25 条,开启态照旧) |
| V2d chokepoint:关闭态 null(钱包未初始化时也返回 null ⇒ 没碰钱包)+ 带调用者标识日志去重;开启态与基线**解密后字段**相同(§8.2,不比密文) | `src/handshake-chokepoint.test.mjs` | 14 / 0 |
| V2b console 侧 pending 行现状钉住(真实迁移建临时库调真实 `handleIngestMessage`) | `kasia-console/src/services/ingest-handshake-pending.test.mjs` | 9 / 0 |
| V9 确切形状白名单扫描 + H1-1 接线精确钉 + 控制臂 | `src/lib/handshake-switch-scan.test.mjs` | 31 / 0 |
| V8 lint-kanet | 12 个改动 / 新增文件 | 0 errors(`lint.txt`) |
| V6 / V7(部署后/现场读数) | **未在本笔做**——V6 = 下一次 console 重启后 `grep -c 'handshake auto-accept: DISABLED'` == relay 子进程数;V7 = 现场 `kanet.mainnet.env` 静态检查。这两条是上线侧读数,不是代码测试。 | — |

## NWT H1-1(笔一审,合并前必做)
NWT 对 relay.mjs 那一行接线做 7 个变异 6 个存活(`sendKaspa` 换 `custodialSendKaspa`、`ingestHandshake`/`ingestTx` 互换、每次调用新建 acceptor、`localAddress` 换 `CONSOLE_URL`、`log` 换 `console.log`、`acceptHandshake` 换 `sendMessage`)。原因:笔一的结构断言只查"名字出现在对象里"的子串。
**补法(V9 relay.mjs 分支,`checkV9`)**:① 接线行整行钉成精确文本、模块顶层(花括号深度 0)、恰一处、`createHandshakeAcceptor(` 恰一处;② 八个注入名的声明 / import 来源行各自整行一字不差恰一处(`./chain.mjs` 的 import 行、`./ingest.mjs` 的 import 行、`function log`、`const CONSOLE_URL`、`const localAddress`);③ 八个名不得被重新声明 / `as` 别名(`fetch` 在 relay.mjs 里没有任何声明 = 全局)。
**对照臂**:NWT 的 6 个变异原样写成 `W1–W6`(+`W7` fetch、`W8` 每次调用新建、`W9` 注释掉/复制一份、`W10` 声明来源被换),全红。改这一行时须同步改 `WIRING_LINE`——这正是"钉住"的含义。

## 变异(`mutate-switch.mjs`,每个变异只跑相关的单文件测试)
- `mutation-raw.txt`:**29 个变异全部 KILLED,0 幸存**;还原后六个测试文件基线仍全绿。
- `mutation-raw-round1.txt`(保留,未删):第一轮 **1 个幸存**——`C4`(console:把 `else if (!existing)` 改成 `else`,已有 pending 也再 INSERT)。原因:`pending_actions.idempotent_key` 是 `UNIQUE`,重复 INSERT 会撞键、被 `try/catch` 吞掉并打 `pending_actions write failed`,所以**只数行**看不出"代码层跳过"与"靠 DB 撞键兜底"的区别(两层保护的同一个形状)。修法:V2b 的 ② / ④b 改为同时断言没有 `pending_actions write failed` 日志。第二轮 C4 KILLED。
- 覆盖:开关变宽松 / 写反 / 缓存成常量 / 启动行 raw 不 JSON 化 / 上限差一 / 不去重 / 抑制提示每次打;chokepoint 删掉 / 返回 undefined / 日志不去重 / 取错栈帧 / 缺参数抛;落点 4 删 / 反 / 不去重 / 不 return;落点 2 删 / 挪到 step 4 之前 / 反 / 不 return;落点 3 删 / 汇总行打 0 / 只打日志照跑 / 标志位不置;启动行删掉;console ×4。

## 超出设计文字的取舍 / 局限(诚实项)
1. **基线改为 `6635ff89`**(Bettor 指示):笔一已合入主线,本分支直接从主线切,无需 cherry-pick 笔一。
2. **`rpc-listener.mjs` 的两个落点不是"import 后调用",而是"从当前磁盘源码逐字截出函数、在桩环境里求值"**(`rpc-handshake-gate.test.mjs`):rpc-listener 顶层要读网络配置并起监听,且两个函数未导出。求的是真实源码文本(谁删 / 挪 / 写反守卫直接红,R1–R8 证明),未桩化的自由变量会立刻抛 `ReferenceError`。局限:函数边界靠"列 0 的 `}`"截取,若将来文件风格变了,提取器会 loud fail 而不是静默;模块级状态(`_handshakeAccepted` 等)是桩,不是真集合。
3. **chokepoint 的调用者标识来自 `new Error().stack` 解析**(Node 栈格式相关)。设计要求"漏掉早退的调用点在日志里一眼可见",而漏掉早退的调用点恰恰不会自己传 `caller` 参数,所以只能取栈。测试断言函数名与 `文件名:行` 形态、且日志不含目录路径(D-021)。若栈格式解析不出,退化为 `unknown`,不影响"返回 null"这一保护本身。
4. **V9 是文本扫描,不是数据流分析**:动态拼接的属性名(`chain['accept'+'Handshake']`)、`eval`、打包产物它看不见;正则字面量里含引号会让字符串抹除器失步(本文件里没有,真实文件全绿即证明当前不触发)。这些是设计 §7.3 自己承认的"清单钉住不是保护本身"——保护本身是 chokepoint(V2d)。
5. **relay.mjs 启动行的"实际被 relay 打出来"没有行为测试**(relay.mjs 会启动 relay,无法 import);只有结构断言(顶层、RELAY_MODE 分支之前、恰一处、带 RELAY_MODE、文本只有一个来源)+ `handshakeStartupLine` 纯函数测试。V6 的真正读数是上线后的计数。
6. **V2d 的密钥**:发送方 / 接收方私钥都是测试进程内 `crypto.randomBytes` 现生成、进程结束即弃;即便环境里已有 `KASPA_PRIVKEY` / `KASPA_MNEMONIC`,测试也在进程内先 `delete` 再用一次性 key,**不读、不打印、不落盘任何真实密钥**。测试把 `KASPA_NETWORK` 在本进程内固定为 `testnet-12`(rpc-listener 顶层要求已知网络,wallet 支持它),不连节点。
7. **`caller` 之外没有改任何调用点的实参**:`acceptHandshake({ address })` 三个调用点的参数形状不变,所以开启态外部调用轨迹与基线逐条相同(V4)。
8. **内存限令期间**:全程只跑单文件 node 测试;变异 29 个、每个只跑相关的 1–2 个测试文件;未装包、未构建、未起 simnet(drain-finality 测试用 `KASPA_NETWORK=simnet` 只是 import 环境变量,无网络)。
9. 顺带核过:`drain-finality-safe-blocks.test.mjs`(会 import rpc-listener → chain → handshake-switch)仍 ALL PASS。
10. F5-1(NWT:`const s = "a"; // <引用>` 不报、"一行含未闭合引号、下一行 `// <引用>`" 不报 两条扫描器对照)已记 9-2b,**本笔未做**。

## 复现
```
cd kasia-relay
node src/lib/handshake-switch.test.mjs
node src/lib/handshake-switch-scan.test.mjs
node src/lib/handshake-accept.test.mjs
node src/rpc-handshake-gate.test.mjs
node src/handshake-chokepoint.test.mjs
cd ../kasia-console && node src/services/ingest-handshake-pending.test.mjs
cd .. && node docs/provenance/2026-09-20-j2-handshake-switch/mutate-switch.mjs
```
