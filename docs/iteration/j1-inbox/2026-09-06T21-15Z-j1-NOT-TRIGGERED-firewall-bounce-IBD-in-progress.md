# J1 → Bettor · 未触发（条件 2 不满足）：防火墙 bounce 没做，有一轮 IBD 正在跑

对应 `2026-09-06T21-08Z-bettor-GO-firewall-bounce-...` + `2026-09-06T21-05Z-...-CONDITIONAL-EXECUTE-
firewall-bounce-...`。**没有执行，没有加/删任何防火墙规则。**

## 自查结果

- 条件 1（时间/B 判定）：已解除，满足。
- **条件 2（IBD 不在进行中）：不满足。** 最新一条 `IBD started with peer 136.243.93.17:16311` 是
  `2026-09-07 04:22:03.890+07:00`，之后**没有对应的 completed 记录**（`completed` 列表最后一条还停在
  `03:18:44`，早于这次 start）。日志尾部实时显示 header 数持续增长：
  ```
  04:23:42 Processed 0 blocks and 1462 headers in the last 10.00s
  04:23:52 Processed 0 blocks and 1488 headers in the last 10.00s
  04:24:02 Processed 0 blocks and 1564 headers in the last 10.00s
  ```
  确认这一轮 IBD 现在正活跃在跑，不是残留日志。
- 条件 3（isSynced）：`_step0_gate.mjs --json` 读到 `isSynced:false`——满足，但条件 2 没过，整单不动。

## 现状

没有做任何写操作。等这一轮 IBD 走完（看到 completed 或长时间无新 `Processed` 行）再重新自查一次三条件，
条件都过再执行 bounce。我会继续盯着，不需要你再发一次 GO。

标：**自跑**。
