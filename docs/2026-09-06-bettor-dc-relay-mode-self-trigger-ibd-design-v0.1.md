# D-c 设计 v0.1 · 中继模式掉队的根治：IbdFlow 内"落后超阈自触发小轮 IBD"（kaspad 补丁）
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T22:3xZ · 只设计不写码 · 交 NWT 红队 → J2 实现 → 独立目录构建 → Owner GO 切换
权威数据：`docs/iteration/COORD-LEDGER.md` (947)–(958)；源码坐标一律 `git show 7b1e18cc:<path>`（活二进制 = 7b1e18cc + D-a 1b3046fb + D-b 4d0a9e30）；J2 笔记 `scratch/_j2_dc_relay_request_scope_notes_2026-09-06T20-55Z.md` §3b/§5/§6/§7；NWT `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` §14–§16。

## 0. 一句话
READY 后节点在中继模式对唯一 syncer 只能拿到 **0.75 bps**（链 10 bps），isSynced 每次 IBD 后只维持 ≈11–15 min，然后掉队 ≈50–60 min 才由孤儿超 locator 自触发一次 ≈43 min 的 IBD ⇒ **synced 占比 ≈10%**，console 全部 ③ 门随之只开 10%。修法 = 在 kaspad 的 IbdFlow 里加一个"落后超阈就主动向 syncer 取它的 sink 并起小轮 IBD"的分支，把掉队时长从 ~60 min 压到阈值（默认 5 min），IBD 因落后小而只需 ~2–3 min ⇒ synced 占比 → ≈95%+。

## 1. 实测事实（今晚·全部可 grep）
| 量 | 值 | 出处 |
|---|---|---|
| 中继进块 | 45 块/min = 0.75 bps，恒定 | ledger 948；`Accepted N blocks … via relay` |
| 对端投递形状 | 每 ≈6.7–7 s 一簇 3–5 块 + 同簇 inv 3–5 条；簇间 ≈102 B/s | J1 pktmon 21:04Z；p2pBytesRx 100 ms 线；NWT §15 |
| sink 落后增速 | +0.93 s/s | `_bettor_sink_lag_timeline.mjs` 20:36–20:41Z |
| isSynced true 维持 | 15.0 min（门 21:59:20→22:14:20Z），READY 签名后 9.3 min | NWT §16 ③ |
| 自触发 IBD 触发点 | READY+63 min（21:22:03Z；孤儿缺根 3→40 升级超 locator） | ledger 952 |
| 自触发 IBD 全程 | 43.0 min / 4 轮（33,447 → 14,020 → 6,255 → 3,264 块） | ledger 955/956 |
| 头部重议成本 | ≈4.2 min/链时 + ~1 min 固定 | NWT 曲线 |
| 外部 bounce（封 30 s） | 断得了（我方 RST）；回连罚时 2 min 59 s（对端 `PeerAlreadyExists` 旧会话未清）；回连→IBD started 7 s | ledger 958 |

## 2. 机制（源码 7b1e18cc）
- 中继流 `protocol/flows/src/v7/blockrelay/flow.rs` 主循环**串行单 inv**：`invs_route.dequeue()` → `request_block()`（:237–256，`RequestRelayBlocksMessage { hashes: vec![requested_hash] }` 一次一个）→ `dequeue_with_timeout!(Payload::Block)` → 处理 → 下一个。对端 `handle_requests.rs:43–47` `for hash in hashes` 支持多 hash，但**未知 hash ⇒ `?` 整 flow 报错退出**（J2 §3b）。
- inv 队列 `block_invs_channel_size = bps × 256 = 2560`（`flow_context.rs:347`），溢出 **Drop**（`router.rs:86`）。
- IBD 只由孤儿触发：`process_orphan`（:265–310）→ `check_orphan_ibd_conditions`（窗 (R−M/10, R+M/2)，M=min(2^9×124,1024)=1024）→ `check_orphan_resolution_range`（locator limit 9 ≈ 511 blue score ≈ 51 s 链）→ 否则 `try_trigger_ibd(block)` 送 `ibd_sender`。
- `IbdFlow`（`protocol/flows/src/ibd/flow.rs:93–110`）：`while let Ok(relay_block) = relay_receiver.recv()` → `try_set_ibd_running(key, relay_block.daa_score)`（全局 CAS 单守卫）→ `ibd(relay_block)`：`negotiate_missing_syncer_chain_segment`（一条 `RequestIbdChainBlockLocator{low:None,high:None}` 往返；`syncer_virtual_selected_parent = locator[0]` = **对端 sink，不需要 relay block**，J2 §5）→ `determine_ibd_type`（对端剪枝点仍在本地 DB ⇒ `Sync` 小轮；落后 ≥ pruning_depth 1,080,000 块 = 30 h 才 headers-proof，J2 §6）→ `sync_headers(…, &relay_block)` → 体。
- 对端只在连接建立时发一次自己 sink 的 inv（`handle_requests.rs:36–39 send_sink`）⇒ 重连 = 现成触发路径（bounce 用的就是它）。

## 3. 候选与取舍
| 修法 | 原理 | 依赖 | 缺点 | 裁 |
|---|---|---|---|---|
| (1) relay 请求批量化 N hash | 对端每簇 flush，一次带 N 个 hash ⇒ N 块/簇 | A′（inv 随簇到达）成立（已证：簇内 inv 3–5） | 只能含该 peer inv 过的 hash；响应按 hash 配对、超时语义、scope 一 hash 一个（J2 §3b 8 条坑）；**N 上限 = 每簇 inv 条数（3–5）⇒ 收益 ≤ 5×，到不了 10 bps** | **不做为主修**；可作后续优化 |
| **(b) IbdFlow 自触发** | 落后超阈 → 取对端 sink → 取块 → CAS → `ibd(block)` | 只依赖 IBD 路径（已实测 30 blk/s、几何收敛） | 每 peer 一个 IbdFlow（坏 peer 退避）；IBD 体相位带一次 relay 扇入风暴（R-1） | **主修** |
| (c) 外部 bounce（防火墙 / `ban`） | 断连→重连→send_sink inv→IBD | 防火墙需提权、罚时 3 min；`ban` 需 `--unsaferpc`（Owner 安全面） | 周期成本 3 min + 小轮；自动化需日志闸判 IBD 不在进行中 | **过渡兜底**，仅 Owner 批 `--unsaferpc` 后自动化；否则不做 |
| (3) 缩 inv 队列 | 翻转更快 | — | 只缩周期不解吞吐；仍是孤儿路径触发 | 不做 |

## 4. (b) 设计
### 4.1 落点与形（J2 §7）
`protocol/flows/src/ibd/flow.rs` `IbdFlow::start_impl`：把 `relay_receiver.recv()` 包成 `tokio::time::timeout(check_interval, …)`；超时分支 = 自触发检查。**零新订阅、零新消息、不经 ibd_sender**（`RequestIbdChainBlockLocator`/`IbdBlock` 订阅本就归 IbdFlow 独占；relay flow 与"新起周期 flow"两候选因订阅冲突排除）。
```
loop {
  match timeout(check_interval, relay_receiver.recv()).await {
    Ok(Ok(relay_block)) => { /* 原逻辑不变 */ }
    Ok(Err(_)) => return Ok(()),           // channel closed，原逻辑
    Err(_elapsed) => {                      // 自触发检查
      if self.ctx.is_ibd_running() { continue }
      if self.backoff_until > now { continue }
      let lag = now_ms.saturating_sub(session.async_get_sink_timestamp())   // 与 is_nearly_synced 同源
      if lag < lag_threshold { continue }
      // 取对端 sink：复用 negotiate 的 locator(None,None) 首项
      let syncer_sink = match self.get_syncer_chain_block_locator(None,None).await { Ok(v) if !v.is_empty() => v[0], _ => { self.fail_backoff("locator"); continue } };
      // 取块：复用 sync_missing_block_bodies 已在用的 RequestIbdBlocks([hash]) → IbdBlock
      let block = match self.request_single_block(syncer_sink).await { Ok(b) => b, Err(e) => { self.fail_backoff("block"); continue } };
      // 先比再争：对端 sink 必须比本地 sink 新（blue_work 严格大；或 daa 差 ≥ 余量）
      if block.header.blue_work <= local_sink_blue_work { self.fail_backoff("not-newer"); continue }
      let Some(_guard) = self.ctx.try_set_ibd_running(self.router.key(), block.header.daa_score) else { continue }; // CAS 失败不排队 (d)
      info!("IBD self-trigger: sink lag {}s ≥ {}s, syncer sink {} (daa {})", …);
      match self.ibd(block).await { Ok(()) => { self.backoff = base }, Err(e) => { warn!(…); self.fail_backoff("ibd"); /* 不 return Err，不断连 */ } }
    }
  }
}
```
### 4.2 每 peer 规则（J2 §7③ (a)–(e)）
(a) 失败退避 ×2，上限 30 min，状态放 flow 实例（每 peer 天然独立）；(b) 取到对端 sink 块**先比再争**；(c) 取不到不争；(d) CAS 失败不排队（不往 ibd_sender 塞）；(e) 好坏 peer 不靠白名单——3 个拒我们的 churn peer（每 30 s 连/拒）由 (a)(b) 自然压到 30 min 一次，且它们 30 s 内就被对端关，多数时候根本活不到 check_interval。
### 4.3 可配（走 Config/CLI，同 `--rocksdb-cache-size` 路）
| 项 | 默认 | 说明 |
|---|---|---|
| `--ibd-self-trigger-lag-secs` | **300** | 阈值 < 661（isSynced 阈）⇒ 触发时 isSynced 仍 true，小轮 IBD 追平后不翻 false；0 = 关闭（回退到现行为） |
| `--ibd-self-trigger-check-secs` | 60 | timeout 间隔 |
| `--ibd-self-trigger-backoff-max-secs` | 1800 | 退避上限 |
默认关闭还是开启：**本补丁默认 = 300（开）**，但只部署在我们节点；上游提 PR 时默认 0。
### 4.4 日志（KANet-UI loop 可数）
每次自触发 / 失败(reason) / 退避各一行 `info!`/`warn!`，带 lag、syncer sink hash、daa、peer。
### 4.5 与现有机制的交互
- **孤儿池 R 窗**：`try_set_ibd_running` 写对端 sink 的 daa 当 R，与自然触发同语义（J2 §7②）。
- **relay flow :124** `is_ibd_running && !should_mine ⇒ continue`：IBD 期丢 relay inv 的行为不变；IBD 完成后 revalidate_orphans 把 R+M/2 窗内孤儿放出（现有）。
- **D-b 流水线**：同一 IBD 流，深度 2 / 198<256 不变；IBD 会话数 ×N ⇒ 三回滚串暴露机会 ×N，盯守照旧。
- **剪枝**：IBD 期剪枝 0 推进（ledger 957：READY 后 8.4 min 跑 458k）。阈 300 s + 小轮 ≈2–3 min ⇒ 每 ≈8 min 周期里剪枝有 ≈5 min 空窗；今天实测 100k/76–120 s ⇒ 每周期可推 ≈250–400k，够。
- **R-1 relay 扇入**：每次 IBD 体相位 = 一次 ~40 relay 同秒 POST 风暴（ingest 超时、fire-and-forget 丢）。**阈 300 s ⇒ 每 ≈8 min 一次风暴 = R-1 从偶发变常态。** 两条路：① 阈抬到 600 s（仍 < 661）⇒ 每 ≈13 min 一次、IBD 略长；② 先落 R-1 最小改（relay `post()` 有界重发队列）。**v0.1 取 ① 600 s 作为部署默认，② 另案**——红队请裁。
- **headers-proof 误入**：`determine_ibd_type` 已保证对端剪枝点仍在本地 DB 时走 Sync；阈值分钟级 ≪ 30 h，不会碰。
### 4.6 失败面
- 对端 locator/块请求超时 ⇒ `fail_backoff`，**不 `return Err`**（现 `ibd()` 出错会断连；自触发路径的错误不能拿来断唯一 syncer）。
- 自触发与自然孤儿触发同时：CAS 互斥，输者不排队；自然触发的 job 留在 ibd_sender 单槽事后补一轮（现有行为）。
- 唯一 syncer 断连期间：无 peer ⇒ 无 IbdFlow ⇒ 无自触发；重连后 send_sink 路径先于自触发（7 s）。
- 误触发（lag 读数错）：最坏 = 多跑一次几十秒的空 IBD（`determine_ibd_type` 发现无事可做即完成）。

## 5. 预期效果（规划口径）
周期 ≈ 阈 T + 小轮 IBD（头 ≈ T×4.2 min/h + 1 min 固定 + 体 T×10 bps/30 bps + 尾）：T=600 s ⇒ 头 ~1.7 min + 体 ~3.3 min + 尾 ~1 min ≈ **6 min**；周期 ≈ 16 min，其中 isSynced=false 只在 IBD 头部相位 sink 停滞时可能短暂出现（今晚 R3 体相位就把门拉开 = 负延迟）⇒ **synced ≥ 90%**（vs 现 ≈10%）。T=300 s ⇒ ≈ 95% 但 R-1 风暴 ×2。

## 6. 验收判据（写在守恒量上·非形状）
部署后连续 6 h：
1. `IBD self-trigger:` 行数 ≈ 6h / 16 min ≈ 20–25（T=600）；每次 `IBD started` → `completed successfully` ≤ 8 min；`completed with error` = 0。
2. isSynced（`_step0_gate.mjs` 60 s 采样）false 总时长 ≤ 10%；单次 false ≤ 3 min。
3. D-b 三回滚串 0；`PeerAlreadyExists` 0；peer 数 ≥1 全程。
4. 剪枝 `traversed` 6 h 内单调推进 ≥ 1M。
5. R-1：每次体相位 relay timeout 条数记录（基线 122–128/波），不作为本补丁验收，只记。
对照臂：切换前 6 h 同五量（今晚数据即基线）。

## 7. 实施路径与闸
1. NWT 红队本稿（重点：4.5 R-1 阈值取舍、4.2 (e) 坏 peer、4.6 失败面、验收量）。
2. J2 在 `D:\rusty-kaspa-dc\`（新 worktree，基于 4d0a9e30）实现，**独立 `CARGO_TARGET_DIR`**（memory：活 exe 住在 cargo target 目录，原地 build 会试图覆盖）；产物放 `D:\kaspad-live\dc-<hash>\kaspad.exe`（文件名必须仍是 `kaspad.exe`，rule 863）。
3. 测试：单元（超时分支状态机、退避、先比再争）+ 本地两节点 simnet 不可得 ⇒ 用测试网**影子跑**：先以 `--ibd-self-trigger-lag-secs=0`（关闭）起新 exe 跑 1 h 证零行为差，再开 600。
4. 切换 = Owner GO + J1 提权（同 D-b 段 1/3 形）；回滚 = `D:\kaspad-live\db-4d0a9e30\kaspad.exe`。
5. 上游：整理成 PR 草案（默认 0），另案。

## 8. 待红队的问题
Q1 阈值 600 vs 300 与 R-1 的取舍；Q2 `get_syncer_chain_block_locator(None,None)` 在对端剪枝点变化中途调用是否有竞态（负锁）；Q3 `request_single_block` 复用 `RequestIbdBlocks` 会不会与 `sync_missing_block_bodies` 的 IbdBlock 订阅抢消息（同 flow 串行，应无，请核）；Q4 4 个 IbdFlow 各自 timeout 分支同时到期的 thundering herd（都去 locator 一次）是否要加抖动；Q5 lag 读数来源：`sink timestamp` vs `pastMedianTime`（is_nearly_synced 用哪个，源码 `rule_engine.rs:125` 核对）。
