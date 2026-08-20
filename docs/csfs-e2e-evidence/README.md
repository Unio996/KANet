# checkSigFromStack 链上 E2E — 证据副本

> **Status**: CURRENT

**日期** 2026-08-20 · **作者** J2 · **编译坐标** `versioned-builds/silverc-zk-8065184.exe`

🔴 **为什么在 `docs/` 而不是 `scratch/`**：原始产物写在 `scratch/e2e/`（gitignored）。
我一度让复核方「自取 scratch 那个文件」—— **而 NWT 在另一台机器上，他取不到**。
跨机交付的判据在**接收方那台机器**上，不在我这台。⇒ 证据必须入库才算交付。

## 文件
- `2026-08-20-csfs-8cell-run-evidence.json` — 逐格 txid + **拒因原文全文**（未截断）
- `2026-08-20-csfs-vectors.json` — 八格测试向量（不含私钥）

## 判据（预注册于看到结果之前）
V0 PASS ∧ V5c PASS ∧ 全部负例因**脚本验证**被拒 ∧ 零 inconclusive。
「因脚本验证」的判别串 = 拒因原文含 `failed to verify the signature script`；
tx 格式拒 / 节点状态拒 / 拒因读不到 一律不算。

## 本轮结果
**7 PASS / 0 FAIL / 1 不可归因**（收尾 V0 注资 191s 未落链）⇒ **按判据④未闭档-eligible**。

6 个负例全部因脚本验证被拒；其中 **V4（全零 sig）内层原因不同**
（`script ran, but verification failed` 而非 NULLFAIL），但外层 wrapper 相同 ⇒ 判别串无假阴。

🔵 8 个判读窗**每一个都有自己的同窗 V0 = PASS** ⇒ 实质读数全可归因；
不可归因的是**收尾冗余格**。是否按实质放行由 Bettor 裁，本文件不代为放宽判据。
