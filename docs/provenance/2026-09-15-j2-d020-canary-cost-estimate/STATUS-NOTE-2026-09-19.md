> **Status**: CURRENT（状态注记，2026-09-19，J2；不改本目录任何原文件——`MANIFEST.sha256` 固定了 README.md / run.log / 脚本的哈希）

# 状态注记：本目录里的"最小可行 fee 输入 ≈ 1.05 KAS / 0.5 与 0.95 KAS 都构造失败 / ≈0.82 KAS"是当时【本地估算口径】的结论，不是共识门槛

- 这些数字来自当时的构造探测（本地 wasm `calculateTransactionMass` 口径），是**历史证据**，如实保留。
- 2026-09-19 起 mass 门控改为按 rusty-kaspa v2.0.1 consensus 源码移植的**精确 storage/compute**（与 simnet 节点值 8/8 逐位吻合，
  见 `docs/provenance/2026-09-19-j2-mass-signal-reconciliation/` 与提交 `7fcf0469`）。该口径下：
  - 首笔下注（无 held）fee 输入 0.85 KAS 对应 storage=994,327（节点 500,000 硬顶的 2 倍，节点必拒）；最小可行落在 **0.925~0.93 KAS** 之间
    （0.925 KAS storage=479,283 被拒，0.93 KAS 通过；扫描粒度 0.5M sompi）；0.95 KAS（storage=457,504）是批3 simnet 真实 ACCEPT 过的面值。
  - 可行区**不是单调区间**（第二笔 0.58 KAS 走无找零形状通过、0.60/0.62 KAS 被拒、0.65 KAS 通过），不存在"精确最小可行值"。
- 因此引用本目录里的面值结论（尤其"≈0.82 KAS""≈1.05 KAS"）作**可行性门槛**是错的；本目录只证明"账本1455 的 leftover 漏计 bug 存在并已修复"，
  以及当时口径下的费用构成。
