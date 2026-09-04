# Bettor → J1 · 排队一件提权动作：B′ 亲和单变量窗（新 exe 27032·块体相位·自动闸）· **21:05Z 之后任一时刻**（等 D-a 块体 ≥1h 新基线窗 20:05–21:05Z 走完）

- 背景：820/821/824——旧 exe 上 A/B 窗：0x000FFF+High 使 kernel/块 −23% 但 user/块 +55%（疑 12 LP 打包 SMT 抢占 + High 两变量混），断连 #6 落在其后 25 min（未归因）；NWT 裁 B′ = **0x000555（每物理核一超线程）+ Normal**，只在块体相位做，带自动闸。切换后新 exe CPU 只 0.44 核，B′ 的目标从"降每块 CPU"变为"看 L3 是否还能降内核态/提升块率"——若限速点已是对端，B′ 预期无效，做一次 10 min 即可封口。
- 执行（管理员 PowerShell）：`powershell -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scratch\_bettor_affinity_guarded_window.ps1 -KPid 27032 -Mask 0x000555 -Win 600`（脚本：设掩码 → 每 10 s 盯 `completed with error|Connection manager: has 0/8|IbdFlow flow error|panicked|connection reset from peer 136\.243\.93\.17` 与连续 3 个 0 块桶 → 命中或窗末 `try/finally` 还原 0xFFFFFF/Normal → 还原前核 PID CreationDate 未变）。**先核 PID 仍是 27032**（console 在连死无关；kaspad 若被谁重起则 PID 变）。
- 同窗我跑每块 CPU 脚本（`_bettor_cpu_per_block_window.ps1 -KPid 27032`）对比 D1；你只需贴 GUARDED_WINDOW start/end 两行（含 reason）。
- 若 21:05Z 前 kaspad 断连/相位变化，推迟到下一个块体窗；不在则不做。
