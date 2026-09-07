cat /tmp/dc_table.md
cat <<'EOF'

- 自触发轮时长 187–324 s（头 ≈40–60 s + 体）；几何尾轮 102–157 s；追平 4 轮 1369/620/430/177 s。
- **空闲起点→触发 ≈ 480 − 起始 lag**：自触发轮结束时 sink 是 syncer 在触发时刻的 sink ⇒ 起始 lag ≈ 轮长（200–320 s）⇒ 空闲 160–370 s 即再触发；这是设计属性（同步到陈目标）非故障；几何尾轮把起始 lag 压到 ≈100 s 时空闲拉到 ≈370 s。改进方向（D-c v2，不急）：轮完成后立即复核 syncer sink 是否又前进、直接接下一轮（现由 relay/orphan 触发的常规尾轮客串这一步）。

## 3. isSynced 占空比（2 min 直读）
- 步② 首个 true：06:54:13Z（J2）/ 06:55:33–06:57:33Z（我，661 阈值边缘抖动）；**此后连续 true 到 11:00:13–11:02:13Z 之间翻 false = 约 4 h 07 min 不间断**（对照：步① 无 D-c 时 05:19→05:35Z 仅 ~17 min）。
- 机制：触发 lag 503–539 s，头相位 ≈1 min 后体相位 sink 以 2–4× 墙钟推进 ⇒ 峰值 lag ≈ 560–600 s < 661 ⇒ 稳态不翻 false（G-2 行为差评估的依据）。
- hdr−blk：中继/READY 0；轮内 162–3,557；作 G-1 S2 判据的实测分布。

## 4. 唯一失败：10:59:09Z（对端消失，非 D-c）
- 10:59:09.934Z `P2P, network error: connection reset from peer 136.243.93.17` → 同毫秒 `completed with error: peer connection is closed` + `IBD self-trigger failed (protocol)`（分类正确、无 backoff、保留断连语义）。当时剪裁遍历 traversed 1.27M 在跑。
- 11:01:47Z 本机 `Test-NetConnection 136.243.93.17:16311` = **False**；其余三 peer True 且重连（但它们是"从我们同步再拒"的落后 peer，每 ~10 s 复位）；`getPeerAddresses` 已知 = 这 4 个 + 占位 `100::`，**无替代**。⇒ **TN12 从本机视角只有一个前向 peer，它不在时常规 IBD 与 D-c 都不可能**（D-c 三条 not-eligible 行 lag 658→675 s 即此）。isSynced 11:00:13–11:02:13Z 翻 false，lag 无界增长中。已报 Bettor（msg 76293683），记独立事故"TN12 单前向 peer 依赖"。
- （12:20Z 追加：恢复时刻/用时或仍不在）

## 5. 判定（草稿）
D-c 在 6 h 窗内：20 次自触发 19 成功、0 backoff、0 transient、canonical 行齐、周期 ≈ 480 s + 轮长、isSynced 连续 4 h+；D-d 40 轮 0 拒、同 hash 同 lag。唯一失败归因对端消失，D-c 分类与行为正确。**D-c/D-d 通过 6 h 验收（待 12:20Z 终稿）**；新事故（单前向 peer）另案。
