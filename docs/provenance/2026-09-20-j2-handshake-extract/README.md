# 握手开关笔一(只搬不改): doAcceptHandshake 抽到 lib/handshake-accept.mjs

> **Status**: CURRENT(证据目录; 设计见 `docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md` §7.1 / §8.2 / §8.4)
> 分支 `coord/j2-handshake-extract-v0`(基线 `origin/bshard-m3-deploy` = `338f2496`)。**本笔没有任何开关**——开关是下一笔(另开分支,笔一可单独 cherry-pick)。

## 改了什么(文件)
| 文件 | 变化 |
|---|---|
| `kasia-relay/src/lib/handshake-accept.mjs` | 新增。`createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl, localAddress })` 返回 `doAcceptHandshake(peer)`;去重 Set `_acceptedPeers` 在工厂闭包里。零 import。 |
| `kasia-relay/src/relay.mjs` | −32 / +3:删 `_acceptedPeers` 与 `doAcceptHandshake` 原文;加一行 import、一处工厂调用(注入八项依赖)。`poll()` 的调用点 `await doAcceptHandshake(conv.contactAddress)` 一字未动。 |
| `kasia-relay/src/lib/handshake-accept.test.mjs` | 新增,25 条。 |
| `kasia-relay/test-fixtures/handshake-extract/doAcceptHandshake.BEFORE-338f2496.txt` | 新增。抽取前 relay.mjs 该区间【逐字原文】(由脚本从 `git show 338f2496:kasia-relay/src/relay.mjs` 程序化截取,不手打),是 BEFORE 侧的求值对象。 |

函数体是**程序化提取**的,只做一处机械改名 `CONSOLE_URL → consoleUrl`(模块里没有那个顶层常量)。

## BEFORE / AFTER 怎么比(§8.2)
- BEFORE = 夹具原文用 `new Function` 在同样的桩下求值;AFTER = `createHandshakeAcceptor`。两边跑同一组 **18 个场景**,比对**全部外部调用轨迹**:每条 log 行、fetch URL、acceptHandshake / sendKaspa / ingestHandshake / ingestTx 的参数与顺序、每次调用的返回或抛出、每次 `doAcceptHandshake` 自身的 resolve/throw。`Date.now` 固定(`ingestTx` 的 traceId 在 sendKaspa 没给 txId 时用它)。
- 场景覆盖:主路径 / 同 peer 二次(内存去重)/ DB 已 accepted·active·confirmed / DB pending / fetch 抛 / `json()` 抛 / 响应无 status / 无 console / draft 为 null 或缺 payload / acceptHandshake 抛 / **sendKaspa 抛(NO TX NO STATE:不入内存不入库)** / sendKaspa 返回裸字符串 / ingestHandshake 抛(此前已入内存)/ 两个不同 peer / 先失败后重试成功。
- 防"两边都空"的空比较:轨迹长度 ≥ 3;关键场景要求 BEFORE 轨迹含预期标志行;另有对照臂断言 S1 的 fetch URL、traceId、金额 `0.2`、`remoteAddress` 真的进了轨迹。
- **本笔比的是接受函数的外部调用轨迹,不涉及密文**——`acceptHandshake`(chain.mjs)里的加密与 payload 构造本笔完全没动,§8.2 要求的"解密后字段对照"属于笔二(chokepoint 改在 chain.mjs 里,那里才有 BEFORE/AFTER 字节可比)。
- 机械"只搬不改"断言:模块函数体去两格缩进、`consoleUrl→CONSOLE_URL` 后与夹具里的函数原文逐字相同;`_acceptedPeers` 声明行两边逐字相同。
- 结构断言:模块零 import、零 `process.env`;relay.mjs 恰一处工厂调用 / 一处 import、无 `_acceptedPeers` / 函数定义残留、`poll` 调用点仍是一处、八项注入一个不少。

## 结果
- `test-output.txt`:**25 pass / 0 fail**(单文件 `node src/lib/handshake-accept.test.mjs`,在 `kasia-relay/` 下跑)。
- `mutation-raw.txt`(`mutate-extract.mjs`):**15 个变异全部 KILLED,0 幸存**;还原后基线仍 25/0。变异含:删内存去重 / DB 命中不记内存 / 去掉 confirmed / **发送前乐观记内存** / ingestTx 金额 / 去掉 consoleUrl 空值保护 / **Set 移出工厂变模块级** / ingest 顺序 / 错误日志文案 / peer 截断位数 / draft 失败不 return / fetch URL 参数写错 / relay.mjs 注入漏 localAddress / 漏 ingestTx / 残留旧 Set。
- `lint.txt`:lint-kanet 3 文件 0 errors(535 条 warning 是仓内既有的文档 Status 头存量,与本笔无关)。

## 超出设计文字的取舍 / 局限(诚实项)
1. **relay.mjs 的接线只由源码断言守,没有行为测**:relay.mjs 顶层直接读钱包并起监听,import 它就真的启动 relay,所以无法在测试里驱动。变异 M13/M14/M15(注入漏项 / 残留旧 Set)只被"结构断言"那一条杀掉(fail=1),这正是这一层的边界。补它需要把 relay.mjs 顶层再拆,不在"只搬不改"范围内。
2. 工厂形态与设计 §7.1 文字一致(`acceptHandshake / sendKaspa / fetch / log` 注入),我额外注入了 `ingestHandshake / ingestTx / consoleUrl / localAddress`——它们在原函数里是 relay.mjs 顶层的自由变量,不注入就得让模块反向 import relay.mjs(会启动 relay)。`fetch` 传的是全局 `fetch`,与原来函数体里直接引用全局等价。
3. 去重 Set 由"进程内一份"变为"每个 acceptor 实例一份";relay.mjs 只创建一个实例,运行时等价;有一条测试专门固定"实例间隔离"这一新增性质。
4. 提交内存 80% 限制期间:全程只跑单文件 node 测试,变异批量仅 15 个(每个一次单文件运行),未装包、未构建、未起 simnet。
5. 未起 relay、未碰主网 env、未动驱动开关、未碰私钥值(测试全是桩,地址是占位串)。
