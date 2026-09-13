# NWT diff 审 · J2 (a) LOCAL_ONLY strict patch（D-011 内部双审）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`scratch/_j2_a_local_only_strict_2026-09-13T10-49Z.patch`（sha256 `efc4ae29…769b0`，核对一致）+ 同名 `.notes.md`。
> **方法（不信作者自报，亲自跑）**：`git worktree add /d/kanet-tn12-nwt-review-wt 5f1b908e`（隔离，live 树未动）→ `git apply` → junction `node_modules`（不重装）→ 对 16 处改动文件逐一 `node --check` → `node scripts/lint-kanet.mjs <16 files>` → **亲跑** `node src/services/rpc-health-datacheck.test.mjs` → 逐文件读 diff 核五项审点。审完已 `git worktree remove`。

## 结论：**GREEN**，可推进落码（钱路部分仍走 Owner 批）

| 项 | 结果 |
|---|---|
| `git apply --check` | 干净，0 冲突 |
| `node --check` × 16 | 全部 exit 0 |
| `node scripts/lint-kanet.mjs` | **0 errors**（416 warning 均为仓内既有，与本 patch 无关） |
| `node src/services/rpc-health-datacheck.test.mjs`（**我亲跑**，非 J2 自报） | **✅✅ ALL PASS**——H0–H6 既有 22 断言绿 + 新增 H7–H13 20 断言绿，逐条日志行核对与设计契约逐字一致 |

## ① C1–C13 逐条对上 v0.2 稿与 A-N1–N5——对上，且我亲跑验证不是抄作业

跑测试时逐行核对了日志输出（不是只看 `PASS` 计数），H7（strict·配置端点健康但**零实例**构造，`st.ctor` 不增——直接证明"没走到"不是"走了被拒"）、H8（`isLan` 私网正则在 strict 下确认不可达，耗时 0ms 证没去 tcpPing）、H9（配置 URL 恰等于 env 时只核一次）、H10（写入口拒写 + DB 不变）、H11（`resolveChildRpcUrl` 恒 env + ignored 行逐字一次）、H12（`requireRpcUrl` 限频行为）、H13（**子进程**对照臂，非 strict 老行为一字未变）——七组全部对上 A-N2/A-N3/A-N4(由H4覆盖)/A-N5/N9 的设计意图，不是表面对上编号、是行为真的一致。

## ② relay 侧模块顶层 throw——fail-closed 极性正确，主网合法启动不会被拦死

读了 `shared/lib/rpc-utils.mjs` 与 `kasia-relay/src/rpc-listener.mjs` 的实际 diff：

```js
export function assertStrictRpcEnv(env = process.env) {
  if (isStrictLocalOnly(env) && !env.KASPA_RPC_URL) { throw ... }
}
```

**核心判据**：throw 只在 `strict=1 且 KASPA_RPC_URL 为空` 两者同时成立时触发。主网 env（`KASPA_RPC_URL=ws://127.0.0.1:17110` + `KASPA_RPC_LOCAL_ONLY=1`）下 `env.KASPA_RPC_URL` 非空，`!env.KASPA_RPC_URL` 为 false，整个条件为 false，**不 throw**——合法配置的 relay 启动不受影响。只有"strict 标志开了但忘了填 URL"这类真配置错误才会在模块加载那一刻炸，这正是设计要的"错配立刻暴露"而不是"运行时某次发送才发现"。`_connect()` 里还有第二道防线（`!directUrl && strict ⇒ throw`，防未来有人改动 `resolveRpcUrl` 内部逻辑绕开第一道）——纵深防御，没有过度设计的坏处（两道检查逻辑上不冗余触发，各自条件独立）。

## ③ 五处 C13 的 503/skip——不会把钱路半途状态卡在非终态

逐一读了 `oracle-pool.js:371/469`、`pool.js:1120`、`oracle-pool-renewal-cron.mjs:125`、`oracle-pool-chain-scanner-cron.mjs:32` 的实际改动位置：**`requireRpcUrl` 的判断都插在 `getWorkingRpc()` 之后、`new RpcClient(...)` 之前**，且这个位置之前的代码里**没有任何 DB 写入或状态转移**（都是刚拿到 rpcUrl 就立刻判断）——早退时什么都还没开始做，不存在"已经改了一半状态、RPC 客户端却建不起来"的情况，NO-TX 原则不受影响。两个 cron 站点的 `running` 互斥锁在 `requireRpcUrl` 判断**之前**已置 true，但外层 `try/finally` 结构未被本 patch 触碰（`finally` 块把 `running` 复位这段代码原样保留在外层），JS 的 `return` 语句在 `try` 内部执行时仍会先跑完 `finally`——互斥锁不会被卡死。

## ④ notes.md 三条未覆盖项——可接受

1. **`POST /settings/node` 409 没起 fastify 测**：我直接读了这 6 行 diff——逻辑与已测试的 `applyFix` 路径完全同构（同一个 `isStrictLocalOnly() && mode!=='local'` 判断，同样在任何状态改动之前提前 return），代码简单到读一遍就能确认正确性，不需要额外起服务测试才能信。**可接受**。
2. **relay-manager 的 env 组装未抽纯函数**：读了实际改动——`resolveChildRpcUrl('relay-manager')` 在 strict 下的返回值来自 `LOCAL_RPC`（模块顶层常量，`rpc-health.js:19` 早就对它做过 fail-fast，不可能为空）。**这意味着 `startRelay()` 里新加的 `if (isStrictLocalOnly() && !rpcUrl) return {ok:false,...}` 这一行实际上是不可达代码**——strict 模式下 `resolveChildRpcUrl` 永远返回真值，这个分支永远不会被触发。**这不是 bug**（没有造成任何错误行为，纯粹是多写了一层不会触发的防御），但严格说不是"未覆盖"，是"这条路径本身在当前不变量下不存在"，notes.md 的措辞应该改成"此分支为防御性代码、当前不可达"而不是"没测"——**不阻塞**，建议下次改稿顺手订正措辞，不必现在改代码（删掉这道防线本身也没必要，万一将来 `rpc-health.js` 的 fail-fast 逻辑被弱化，这道防线才会真正起作用）。
3. **A-N4 由 H4 覆盖**：核实了 diff 位置——strict 早退分支插入在 `checkLocal()` 已经跑完并返回 false 之**后**（`_localNegUntil` 负缓存那几行完全未改），这意味着"本机瞬时抖动"的既有处理逻辑（H4 覆盖的 REBUILD/负缓存链路）在 strict 模式下走的是**完全相同的代码路径**，只是失败后的"下一步"从"试配置/发现"变成了"直接返回 null"——H4 的既有覆盖确实还适用，claim 成立。**可接受**。

## ⑤ TN12 硬编码值——只在测试夹具，生产路径已清

`grep` 全部 diff 里剩下的 `17110`/`17210` 字面量：`settings.js`/`system-repair.js` 里的 `process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17110'` 这个 `||` 右侧**不可达**（同④第2点的道理，`rpc-health.js` 顶层已经 fail-fast，这两个文件只要被正常 import 链路加载就不可能走到这个默认值；留着是为了"万一有人绕过 rpc-health.js 单独 import 这两个文件"这种孤立场景不炸），不是"TN12 值漏进生产路径"。**`relay.mjs` 的 C9 修复力度最大**——直接删掉了硬编码的 `17210` 回退，改成 env 未设直接 throw，没有留任何默认值。`utxo-split.mjs` 的 `RPC_URL` 别名在 strict 下被显式拒认。测试文件（`rpc-health-datacheck.test.mjs`）里 `testnet-12`/端口号只出现在假 Ctor 的夹具设置里，符合"落地窗=波0主网console，TN12值只在测试夹具"的声明。

## 给 Bettor 的处置建议

- **GREEN，可推进**：可以进入下一步落码（非钱路部分 Bettor 批，钱路部分 Owner 批，两份设计稿已有的口径不变）。
- 建议 notes.md 第 2 条未覆盖项的措辞按④-2 订正（"不可达防御分支"而非"未覆盖"），文字级，不阻塞。
- `kanet.env:304` 那行注释仍需 Bettor 手工改（patch 带不到，J2 已在 notes.md 里给了原文，直接抄）。
