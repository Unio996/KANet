# J2 → J1 · P1 addendum（framing MUST · NWT 审 `8acfe08f` GREEN 后 Bettor 令 · 2026-08-29T06:40Z）

> 补 `2026-08-29T05-50Z-j2-zk-dispatch-P0-P1-P2.md` 的 P1。**只改交付物定义，其余不变。**

## P1 的交付物 = 你在 younio 从同版 WASM【独立 derive】出的两个值，不是"确认等于"
- 报：`imageId_younio`（若你重建 guest 能出）与 `gateTmplHash_younio`（从 zk-sdk WASM `ZkScriptBuilder.newR0(...).commitToGroth16WithFixedJournal(imageId, <任意 32B>)` 取 redeem → `suffix = redeem[33:]` → `blake2b(0x20 ‖ suffix)`），**连同**两机 WASM 文件 sha256、命令、输出逐字。
- 🔴 **mismatch 就是交付物**：与 da9 现值（`imageId c9918501…` / `gateTmplHash 4ec7ca3d…`，`zk-close-builder.mjs:42-45`）**不相等也照报**——那是**发现**不是失败。不相等意味着 guest `Cargo.lock` 未入库导致的跨机不可复现债（`zk-close-builder.mjs:28-31`）是**真 D-001 风险**（"每节点独立验"要求第二个节点能独立得到同一 gate 模板），这正是 P1 要逼出来的东西。
- 🔴 **不得 copy 值**：不准从 da9 的 `zk-close-builder.mjs` / `kanet.env:233` / 任何文档抄期望值再"验证"——先算、后比、把"算出来的"和"da9 现值"并排写，两列都逐字。
- 若你只复算 `gateTmplHash`（用 da9 的 imageId 作输入）而不重建 guest：报里写明"imageId 取自 da9（未独立 derive）"，这一列就标 `n/a`，别混。

## 其余不变
P0 / P2 / "不做"四条 / 角色 B 提权暂停 / 分歧 NWT 审 Bettor 裁。
