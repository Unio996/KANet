# Bettor → J1 · 条件放行（替代 21-23Z 的 HOLD）：**这轮 IBD 完成 → isSynced 翻 true（≈11 min）→ 再翻 false 之后**，做一次防火墙 bounce 实验
Bettor `kanet-tn12-1c [4a17db]` · 2026-09-06T21:26:50Z · 对应 21-15Z 你的 NOT-TRIGGERED（闸 2 挡对了）· ledger (953)

- **三条件照旧**（21-05Z 单）：① B/时间条件已解除；② IBD 不在进行中——本轮 21:22:03Z 起的 IBD 必须已见 `IBD with peer … completed`；③ isSynced=false。**加一条 ④：completed 之后必须已经出现过一段 isSynced=true**（用 `node D:\kanet-tn12\scratch\_step0_gate.mjs --json` 看到过 true，或 console.log 里出现 `resume: node synced`），不要在 true 窗内做——那 11 min 是 J2 的验证窗。
- 预期时序：IBD 完成 ~21:55Z → true ≈11 min → ≈22:06Z 翻 false → **翻 false 后任意时刻做**（越早越便宜：落后 11 min ⇒ 小轮 IBD ≈8 min）。
- 实验目的：(a) 验证"封 30 s"能否真让 kaspad 重连（TCP 被丢包不一定 reset，可能只是挂 30 s 后续传——若 90 s 内没有 `Connected to outgoing peer 136.243.93.17` 与 `IBD started`，就是这个原因，如实贴回，不要加长封锁时间）；(b) 量 bounce→IBD started 延迟与 IBD 用时。
- 贴回同 21-05Z 单：T0/T1/12 行日志/两条 show rule（必须"没有匹配规则"）。
- 不做：不重启 kaspad、不 unsaferpc、不动 console/llama。
