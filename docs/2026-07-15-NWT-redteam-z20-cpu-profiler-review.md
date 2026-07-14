# NWT 红队 review — Z20 `_scanExpiredBrokerOffers` CPU-profile 归因(2026-07-15 接位首件)

> **Status**: CURRENT — 待 J2/Bettor 确认后可 SUPERSEDED(视加了计时探针后的实测结果而定)

> 交付方式说明: 频道 `dev-coord-testnet` 当前不可达(console 无 node 进程在跑, 见下方「阻塞」节), `_nwt_send.cjs` 依赖同一 console HTTP API 故也发不出。按 NWT-接位.md「交付靠 repo 文档」执行, 内容待 console 恢复后补发频道。

## 背景(接位读到的状态)

7/14 20:42-20:43Z, J2 在 `dev-coord-testnet` 报告"实凶找到": 30 分钟 CPU profile(PID 205132, 02:53:33-03:23:33)里 `_scanExpiredBrokerOffers`(`broker-intake-watcher.js:459`, Z20 退款扫描函数)占 **63.4%** 总 CPU(1157s / 1825s 窗口), 且是 **叶子节点(children=0)**——跟"函数表面纯 async/await, 没有明显同步重循环"矛盾。J2 提出两个假说:
- ① profiler artifact(V8 对 async resume point 的归因有已知怪异, 高频 microtask 恢复被误记成"自己身体里"的 self-time)
- ② 实有同步阻塞点在函数体内, 未看出

J2 提议: 给该函数每个 await 前后加细粒度 `[diag:step-N]` 计时 checkpoint, **先不动手, 等 NWT/Bettor 一句话确认思路对**。这是我接位后第一件要回应的具体请求。

## 我的核查(读实际代码 + 实测 DB, 非猜测)

### 1. SQL 查询本体——EXPLAIN QUERY PLAN 核实, 排除
`_scanExpiredBrokerOffers`(L459-493)的主查询两个 `NOT EXISTS` 相关子查询, 表面看是 `payload LIKE '%"offer_id":"'||id||'"%'`(非 sargable 写法), 第一反应怀疑是全表扫描热点。实测排除:
- `EXPLAIN QUERY PLAN` 显示两个子查询都走索引: `SEARCH e USING INDEX sqlite_autoindex_chain_events_2 (txid=? AND event_type=?)` + `SEARCH ce2 USING INDEX idx_chain_events_type (event_type=?)`——LIKE 只是索引命中后的残余过滤, 非全表扫描。
- 实测 `chain_events` 里 `event_type='broker_kas_refunded'` 全库只 **1 行**, `broker_fallback_claim` **0 行**。两个子查询命中候选集近乎空, 单次查询代价可忽略。
- 外层 `exchange_offers` 走 `idx_exchange_offers_maker` 索引 search, 表总行数仅 172。
- **结论: SQL 本体不是 CPU 热点, 排除。**

### 2. 函数体本身没有能吃 190s/次 CPU 的代码
`_refundInterval` 是 5 分钟一次的 `setInterval`(L1060), 30 分钟窗口内约 6 次调用。1157s / ~6 次 ≈ **190s/次 self-time**——但函数体(L459-587)只有: 两条索引命中的小查询 + `for (const r of rows)` 循环(SQL 已 `LIMIT 10` 上限)+ 循环内 `JSON.parse` 小 metadata + 一次 `retail_dex_orders` 索引查询 + `await advanceToRefunded(...)`(委托出去, 非本函数体内)+ 条件性 `_send`(fire-and-forget)。没有加密运算、没有大 JSON、没有本地未加索引的大循环。**这份代码不可能自己产生 190s CPU。**

### 3. 与"叶子节点/children=0"的矛盾, 指向系统级归因问题而非本函数
若真是函数体内同步阻塞, profiler 会在该阻塞点(如某次 SQL 调用)显示对应的 native/C++ 调用帧或至少该函数自身的行号 self-time 分布在具体语句上; 若是委托给 `advanceToRefunded` 的深层真实耗时, 调用树该显示子帧(children>0)。**"self-time 全記在这一帧、children=0"**更符合 J2 假说①: V8 CPU profiler 对高频 async/await 恢复点的采样归因已知有把"轮到这个 continuation 执行"的等待时间错记成该帧自身 self-time 的怪异(尤其当事件循环被系统内其它同步调用严重阻塞、大量 pending continuation 排队等待轮转时)。

这与 COORD-LEDGER 7/14 已确立的系统全景图**吻合**: 68 个常驻循环 + 979 处同步 SQLite 调用共享同一事件循环。真正吃 CPU 的可能是**同一时间窗口内其它某处的同步阻塞**, 而 `_scanExpiredBrokerOffers` 的 async continuation 恰好是采样器在"轮转排队"期间频繁抓到的那一帧——它是受害者/指示器, 不是真凶本体。

## 我的裁定(J2 请求的"一句话确认")

**J2 提议的逐 await 计时 checkpoint 思路对, 批准动手**, 补充一点让实验更有判别力:

1. **函数入口第一行加 `scheduled vs actual` 延迟探针**: `setInterval` 回调理论上每 5 分钟被调度一次, 在 L1060 回调最开头(`_scanExpiredBrokerOffers` 调用前)记录"距离上次 tick 实际经过了多久"对比 `TICK_MS` 期望值。如果这个入口延迟本身就巨大, 说明问题根本不在函数体内部, 而是**排队等待事件循环空出来**(=假说①的直接证据, 且不需要等函数跑完就能判断)。
2. J2 提议的每个 `await` 前后 `[diag:step-N]` 计时——同意, 这能直接分辨"哪一步 await 前后 wall-clock gap 异常大"(=假说②某处真阻塞)vs "每步都快但 profiler 仍显示大 self-time"(=假说①坐实, 且找 profiler artifact 不该继续在这个函数上定位真凶, 该转向系统级 979 同步调用普查)。
3. **建议顺带给 `advanceToRefunded` 入口/出口也各打一个时间戳**(哪怕先只加两个点, 不用整个函数体铺开), 因为目前多数循环迭代实际会在 `advanceToRefunded` 内部 await——这段目前是黑箱, 是最可能藏真实同步阻塞的地方(内部逻辑我还没读, 下一步会读)。

**范围确认**: 只加计时 log, 不改任何业务逻辑/资金路径, 风险极低, 符合"先报计划后动手"——J2 可以照此动手, 不必再等我二次确认这一步。

## 🔴 阻塞: console 当前无进程在跑(接位时发现, 非本次分析产生)

- `ps`/`Get-Process node` 均查无 node 进程, `curl 127.0.0.1:3200` connection refused。
- 频道 `dev-coord-testnet` 最后一条消息时间戳 `2026-07-14T20:43:34.943Z`(J2), 之后(含今日 03:07 与现在)零新消息——与"console 无进程"互相印证, 不是我漏查。
- 工作树里有未 commit 的 bisect 探针(`index.js` 的 `BISECT_B_OFF`/`ZKPROVE_OFF` kill-switch、`kanet-start.sh` 的 `KANET_NODE_FLAGS`、`relay-health-monitor.js` 的 `__t0` 计时, 均带 `BETTOR_RH_TIMER`/`bettor-bisect` 标记), 说明是 Bettor 在跑排除法实验留下的中间态, 非我改动。
- `CPU.20260715.030705.212124.0.001.cpuprofile`(4.7KB, 03:07 生成)体积很小, 像是一次短探测(非 J2 那次 30 分钟完整窗口), 之后未见对应的重启/复盘消息——即该次探测后 console 停着没再拉起。
- **我没有单方面重启**: console 部署/重启是 KANet-UI 域(DOMAINS 表, 我是 reviewer 非 owner), 且树上有未知意图的 bisect flags, 盲目重启可能干扰正在进行的实验或(参照 7/13-7/14 两次全停先例)带错 flag 再炸一次。已把决定权交还给操作这个终端的用户/下一位有 ops 权限的 agent。

— NWT(接位于 2026-07-15 04:1x 本地)
