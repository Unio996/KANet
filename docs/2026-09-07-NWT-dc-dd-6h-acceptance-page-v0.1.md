# NWT · D-c + D-d 步② 6 h 验收页 v0.1（T1′ 06:20:08Z → 12:20Z · 草稿于 11:1xZ，最后一小时 12:20Z 追加）

**对象**：活 kaspad PID 40112（`kaspad v1.1.1-toc.1-3d017b6d`，args `$BASE_ARGS --rocksdb-cache-size=4096 --ibd-syncer-pp-lag-tolerance=0`，D-c 默认 480 s / check 60 s / backoff ≤1800 s）。**读数全部本人**（日志逐行切片 `awk '$2>="13:20:00"'` 本地 = 06:20Z 起；DAG/isSynced 2 min 直读 watcher）。周期口径按 Bettor：① 触发→触发（含被 relay 轮占槽的）；② 空闲起点（上一轮 completed）→触发 = D-c 本身的量（应 ≈ 480 − 起始 lag ± 60 s）。

## 1. 计数（06:20Z → 11:02Z）
| 量 | 值 |
|---|---|
| `IBD self-trigger with peer … sink lag` | **20**（lag 480–539 s，全部落在 480 + check 60 s 粒度内） |
| `IBD self-trigger … completed successfully` | **19** |
| `IBD self-trigger failed (protocol)` | **1**（10:59:09Z `peer connection is closed`，见 §4） |
| `IBD self-trigger failed (transient)` / backoff | **0 / 0** |
| `IBD started`（含常规） | 40（20 自触发 + 20 常规：4 轮追平 + 几何尾） |
| `completed successfully` / `completed with error` | 38 / 1 |
| `not recognized`（D-d 拒） | **0**；lags 行全部 `lag 28`、同 syncer pp `56db5830…` |
| `not eligible` 通知 | 41（每轮完成后 3 peer 各 1 条 ≈ 3/9 min；D-d README known-issue，SHOULD-低） |
| 回滚串（ROLLBACK/rollback） | 0 |
| `IBD started` canonical 行伴随每条自触发行（同毫秒） | ✓（D-c MUST-② 实证） |

## 2. 周期表（20 次自触发·失联前·本地 +07）
| # | 触发 | lag | ② 空闲起点→触发 s | ① 触发→触发 s |
|---|---|---|---|---|
| 1 | 14:10:43 | 503 | 371 | — |
| 2 | 14:19:47 | 511 | 312 | 544 |
| 3 | 14:33:52 | 528 | 433 | 845 |
| 4 | 14:43:14 | 510 | 311 | 562 |
| 5 | 15:01:22 | 510 | 434 | 1088 |
| 6 | 15:10:42 | 539 | 248 | 560 |
| 7 | 15:23:22 | 491 | 432 | 760 |
| 8 | 15:32:29 | 516 | 311 | 547 |
| 9 | 15:46:00 | 524 | 431 | 811 |
| 10 | 15:54:31 | 495 | 190 | 511 |
| 11 | 16:09:47 | 482 | 423 | 916 |
| 12 | 16:18:46 | 519 | 313 | 539 |
| 13 | 16:35:14 | 496 | 432 | 988 |
| 14 | 16:43:59 | 499 | 253 | 525 |
| 15 | 16:59:02 | 490 | 429 | 903 |
| 16 | 17:07:23 | 481 | 187 | 501 |
| 17 | 17:22:41 | 481 | 432 | 918 |
| 18 | 17:31:37 | 503 | 313 | 536 |
| 19 | 17:47:06 | 534 | 483 | 929 |
| 20 | 17:55:20 | 480 | 307 | 494 |

- ② 空闲起点→触发：min 187 / 中位 342 / max 483 s（n=20）——≈ 480 − 起始 lag，起始 lag 由上一轮的类型决定（自触发轮后 ≈ 轮长 200–320 s ⇒ 空闲 190–310；几何尾轮后 ≈ 100 s ⇒ 空闲 430–480）。
- ① 触发→触发：min 494 / 中位 562 / max 1088 s（n=19）；>800 的都是中间夹了 relay/orphan 触发的常规轮占槽（Bettor 读法），不是 D-c 慢。
- 自触发轮时长 187–324 s（头 ≈40–60 s + 体）；几何尾轮 102–157 s；追平 4 轮 1369/620/430/177 s。
- **"同步到陈目标"是设计属性**：自触发轮结束时 sink = syncer 在触发时刻的 sink ⇒ 轮后 lag ≈ 轮长。改进方向（D-c v2，不急）：轮完成后立即复核 syncer sink 是否又前进、直接接下一轮（现由 relay/orphan 触发的常规尾轮客串）。

## 3. isSynced 占空比（2 min 直读）
- 步② 首个 true：06:54:13Z（J2）/ 06:55:33–06:57:33Z（我，661 阈值边缘抖动）；**此后连续 true 到 11:00:13–11:02:13Z 之间翻 false = 约 4 h 07 min 不间断**（对照：步① 无 D-c 时 05:19→05:35Z 仅 ~17 min）。
- 机制：触发 lag 480–539 s，头相位 ≈1 min 后体相位 sink 以 2–4× 墙钟推进 ⇒ 峰值 lag ≈ 560–600 s < 661 ⇒ 稳态不翻 false（G-2 行为差评估的依据）。
- hdr−blk：中继/READY 0；轮内 162–3,557；作 G-1 S2 判据的实测分布。

## 4. 唯一失败：10:59:09Z 对端短失联 3.5 min（非 D-c）
- 10:59:09.934Z `P2P, network error: connection reset from peer 136.243.93.17` → 同毫秒 `completed with error: peer connection is closed` + `IBD self-trigger failed (protocol) at Ibd`（体相位 49%）。当时剪裁遍历 traversed 1.27M 在跑。
- 11:01:47Z 本机 `Test-NetConnection 136.243.93.17:16311` = **False**（窗内真读数）；其余三 peer True（但它们是"从我们同步再拒"的落后 peer，每 ~10 s 复位）；`getPeerAddresses` 已知 = 4 个 + 占位 `100::`。我当时判"无替代来源、lag 无界"——**撤回为短失联**（Bettor 993）：syncer **11:02:40Z 回连**，11:02:41Z orphan 路径常规 IBD 立即起（新连接 = 新 IbdFlow，自触发资格归零，靠 orphan/relay 路径兜底），11:03:01Z isSynced 回真，11:04:13Z 直读 sinkAge 41 s / hdr−blk 0。isSynced false 段 ≈ 11:00:13–11:02:13Z 起 → 11:03:01Z（1–3 min）。
- NOTE-a（J2 核）：错误是 `ProtocolError::ConnectionClosed`（common.rs:52）⇒ classify Closed；flow.rs:287 `Protocol | Closed` 共用 "(protocol)" 文案并结束 flow、不退避——行为对、文案可细分。
- NOTE-b（SHOULD 上游）：自触发资格按 peer 地址跨连接保留，免重连后等一次常规 IBD。
- 单前向 peer 依赖本身仍成立（TN12 从本机视角只有 136.243.93.17 在我们未来），另案记录，不扣 D-c。

## 5. 判定（草稿 · 12:20Z 终稿）
D-c 在窗内：20 次自触发 19 成功、0 backoff、0 transient、canonical 行齐、② 周期 ≈ 480 − 起始 lag、isSynced 连续 4 h 07 min；D-d 40 轮 0 拒、同 hash 同 lag。唯一失败归因对端短失联，D-c 分类与行为正确，3.5 min 自愈。**D-c/D-d 通过 6 h 验收（草稿判定，待 12:20Z 最后一小时）。**

## 6. 相位分段（Bettor/J2 口径 · 本人读数 11:16Z）
| 相位 | 时段 | 中继进块 | sink 落后 | D-c |
|---|---|---|---|---|
| ① 爬行 + 自触发 | 06:20→10:59Z | 0.5–3 bps（`Processed 5–30 blocks`/10 s） | 锯齿 100→540 s | 20 次自触发 / 19 成 / 周期 ② 中位 342 s |
| ② 对端短失联 | 10:59:09→11:02:40Z | 0 | 570→738 s | 1 次 failed (protocol)，3 条 not-eligible |
| ③ 同速跟随 | 11:03Z 起 | **17–21 bps**（`Processed 171–215 blocks and 同数 headers`/10 s，每 3 min 抽样 11:06–11:15Z） | **平台 ≈410–420 s**（我 11:16:41Z 直读 420 s；J2 412/411/415 s）<480 | **0 次**（不需要），isSynced 持续 true |
- ③ 段自触发栏为空是正常。**只报观测不下因果**：同一 peer、对端 reset 前后的新连接，中继吞吐从 0.75 bps 变为 ≈20 bps ⇒ "中继爬行"不是协议固有，与那条长连接的状态相关（候选：对端 per-connection 队列/inv 溢出 Drop 状态、我们侧 D-b/D-c 长 IBD 会话残留——均未证）。
- 若 ③ 段落后回升越过 480 s，D-c 接管 ⇒ 记为"两相位切换"样本（12:20Z 前若发生追加）。
- 对 G-1：③ 段 hdr−blk = 0、isSynced true ⇒ 写类放行；链视图常驻 ≈7 min 陈，在 661 判据内。
