# NWT 红队 — D-b「IBD 块体请求流水线（深度 2）」设计 v0.1.1 的裁定

> NWT · 2026-09-04T21:43Z · 输入 = `docs/2026-09-05-bettor-ibd-request-pipelining-design-v0.1.md`（af1f3444）· 源码坐标全部我亲手 `sed/grep` `D:\rusty-kaspa-ctl` @ 7b1e18cc（与 1b3046fb 的差异只在 fd_budget/rocksdb 两处，p2p/flows 未动）· 只审不改 · 部署 = 二进制换代 = Owner GO。

## 0. 裁定
**GREEN-conditional**：设计可交 J2 隔离构建，条件 = 下面 C1–C3 写进设计稿 v0.1.2 后再动手；C1 是硬不变量，缺了它"深度 2"是碰巧安全而不是被证明安全。

## 1. 硬不变量（C1）：深度 ≤ 2 由我方 incoming route 容量 256 + Disconnect 策略决定
- `p2p/src/core/router.rs:297-299` `incoming_flow_baseline_channel_size() = 256`；`v9/mod.rs` IbdFlow 用 `router.subscribe(...)`（基线容量）。
- `router.rs:73-89`：溢出策略只有 `InvTransactions | InvRelayBlock` 是 Drop，**其余（含 BlockBody）= Disconnect**；`router.rs:384-394`：`try_send` Full ⇒ `IncomingRouteCapacityReached` ⇒ **我方主动断连**。
- 最坏排队量：我方出队循环每块要 `async_get_header` + `validate_and_insert_block` 提交，后者遇共识流水线背压会停下出队；此时 route 里可堆 chunk_i 未出队的 99 + chunk_{i+1} 到货的 99 = **198 < 256（余量 58）**。深度 3 = 297 > 256 ⇒ 必然自断。
- ⇒ 设计稿须写明：**深度 2 与 IBD_BATCH_SIZE=99 是一对，二者任一改动都要重算 `2×batch + 同 route 其它类型 < 256`**。不建议为此把 route 扩容（扩 = 改第二处、风险面另算）。

## 2. §3 七条逐判
| # | 判 | 备注 |
|---|---|---|
| 3.1 顺序 | **成立，但依赖点措辞再改一次** | 响应**不是**"只按 payload 类型分发"：`router.rs:378-382` 先看 `response_id`，非 0 ⇒ 走 `routing_map_by_id` ⇒ 落到 `make_request!(…, self.incoming_route.id())` 登记的那条 IBD route。客户端仍不匹配单个请求（纯 `recv()`），顺序完全靠对端 `v8/request_block_bodies.rs:31-40` 单循环顺序服务 + 对端单一 outgoing mpsc（`connection_handler.rs:124/215`）保序。乱序 ⇒ `expected_hash` 不匹配 ⇒ `ProtocolError` 断连，fail-closed，同意。 |
| 3.2 超时 | 成立，加一条残余风险 | 深度 2 下 chunk_{i+1} 首条最坏等待 ≈ 对端服务 i + i+1 ≈ 12 s ≪ 120 s（余量 10×）。**残余**：若对端是吞吐型且负载升到每批 >60 s，深度 2 把等待翻倍到 120 s ⇒ 超时断连 ⇒ IBD 重来（~30 min）。现 4.2–6.6 s，写进回滚触发即可。 |
| 3.3 内存 | 成立 | 2×99 体 ≈ 1.2 MB；对端 outgoing 通道 `connection_handler.rs:183-186` = (1<<17)+256 = 131,328 条，198 条不构成 Full。 |
| 3.4 对端负载 | 成立 | 对端每体 `spawn_blocking`（`session.rs:387-389`，tokio 阻塞池）、`unguarded_session()`（`request_block_bodies.rs:35`，不持剪枝锁）；流水线有效时对端请求率 ×≤2，等价于第二个 syncee。 |
| 3.5 回滚 | 成立 | 纯网络层；datadir 不变；换回 B73F1415 exe。 |
| 3.6 阶段隔离 | 成立 | 只动 `sync_missing_block_bodies` + body-only chunk 拆分；`queue_block_processing_chunk_full_block`（v7）不动。 |
| 3.7 ban | 成立 | `grep ban|misbehav` 在 flows/ibd、p2p/core、flow_context 只有 TODO；对端 `RequestBlockBodies` route 容量 256/Disconnect，2 个在飞请求远在其下；无 per-flow 限流。 |

## 3. Bettor 两问
- **① v7 是否同改**：**不动**。live 对端 protocol 9（日志 `Registering p2p flows … protocol version 9`），`v9/mod.rs:26 body_only_ibd_permitted=true`；v7 路径只在对端协议 7 时被选，按版本注册二选一，不对称不会互相影响；最小 diff 原则。若日后镜像到 v7，C1 同样适用（IbdBlock 每批 99 条，同 route）。
- **② 对端侧会丢/ban 第 2 个在飞请求的状态**：源码里**没有**。对端三处容量：请求 route 256（Disconnect，2 条远低）、outgoing 131,328、阻塞池无上限配置；无速率检查。唯一会让对端断我们的是它自己的 `enqueue` Full（131,328，不可能）或 `async_get_block_body` 返回 Err（体已剪/不存在——与现状同）。

## 4. §4 判据补两条回滚字符串（C2）
- 我方日志出现 `IncomingRouteCapacityReached`（C1 被打破的唯一签名）或 `syncee inconsistency` / `expected block` 不匹配 ⇒ 立即回滚，不等 20 min。
- 首要判别（第 2 团首字节紧接第 1 团末字节 ≤1 s vs 再等 4–6 s）保留；加一条**中间态**：若间隔落在 1–4 s，记"部分重叠"，仍算有效但把期望值从 ×1.9 下调到实测。

## 5. §6 事前判别（C3）：我方观测确实分不出固定型/吞吐型
对端路径 = 单循环 → 逐体 `spawn_blocking` → 逐体 enqueue。若延迟是每体阻塞池排队，字节应从请求后不久开始**滴流**；Bettor 100 ms 时间线是"静默 4–6 s 后 1 s 成团"⇒ 延迟发生在**第一体之前**（请求在对端 route 里排队、或对端 tokio 阻塞池整体饱和、或首体冷读）。三者里前两者可重叠（流水线有效），第三者不可。**我方拿不到对端内部状态，同意 §6：只有试验能分**——设计稿把这三个候选写进 §6，试验结果反过来告诉我们是哪个。

## 6. 给 J2 的实现注意（不改设计，防拆函数时掉东西）
- 拆 `queue_block_processing_chunk_body_only` 时 `current_daa_score/timestamp` 必须来自**收到的** chunk（用于进度报告），不是发出的。
- `try_join_all(prev_jobs)` 的位置与现状一致（收完 chunk_i 后 join jobs_{i-1}），不要提前到发请求前——提前 = 请求与处理串行化，把流水线又拆掉。
- 错误路径：chunk_i 处理 Err 返回时 request_{i+1} 已发，对端会往已关闭的连接推 99 条体——无害（`try_send` Closed ⇒ 对端自己断），无需特判。
- 产物 sha + provenance 目录同 D-a 格式；D-b 分支基于 1b3046fb 而非 7b1e18cc（否则丢 fd 补丁）。

## 7. 未核
对端实际部署版本是否与 v8 handler 一字不差（只能从协议版本 9 推断）；对端阻塞池线程数配置。
