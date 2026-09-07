# NWT 红队审 · D-d `--ibd-syncer-pp-lag-tolerance`（commit c8820392 on a39c60d2）v0.1 · 2026-09-07T01:2xZ

**对象**：`scratch/_j2_dd_syncer_pp_lag_tolerance_2026-09-07T01-15Z_a39c60d2..c8820392.patch`（365 行·sha256 前缀 `ee77d9fc3a59a745`，我算一致）；`git -C /d/rusty-kaspa-dc2 diff a39c60d2..c8820392` 与补丁**行集一致**（去 index/hunk 头后 diff 为空）。设计页 `scratch/_j2_dd_design_and_hunks_2026-09-07T01-15Z.md`。
**我亲手跑**：`/d/rusty-kaspa-dc`（HEAD c8820392·clean）`CARGO_TARGET_DIR=target-dc cargo test -j 2 -p kaspa-p2p-flows syncer_skew` ⇒ **8 passed**；`… self_trigger` ⇒ **14 passed**（D-c 不退化）。free 19.6 GB、kaspad WS 16.8 GB 时跑，J2 dc2 构建并行未受扰。

## 判定：**GREEN-conditional**（1 MUST · 3 SHOULD · 3 NOTE）

### MUST-1 · 拒绝路径零可观测（H2）
`classify_syncer_skew(...).ok_or(ProtocolError::Other(...))?` 在 `None` 时**不印任何东西**——syncer pp 哈希、表内命中位置、ancestor 结果全不落日志。这正是本次事故我们至今**读不到对端 PP** 的原因（§19：日志无任何行印对端 PP）。D-d 上线用 16 若仍失败，我们还是不知道该不该去 0。
**改法**（一 hunk + 一测）：`None` 分支先 `warn!` 逐字可 grep 行，再返回同一 `ProtocolError`：
`IBD syncer pruning point not recognized: syncer pp {}, our pp {}, table position {} (window {}), chain-ancestor-of-ours {:?}, tolerance flag = {}`（position 用 `past_pruning_points_newest_first.iter().position(...)` 的 `Some(p)|None`；window 印 `lookup_window(tolerance)`）。纯函数不变，只在 flow.rs 调用点加；测试可在 `syncer_skew` 里加一条"拒绝时 verdict 为 None 且输入可复述"或在 flow 层不测（日志行靠 grep 验收）。

### SHOULD-1 · tolerance 1–3 = 比上游更严，未文档化
`lookup_window(2)=2` ⇒ 只认 lag 0–1，`p < UPSTREAM_TOLERANCE` 那臂被窗口截断。行为自洽但 help 只说"4 = upstream, 0 = unlimited"。补 help 一句"values below 4 are stricter than upstream"，加测 `tol=2` 拒 lag 3。

### SHOULD-2 · 部署值用 16，不用 0
0 模式额外接受"不在表内但 `Some(true)` 是我们 PP 链祖先"的任意旧链块当 syncer pp；Sync 路径不再用 syncer_pp，风险低但接受面无界，且 `get_n_last_pruning_points(usize::MAX)` 逐索引读全表（~70 次 DB get）。16 覆盖本次 9 且有界。0 留作 16 失败后的第二步（前提 MUST-1 让我们看见对端 pp 是不是 <54）。

### SHOULD-3 · runbook 加"回滚二进制不认新 flag"
db-4d0a9e30 不认识 `--ibd-syncer-pp-lag-tolerance`（clap 直接退出）；J2 设计段 §5 已写 `$BASE_ARGS`，请 Bettor runbook 逐字带上，watchdog 的 canonical args 不动。

### NOTE-1 · 表连续性已核（放宽窗口读到从未读过的索引，`get(ind).unwrap()` 会 panic 于缺口）
`consensus/src/pipeline/pruning_processor/processor.rs:211` 推进时对每个新 pp 按 `current_index + i + 1` 逐个 `insert_batch`（中间索引全写）；`processes/pruning_proof/mod.rs:192` headers-proof 导入 `set(i, …)` 0..k 连续；`consensus/mod.rs:482` 同族。⇒ 60→69 跳步时 61–68 已写；现网 5 轮循环每轮都成功执行了 `get_n_last_pruning_points(4)`（读 66–69）。窗口 16 读 54–69：54–60 来自导入、61–69 来自推进，无缺口。安全。
### NOTE-2 · 语义
Sync 型路径不从 syncer 写 pruning point store（`import_pruning_points` 仅 headers-proof :758/:789；`sync_new_utxo_set(syncer_pp)` 仅 HeadersProof/PruningCatchUp）；滞后 syncer 历史只多不少；`(Lagging,false)` 臂原样保留。本机 utxo 00:11:04Z 已 stable ⇒ 放宽后走 `(Lagging,true)`→Sync。ancestor 关：表内 lag≥4 必过 `is_chain_ancestor_of(syncer_pp, our_pp)`，`Some(false)` 拒、`None` 退表——过去 pp 若 reachability 已剪则 `None`，退表是对的（表内 = 本机自己算出的历史 pp）。`unwrap_or(false)` 保持。默认 4 时零新增 ancestor 调用（`needs_ancestor_check(4)=false`），上游语义逐字。
### NOTE-3 · 工具链
`Option::is_none_or` 需 Rust ≥1.82；本机 rustc 1.96.1，编译通过。flag 的 `.env(KASPAD_…)` / `require_equals(true)` / `arg_match_unwrap_or::<usize>` 与 D-c 三 flag 同模式（args.rs:489-493、:633）。stability 五臂与 finality-conflict `Err` 不在 diff 内 ⇒ 未动。

## 验收（我盯）
影子步①（`--ibd-self-trigger-lag-secs=0 --ibd-syncer-pp-lag-tolerance=16`，cache 4096）：日志出现一次 `IBD syncer pruning point lags ours beyond the upstream tolerance (4): syncer pp …`（拿到对端 pp 哈希 ⇒ 反推其索引）→ 同 peer `completed successfully` → `Processed N blocks` 非零 → sink 时间戳收敛；`could not be easily recognized` 不再出现。若出现 MUST-1 的 not-recognized 行且 position=None ⇒ 对端 pp <54 或不在表，再议 0。

## v0.2 · 复审 3d017b6d（2026-09-07T01:3xZ）— **GREEN-final（代码）·产物待核**
- 增量补丁 `scratch/_j2_dd_fix_2026-09-07T01-21Z_c8820392..3d017b6d.patch`（83 行·sha 前缀 `775942f6bfa5982a`，我算一致）与 `git diff c8820392..3d017b6d` 行集一致；全量 `…_a39c60d2..3d017b6d.patch`（397 行·`0efc624ecf1e8eeb`）与 `git diff a39c60d2..3d017b6d` 行集一致。
- **MUST-1 ✓**：flow.rs 拒绝分支改为 `match classify(...) { Some(v)=>v, None=>{ warn!(逐字行); return Err(同一 ProtocolError) } }`；行含 syncer pp / our pp / 表内位置(`p`|`none`) / window(`n`|`unlimited`) / ancestor `{:?}` / flag。纯函数未动。注：position 是**取回窗口内**的位置，`none` = 窗口外或不在表，读时配 window 看。
- **SHOULD-1 ✓**：help 补 "Values 1-3 are stricter than upstream (the window is truncated…)"；新测 `tolerance_below_upstream_is_stricter_window_truncation`（tol=2 拒 lag 3、收 lag 1）。
- **我亲手跑**（`/d/rusty-kaspa-dc` checkout 3d017b6d·clean·`CARGO_TARGET_DIR=target-dc -j 2`）：`syncer_skew` **9 passed**，`self_trigger` **14 passed**。
- 未改：SHOULD-2/3 走 runbook（Bettor）。
- **产物**：等 J2 dc2 干净构建 `D:\kaspad-live\dc-3d017b6d\kaspad.exe`；GREEN-final 落地条件 = 我核 sha256 + `--version`/日志首行含 `3d017b6d` + `--help` 含四个 flag。c8820392 那次构建 SUPERSEDED（J2 报无产物落盘，未核）。

## v0.3 · 产物核（2026-09-07T01:4xZ · 全部本人核）— **GREEN-final 落地**
- `D:\kaspad-live\dc-3d017b6d\kaspad.exe`：40,629,248 B（08:36 本地）；sha256 `6d5bcebebd528862d6adbc28ba7baab6f21ea74c373325fef0e208fbd1d5106f`（与 J2 报一致）；内嵌全长 `3d017b6d8d59…19f79` ×1、短哈希所在行 2（J2 计 3 处为出现次数，计法不同，实质一致）。
- `--version` = `kaspad 1.1.1-toc.1`（无 hash，与 D-b/D-c 同形；判活按日志首行）；`--help` 含四 flag `--ibd-self-trigger-{lag,check,backoff-max}-secs` + `--ibd-syncer-pp-lag-tolerance`，help 含 SHOULD-1 "stricter" 句。
- provenance `docs/provenance/2026-09-07-kaspad-dd-syncer-pp-lag-tolerance/`：`patch.diff` sha 前缀 `0efc624ecf1e8eeb` = 我审的全量补丁；`COMMIT.txt` 3d017b6d ← c8820392；`MANIFEST.sha256` 全部 OK（含 exe）；三份中止日志留痕（detached HEAD 无 hash ×1、build script 陈旧缓存 ×1、源码中途切换 ×1）。
- **落地验收（起后我盯）**：日志首行 `kaspad v1.1.1-toc.1-3d017b6d`；`--ibd-syncer-pp-lag-tolerance=16` 下出现 `IBD syncer pruning point lags ours beyond the upstream tolerance (4): syncer pp …`（拿到对端 pp）或 `… not recognized: … table position none …`（⇒ 再议 0）；随后同 peer `completed successfully`、`Processed N blocks` 非零、sink 收敛。切换/GO 归 Bettor/Owner。
