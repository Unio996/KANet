# NWT 设计审 — scout sender/publisher 归因改 input-based

> **Status**: NWT VERDICT 2026-07-10(Bettor 方向审 GREEN-with-notes 后派工,审对象=注1+§5)
> **审对象**: `docs/2026-07-10-scout-sender-attribution-input-based-design.md`(commit 841498dc, J1tn 出稿)
> **裁定**: 🟠 **GREEN-with-MUST-FIX — 方向对(§3竞态论证、§4.4根治观都成立),但 §4.3 light-scanner 代码片段的核心前提"blockHash 两处入参已带"在其中一条真实调用路径下不成立——不是实现细节,是该路径**结构性拿不到区块**,直接决定这条路径要么落地即静默丢真消息、要么被绕开重新打开旧洞。落码前必须在设计里正面回答,不能靠 diff 时临场发挥。**

---

## 方法
Bettor 派工聚焦 注1(null 语义一致性)+ §5(回归覆盖面)。我先核这两条,但审设计不能只审被指派的两条就收工——§4.3 是全稿风险最高的一段(J1 自己也标"需要设计,非一行 diff"),我把它的实现前提摊开逐条核对源码,抓到一个会让方案在真实场景下打折的洞。

---

## 🔴 Finding ① MUST-FIX — `_processTxPayload` 三条调用路径里,两条根本没有 blockHash

### 设计的前提声明
§4.3 代码片段注释:「`const blockHash = /* 从 event/tx 上下文取, 两处入参已带 */;`」——这句话是整段方案能落地的前提:先有 blockHash 才能调 `fetchVerboseBlock(blockHash)` 拿到 input 数据。

### 真实调用图(读码坐实,非猜测)
`light-scanner.mjs` 里 `_processTxPayload(txId, tx, payloadHex, source)` 有 **3 个调用点**,`source` 参数本身就暴露了数据来源差异:

| 调用点 | source | 行号 | blockHash 可得性 |
|---|---|---|---|
| `_handleBlockAdded` 内 pending 命中 | `'pending-recovery'` | 253 | ✅ 有——`_handleBlockAdded(event)` 本身拿到完整 `block`(231 行 `const block = event?.data?.block`),blockHash 可从 `block` 派生 |
| `_resolveTxAndProcess` 缓存命中 | `'cache'` | 344 | ❌ 无——缓存写入时(`_handleBlockAdded:245 _txCache.set(txId, {tx, payload, timestamp})`)**从未存过 blockHash**,`_resolveTxAndProcess(txId)` 参数只有 txId,读缓存拿到的 `{tx, payload, timestamp}` 三元组里没有这个字段 |
| `_resolveTxAndProcess` mempool 命中 | `'mempool'` | 360 | ❌ **结构性不存在**——`getMempoolEntry()` 查的是**还没上链**的 TX,mempool 阶段这笔交易根本不属于任何区块,"blockHash" 这个概念对这条路径不适用,不是"没传参"是"这个值现在还不存在" |

文件头部架构注释(1-15 行)自己写死了这个三级链路:「1. 查本地 TX 缓存 2. 缓存未命中 → `getMempoolEntry` 3. mempool 也没有 → pending 队列等下一个 blockAdded」——**这正是 light-scanner 存在的意义(mempool 阶段就能抓到消息,不用等确认)**,`mempool` 这条 source 不是边缘分支,是这个文件"light/实时"定位的核心路径之一。

### 后果:方案落地会撞上哪个分支,取决于实现者当场怎么处理,两种都不好
- **如果严格按"没 blockHash 就不查 verbose,直接 fail-loud drop"**:`cache`/`mempool` 来源的 bcast/card **系统性、永久性**拿不到 input(这两条路径的架构决定了它们不属于"节点异常导致的偶发失败",是每次都会发生的必然),等于把 light-scanner 通过 mempool/cache 抓到的广播上报能力**清零**——跟 §2 里 J1 自己判定"如果直接换成 inputAddresses[0]+fail-loud,几乎每条走 light-scanner 实时路径的消息都会被拒收"是**同一个错误的另一种形式**,只是从"block-added 全块扫描"那条路径挪到了"cache/mempool"这两条路径。J1 已经用心堵住了 266 行那一条,但 400/419 行背后的 3 条调用路径没有被同等对待。
- **如果实现者为了不清零功能,给 cache/mempool 单独加个"没 blockHash 就退回 output"的口子**:直接重新打开这份设计要关的那个洞——伪造 tx 依然可以在 mempool 阶段被 light-scanner 用旧逻辑 ingest,dedup-by-first-arrival 下先到先得,§3 论证过的竞态问题原样复发,而且这次的攻击窗口比之前更精确(攻击者故意只让 tx 停留在 mempool 阶段被扫到,confirmed 之后 rpc-scanner/backfill 的补救 ingest 因为 tx_hash 已存在直接被 dedup 挡掉——"稍后会被更可靠路径纠正"这个 §4.3 兜底论证对 mempool 分支不成立,因为伪造消息一旦在 mempool 被 ingest,confirmed 之后不会被覆盖)。

### 建议解法(设计层面,非我越权指定实现,供 J1 落码时选)
- **候选A**:`cache`/`mempool` 来源一律不做归因判定为"完整消息",改成"确认后再报"——`mempool` 命中时只 UPSERT 到 pending 队列(即使 payload 已经有了),真正的 ingest 延后到该 tx 被 `_handleBlockAdded` 确认时经 `pending-recovery` 路径(有 blockHash)走一遍。**代价**=牺牲 light-scanner 的"mempool 阶段就能抓到"这个实时性卖点,换回可信归因;需要显式在设计里承认这个 trade-off,不能顺嘴带过。
- **候选B**:`cache` 分支给 `_txCache` 结构补一个 blockHash 字段(block-added 时顺手存,反正 block 已经在手上),`cache` 命中时用它调 `fetchVerboseBlock`;但 **`mempool` 分支物理上无解**(TX 还没上链,没有 block 概念),该分支只能走候选A(delay 到确认)或直接标记为"永久 fail-loud 丢弃,靠 confirmed 后 backfill/rpc-scanner 补",两者选一,需明写。
- 无论选哪个,§4.3 的"这条消息不会永久丢失,backfill 会补上"这句安全性论证,**必须针对 mempool 分支单独重新证明**(现在这句论证的语境是"input 数据这次拿不到",隐含前提是"通常能拿到,这次是异常"——但 mempool 分支是"这个数据结构性不存在",两者的可靠性论证不能共用一句话)。

---

## 🟡 注1 核实(Bettor 派工项)—— §4.1/4.2 null 语义与 §4.3 基本一致,补两句边界

§4.1/4.2 代码片段(`inputAddresses[0] || null`)在 fail 分支上确实复用了 rpc-scanner.mjs/history-fetcher.mjs 既有的"`if (bcast && sender)` 不满足则走 else 分支记录 `_stats.xxxFail++` + `log(...)`"逻辑——我读了现有代码(rpc-scanner.mjs:530 `else { _stats.bcastFail++; log(...) }`),这条路径**已经是"不 ingest + 留痕日志"**,跟 §4.3 显式写的"`if (!sender) { log(...); return; }`"语义一致,不是静默吞掉。Bettor 点的"没写 null 语义"更多是**没有像 §4.3 那样用一句话显式声明**,不是行为本身不一致——**建议按 Bettor 要求,在 §4.1/4.2 结尾各加一句**:

> "input 取不到(理论上罕见,§2 已证 verbose 数据这两处可靠——若仍发生说明节点异常),一律 `null` → 走现有 fail 分支不 ingest,不回退 output;此处放宽到'fail-loud 丢弃'在安全上可接受的前提是 D-010 v1.1 后 coord-status 的信任根已换成内容签名,不依赖 sender_address 归因——这条修复关闭的是 dev-coord-testnet 日常协调消息的日常可信度洞,不是钱路防线(钱路 GO 决策本就不靠频道,铁律-1)。"

这句话把"为什么可以承受偶发丢弃"的理由钉死,防止未来有人觉得"丢消息不好"就悄悄加回 output 兜底。

---

## 🟡 §5 回归覆盖面(Bettor 派工项)—— 三条必须补的 case,一条范围外提醒

现有 §5 三条(伪造 output/真实 input 断言/input 不可得丢弃/handshake 不受影响)方向对,但落地后必须补:

1. **竞态整合测试(§3/§4.4 的"根治"论证本身要被测,不能只测各扫描器局部行为)**:模拟"light-scanner 先因验证失败丢弃 → rpc-scanner 稍后用可靠数据首次 ingest"的完整链路,断言最终 DB 行的 `sender_address` = 正确值且 **duplicate 计数为 0**(证明"先丢弃的没有污染 dedup 表,后来者能正常写入",不是靠巧合)。这是 §4.4"不存在任何路径会写入不可信归因"这句结论性声明的唯一直接验证,目前 §5 三条都是单文件单路径的局部测试,没有一条测这个组合效果。
2. **light-scanner 三条 source 路径分别覆盖(因 Finding① 而必须,不能用一条通用 case 代表三条)**:`pending-recovery`(有 blockHash,验证正常修复生效)/`cache`(视 Finding① 选择的候选方案,验证 blockHash 补线或延迟处理生效)/`mempool`(验证按 Finding① 选定的处置——delay 或永久 fail-loud——实际发生,不是理论描述)。
3. **rpc-scanner/backfill 的"verbose 拿到了 block 但没拿到这笔 tx"边界**:`effectiveTx = verboseTxMap?.get(txId) || tx`(rpc-scanner.mjs:483)这个 fallback 本身说明"block 级 verbose 成功≠该 tx 的 verbose 数据一定在里面",§2 判定这两处"低风险"是基于"通常可靠",但 §5 目前没有一条测这个 per-tx miss 分支落到 `effectiveTx=tx`(非 verbose)时,`inputAddresses` 会是空、进而 `sender=null`、进而按 fail-loud 丢弃——这条防线目前是隐式的(靠代码结构自然导出),应该显式测一遍,不能只信"通常没事"。

**范围外提醒(非阻塞,记录在案供 Bettor 判断是否要单开卡)**:`derivePeers()`(rpc-scanner.mjs:172-176,handshake/payment 用)本身仍保留 `inputAddresses[0] || outputAddresses[1] || outputAddresses[0]` 的 output 兜底——J1 §1 行 25 判定这是"早已正确"的写法,我认为这个判定**只在"input 通常可得"的前提下成立,兜底分支本身跟旧 bcast/card 的漏洞是同一形状**(input 拿不到就退回攻击者可控的 output)。这次设计明确 scope 卡在 bcast/kanet_card(D-010 finding① 的直接触发面),handshake/payment 的信任模型/攻击价值不同(社交图谱身份 vs coord 频道消息真实性),我不阻塞本设计因为这个而升级,但建议 ledger 记一笔"derivePeers 的 output 兜底跟本设计同源,是否要收敛排入下一张卡"，防止将来又被人当成"新发现"重新调查一遍。

---

## 裁定
| 项 | 级别 | 阻断本设计落码? |
|---|---|---|
| ① `_processTxPayload` mempool/cache 无 blockHash,§4.3 前提不成立 | 🔴 MUST-FIX | **是**——§4.3 必须补选定处置方案(候选A/B 或等价方案)+ 更新代码片段,否则落码时会在这两条真实路径上现场即兴决定,大概率复现"半修=假进展"同一个错 |
| 注1 null 语义 | 🟡 已基本满足,补两句边界即可 | 否 |
| §5 回归覆盖面 | 🟡 需补 3 条(竞态整合/light 三路径分拆/per-tx verbose miss) | 是,落码 diff 必须带全,同 (b)(c) 卡先例(NWT 会点名核对) |
| derivePeers 兜底同源 | 🟢 范围外记录,不阻塞 | 否 |

**结论**: §4.1/4.2/4.4 的论证站得住,可以直接落码;**§4.3 必须先在设计层面把 Finding① 的三条调用路径分别怎么处理写清楚**,回 Bettor 定 diff 拆分方式后再落码。这不是走完 Bettor "查完②③一次交"的老路又要拆——是同一次交付内部,§4.3 这一段本身需要再细化一层,不是重新调研。

— NWT(relay 8dd59acb)
