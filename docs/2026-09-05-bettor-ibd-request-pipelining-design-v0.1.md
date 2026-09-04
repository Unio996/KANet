# D-b · IBD 块体请求流水线（深度 2）设计 v0.1

Bettor `kanet-tn12-1c [4a17db]` · 2026-09-05T21:58Z · 状态：**v0.1.2 · NWT GREEN-conditional（`docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` 931762e0）· C1–C3 已落本稿 · 可派 J2 隔离构建 · 未部署（部署须 Owner GO）**（v0.1.1 = 吸收 NWT 预审 5(a)(b)；v0.1.2 = 吸收 C1–C3）
权威进度：`docs/iteration/COORD-LEDGER.md` (855)(856)。前置：D-a（fd 预算 + 共享块缓存·1b3046fb·live 27032）。

## 0. 一句话
IBD 块体阶段每批 99 块的周期 ≈ 6.7 s，其中 **4.2–6.6 s 是对端"收到请求 → 首字节"**（856 ①，n=5 实测，请求发出时刻由 p2pBytesTx 尖峰钉死），我方处理/传输/CPU/IO 都不在关键路径。
若该延迟是**每请求固定**（队列/锁/调度），把请求流水线化（第 k+2 批在第 k+1 批到货前就发）可把周期压到 ~3.5 s ≈ 块率 ×1.9；若是**按块读盘**（吞吐型），零收益。本设计 = 一次可回滚的客户端实验，不改协议、不改对端。

## 1. 现状（源码坐标 = `D:\rusty-kaspa-da` @ 1b3046fb）
- live 协议版本 9（`Registering p2p flows for peer 136.243.93.17:16311 for protocol version 9`）⇒ `protocol/flows/src/v9/mod.rs:26 body_only_ibd_permitted = true` ⇒ 走 `queue_block_processing_chunk_body_only`（`ibd/flow.rs:~997-1032`）：
  - 发 `make_request!(Payload::RequestBlockBodies, {hashes: chunk}, self.incoming_route.id())`；
  - 逐 hash `dequeue_with_timeout!(self.incoming_route, Payload::BlockBody)`（`DEFAULT_TIMEOUT` 120 s）→ `async_get_header(expected_hash)`（本地读）→ `validate_and_insert_block(block).virtual_state_task` 入 jobs。
- 主循环 `sync_missing_block_bodies`（`ibd/flow.rs:933-946`）：`chunks(IBD_BATCH_SIZE=99)`；先 queue 首批；然后 for 每批：queue(chunk_i) → `try_join_all(prev_jobs)` → 报进度 → prev=current。**含义：req_{i+1} 在 chunk_i 的 99 个 BlockBody 全部 dequeue 后才发**（接收 i 与处理 i−1 重叠，但**请求与接收不重叠**）。
- 对端 `v8/request_block_bodies.rs:30-42`：`loop { dequeue 请求 → for hash: async_get_block_body → enqueue 响应 }`。**逐请求顺序服务**，无批大小上限，无并发。
- 实测周期（856 ①）：请求在上一团结束后 0.2/0.9/0.2/1.6/5.6 s 发出；对端 6.6/4.2/5.5/4.7/5.9 s 后首字节；传输 ~1.2 s（TCP 慢启动翻倍形状）；bodies 在到货同时处理完。

## 2. 变更（只动客户端 `ibd/flow.rs`·一个函数）
`sync_missing_block_bodies` 改为"**请求提前一批**"：
```
iter = hashes.chunks(99)
send_request(chunk_0)
for i in 0.. :
    if chunk_{i+1} exists: send_request(chunk_{i+1})        # 提前发：此刻 chunk_i 尚未到货
    jobs_i = receive_and_queue(chunk_i)                    # 逐 hash dequeue BlockBody → get_header → validate_and_insert
    if i>0: try_join_all(jobs_{i-1}); report_progress(i-1)
    prev = jobs_i
try_join_all(prev); report_completion
```
实现上把 `queue_block_processing_chunk_body_only` 拆成 `send_body_request(chunk)`（只 enqueue 请求）与 `receive_body_chunk(chunk)`（只 dequeue+处理）；`queue_block_processing_chunk_full_block`（v7 路径）**不动**（v7 对端 = `RequestIbdBlocks` 无 request_id，本设计不覆盖，v7 保持原逻辑）。深度固定 2（在飞请求 ≤ 2）；不做自适应。

## 3. 安全性论证（每条都要 NWT 逐条判）
1. **顺序**：对端逐请求顺序服务、单一 TCP/h2 流、我方 `incoming_route` 按到达序出队 ⇒ chunk_{i+1} 的 BlockBody 只会在 chunk_i 全部之后到达。**依赖点措辞（NWT 5a + 红队 3.1 / J2 预读）**：响应带 response_id，router 先看 response_id（非 0 走 `routing_map_by_id`，落到 `make_request!` 登记的同一条 IBD route；`protocol/p2p/src/core/router.rs:377-382`），但**客户端不匹配单个请求**——`dequeue_with_timeout!` = 纯 `recv()`（`protocol/p2p/src/common.rs:184-192`）；所以顺序安全**完全依赖对端 `HandleBlockBodyRequests` 单循环顺序服务 + 对端单一 outgoing mpsc 保序**，这是唯一依赖——对端若有并发服务（非 v8 代码），会乱序 ⇒ `expected_hash` 不匹配 ⇒ 现有代码路径 `ProtocolError` 断连（fail-closed，不会误收）。
2. **超时**：单条 `dequeue_with_timeout` 120 s；流水线下 chunk_{i+1} 首条最坏等待 = 对端服务 chunk_i（~6 s）+ 自身延迟（~6 s）≪ 120 s。
3. **内存**：在飞最多 2×99 个 BlockBody（~1.2 MB）+ 对端最多多缓冲一批；可忽略。
4. **对端负载**：对端每单位时间多服务一倍请求 **只在对端延迟是固定型时发生**；若对端是吞吐型，流水线只是把等待挪到对端队列，块率不变、对端不多做功。无 DoS 面（同一 peer、同一批大小、同一总量）。
5. **回滚**：换回 D-a exe（`D:\rusty-kaspa-da\target\release\kaspad.exe` 当前 sha B73F1415…）重启；datadir 不受影响（纯网络层）。
6. **与 IBD 其它阶段无交互**：headers / pruning proof / UTXO set 阶段不动；仅 `sync_missing_block_bodies`。
7. **Ban 风险**：对端对 `RequestBlockBodies` 无速率/并发检查（v8 handler 只 loop dequeue；grep ban/misbehav 只有 TODO——NWT）；对端请求 route 256/Disconnect，2 条远低；对端 outgoing 通道 (1<<17)+256 条（`connection_handler.rs:183-186`），198 条不构成 Full；2 个在飞请求与 2 个独立 syncer 各发 1 个在对端视角等价。
8. **C1 硬不变量（NWT 红队 + J2 预读独立同发现）**：我方 IbdFlow 的 incoming_route 用 `router.subscribe(...)`（`v9/mod.rs:32`）= 基线容量 **256**（`router.rs:297-299`）；BlockBody 溢出策略 = **Disconnect**（`router.rs:82-88`，只有 Inv 两类是 Drop）⇒ 满一条即 `IncomingRouteCapacityReached` 断连、IBD 重协商（本机 header 相位重来一次 = 数小时）。消费端每条只做 `async_get_header`（本地读）+ 投递到 unbounded crossbeam（`consensus/mod.rs:203-206`，不背压），正常不堆积；最坏（压实停顿卡住 `async_get_header` 几秒）两批全堆在 route = **2×99 = 198 < 256，余量 58**。**⇒ 深度 2 与 batch 99 是一对硬约束：改任一都必须重算 `depth×batch + 同 route 其它类型 < 256`；深度 3 = 297 > 256 必自断。不做自适应。** 不扩 route 容量（NWT 不建议；J2 提的 `subscribe_with_capacity(512)` 保险记录为备选，本版不采，理由 = 最小 diff、余量已由 unbounded 消费端保证；若试验中出现 C2 的 `IncomingRouteCapacityReached` 再启用）。
9. **3.2 残余（NWT）**：若对端是吞吐型且每批 >60 s，深度 2 把单条等待顶到 120 s 超时 ⇒ IBD 重来。列为回滚触发（§4）。

## 4. 判据（部署后 30 min 内可裁·全部现有只读仪器）
- **首要判别（NWT 5b·分"对端空闲等待"与"对端逐请求串行忙时"）**：p2p 100 ms 时间线上，第 2 个请求（在第 1 团到货前已发）对应的团，其**首字节是否紧接第 1 团末字节**（间隔 ≤ 1 s ⇒ 延迟可重叠 ⇒ 流水线有效），还是**再等 4–6 s**（⇒ 逐请求串行固定成本 ⇒ 无效，立即回滚 D-a exe，不留）。
- **中间态**：第 2 团首字节在第 1 团末字节后 1–4 s = 部分重叠 ⇒ 有效但期望值下调到实测（不按 ×1.9 报）。
- **C2 立即回滚字符串（不等 20 min）**：我方 kaspad 日志出现 `IncomingRouteCapacityReached`（C1 被打破的唯一签名）或 `syncee inconsistency` / `expected block … but got` 不匹配 ⇒ 立即换回 D-a exe 重启；另：单批 >60 s 导致 `Timeout` 断连 IBD 重来（§3.9）⇒ 同样回滚。
- **主判据**：`scratch/_bettor_p2p_bytes_timeline.mjs` 100 ms 时间线——请求尖峰（tx≈3.4 KB）之间的间隔与到货团间隔。**GO 保留**：团间隔中位 ≤ 4.5 s（现 ~6.7 s）且 `Processed N blocks/10s` 30 桶均值 ≥ 20 blk/s（现 12–14）；**回滚**：均值 < 12 blk/s 持续 20 min，或任何 `expected block/header mismatch` / `ProtocolError` 断连。
- **对照口径**：只与切换前后同为"干净 body 相位"（无压实簇、无剪裁遍历、无断连）的 10 min 窗比；A 基线 14.43 / D-a 两窗 13.63、12.92（856）。
- **副作用监视**：断连率（基率 0.43/天·切换后已 7 次）、kaspad WS/句柄（D-a 后 20–22 GB / 16.3k）、console 停顿（M10 v2 行）。

## 5. 流程与闸
- Bettor 设计（本文）→ **NWT 红队**（§3 逐条 + 一条：对端延迟"固定型 vs 吞吐型"的独立判据）→ **J2 隔离构建**（`D:\rusty-kaspa-da` 新分支 `j2-db-ibd-pipeline`，基于 1b3046fb；产物 sha + provenance 目录同 D-a 格式；**不部署**）→ **部署 = 节点二进制换代 = Owner GO**（838 边界；Owner 离场期间只备不换）。
- 不改 `IBD_BATCH_SIZE`（改大批 = 对端视角的协议行为变化，风险面不同，另案）。
- 期望值口径：**块率 ×1.0–1.9 之间**，上界仅在"固定型延迟"下成立；不承诺。

## 6. 未知 / C3 三候选 / J2 实现注意
- 对端为何每请求 4–6 s：对端 `async_get_block_body` 逐体 `spawn_blocking`（`session.rs:387-389`·NWT 核）+ `unguarded_session`（不持剪枝锁）；它同时服务另外 3 个未同步 TN12 节点 + 自身 10 blk/s 处理。**C3（NWT）：事前分不出**，但"静默 4–6 s 后 1 s 成团"说明延迟在**第一体之前**，候选三个：(a) 请求在对端 route 排队；(b) 对端阻塞池整体饱和；(c) 首体冷读。(a)(b) 可与下一请求重叠 ⇒ 流水线有效；(c) 不可。试验结果（§4 首要判别）回头判是哪个，写回本节。
- **J2 实现注意（NWT 红队稿 §6，四条）**：① `daa_score`/`timestamp` 取**收到的那批**（chunk_i）的末块，不取提前请求的批；② `try_join_all(prev_jobs)` 位置不前移（仍在接收完 chunk_i 之后）；③ 错误路径无需特判（任何 dequeue/校验错都是现有 `ProtocolError` 断连 fail-closed）；④ 分支 `j2-db-ibd-pipeline` 基于 **1b3046fb**（别丢 D-a 的 fd 补丁与共享缓存）。
- 构建排期：D-a 全量 3 min 13 s / 增量 2 min 21 s（J2 provenance 实录）；D-b 只动 `protocol/flows` ⇒ 增量 ≤3 min，排期留 5 min。产物 sha + provenance 目录同 D-a 格式；**不部署**。
- 我方 `async_get_header(expected_hash)` 每块一次本地读，流水线后仍在接收循环内串行；若它成为新瓶颈（块率卡在 ~20 而非 ~25），下一版再批量化（源码 TODO 已注明）。
