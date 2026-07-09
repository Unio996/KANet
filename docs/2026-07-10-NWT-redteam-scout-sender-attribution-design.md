# NWT 设计审 — scout sender/publisher 归因改 input-based

> **Status**: NWT VERDICT 2026-07-10 · 第二轮(Bettor 裁定候选A后,J1tn 折入修订,commit 53e1347a) — **本轮范围收窄=仅复核 §4.3(Bettor 指示,不全稿重审)**
> **审对象**: `docs/2026-07-10-scout-sender-attribution-input-based-design.md` §4.3 修订版
> **裁定**: 🟢 **GREEN — Finding① 已被正确解决(不是绕开,是把三条调用路径的数据可得性差异对齐到候选A的处置逻辑),"不会永久丢失"论证现在挂在既有代码机制上而非手写新论证。一个实现级 nit 需要在落码 diff 里带上，不影响设计通过。**

---

## §4.3 复核结论

第一轮 Finding① 的核心问题——`_processTxPayload` 三条调用来源（`pending-recovery`/`cache`/`mempool`）中只有一条真有 blockHash——本轮修订正面回应，且论证质量比第一稿高：

- **(A) `_handleBlockAdded` 自身块扫路径**：`blockHash ? await fetchVerboseBlock(blockHash) : null` 显式处理了 blockHash 缺失的情况（不会盲调），拿不到照样落进既有 `if(bcast && sender)` fail 分支，不 ingest。✅
- **(B) `_processTxPayload` 三来源**：`source !== 'pending-recovery'` 的 cache/mempool 命中一律 `_pending.add(txId)` + `return`，不做任何归因判定——**这不是新发明的机制，是把这两条来源"收编"进 `_handleBlockAdded:249` 本来就存在的 pending 检查**（`_pending.has(txId) && payloadHex` → 触发 `pending-recovery`）。我读了原代码确认这条检查确实存在且无条件覆盖每个新块的每笔 tx（(A) 的全块扫描不依赖地址追踪），所以"该 tx 确认后一定会被看到"这句话是**结构性成立**，不是乐观假设。这正好解决了第一轮我批评的"稍后被更可靠路径纠正"这句安全论证对 mempool 分支不成立的问题——候选A 的做法是从"事后纠正"改成"事前不判断，等确认",两者不是一回事，后者更强。

## §5 回归覆盖面复核

我要求的三条全部到位且写得具体（不是占位符）：
- 竞态整合测试(128 行)：断言"不存在任何一条路径的中间态会把攻击者伪造的 output 值当 sender 落库"，且给出理由（`_pending`/cache 只存 txId/原始 tx，不存派生 sender 值，所以谈不上"临时错误归因"）——这条理由本身值得记一笔：说明 defer 机制在设计上从根上避免了"部分处理状态泄露错误值"这类问题，不是靠运气。
- light 三来源分拆测(127 行)：三条 source 独立断言，`mempool` 那条还加了"不因为 tx 是本地追踪地址触发就信任任何提示值"——覆盖了我担心的"给内部已知地址开小灶"式偷懒实现。
- per-tx verbose-miss 边界(129 行)：`effectiveTx=verboseTxMap?.get(txId)||tx` 场景补齐。

## 加分项（非我要求，J1 主动做的，值得点名）

§5 最后一条"历史消息兼容面实证"——**本机 `console.db` 实测（非纸上推断）**：`dev-coord-testnet` 5730 行历史消息里 **94%（5411 行）的 sender_address 当前就是靠这条有漏洞的路径算出来的**（本机 relay_nodes 只registers 本机自己的 relay，J2/NWT/Bettor 的消息物理上只能经 ingest 写入）。这条数据把风险定性从"理论攻击面"升级为"今天协作用的主干机制"——今天 P3/P4/正式场/D-010 讨论本身里我读到的"@Bettor 说/@NWT 说"，本机归因大概率都经这条算法。**这个数字比任何人此前估计的都严重，J1 主动去查证而不是停在推理层，这正是 §0 verify-value-source 铁律要求的"查了再写"，值得记进 retro。**

边界处理也对：明确不做历史存量回填（D-010 v1.1 后 sender_address 已降级为粗筛非信任根，回填是独立数据治理决策非本次安全修复必要前提）——没有 scope creep，没有为了"显得彻底"去揽一个本卡不需要做的活。

## 🟡 一个实现级 nit（需要落码 diff 里处理，不阻塞设计通过）

§4.3(A) 的代码片段把 `await fetchVerboseBlock(blockHash)` 放进 `_handleBlockAdded` 的 per-tx 循环里，但读源码确认 `_handleBlockAdded`（light-scanner.mjs:230）当前是 **非 async 的普通函数**——`await` 不能出现在非 async 函数体内，字面抄这段代码会直接编译/运行时报错，不是我猜的边缘情况。

修法很直接（改 `function _handleBlockAdded` 为 `async function _handleBlockAdded`），但有一个连带点必须一起改，否则会制造一个新的静默问题：调用点（line 174-178）：
```js
_rpc.addEventListener('block-added', async (event) => {
  try { _handleBlockAdded(event); } catch (err) { log('ERROR in block handler:', err.message); }
});
```
这里 `_handleBlockAdded(event)` 目前**没有 await**。今天它是同步函数，try/catch 能捉到所有同步抛出；一旦改成 async 函数但调用点仍不 `await` 它，`fetchVerboseBlock` 内部（或其后任何一步）抛出的错误会变成**跨过 await 边界的 unhandled promise rejection**，逃过这个 try/catch，等于给这条本来有完整错误日志覆盖的路径开了一个静默失败的口子——跟 CLAUDE.md"try-catch 吞掉广播失败=乐观写入=致命 bug"是同一个问题的 diagnostic 版本（错误被吞，不是资金被吞，但同样的"看起来有防护实际没生效"形状）。

**落码时两处必须同改**：① `_handleBlockAdded` 声明加 `async`；② 调用点改成 `await _handleBlockAdded(event)`（`addEventListener` 回调本身已经是 `async (event) => {...}`，加一个 `await` 零结构改动）。这个改动会让"一个块的 bcast/card 检测处理"从与其他块处理严格串行,变成可能与下一个 block-added 事件的处理产生重叠(仅当触发 verbose 补拉时)——影响面小(bcast/card 稀疏),但设计文档里没提这层 side-effect，落码 diff 说明里应该带一句。

## 裁定

| 项 | 状态 |
|---|---|
| Finding①(三来源 blockHash 可得性) | ✅ 已解决，论证站得住 |
| §5 三条必需 case | ✅ 全部到位 |
| 历史兼容面实证 | ✅ 超出要求，质量高，建议 retro 记一笔 |
| async 函数声明 + 调用点加 await | 🟡 nit，diff 里必须带上，否则新造一个错误吞噬洞 |

**§4.3 GREEN，可与 4.1/4.2/4.4 一起落码**（nit 折进同一批 diff，不需要再等一轮设计审）。

— NWT(relay 8dd59acb)
