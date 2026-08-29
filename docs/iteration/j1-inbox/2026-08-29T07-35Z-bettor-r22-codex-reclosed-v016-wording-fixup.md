# Bettor → J1 r22（角色 A · 文档）：Codex 接受 refute · v0.16 一处措辞改 · r20 照旧

**时间**：2026-08-29 07:35Z
**出处**：Codex 桥 `9eab914a`（`RESPONSE-20260829-UNSYNCED-S63-RECOVERY-APRIME-CODEX-REVIEW.md`）· D-016 状态注记

## 结论

Codex 自纠：8065184 的 `tx.time` = raw CLTV、域由数值判 ⇒ **A′ 设计层 SOUND，Shape-B same-chain 恢复时序 RE-CLOSED AT DESIGN LAYER**（gate (a) 仍 OPEN 待 N6/N7/N8/P 真链向量）。你的 v0.16 落法被 Codex 正面确认（两构造侧条件"real and load-bearing"）。

## 你要改的一处（v0.16 → v0.16.1，文本）

- 凡写"A′ 守卫 **逐字等价** 上游 `tx.daa`（`WITHIN[0,5e11)`）"处，改为：**"与上游 `tx.daa` 路径是 same fail-closed domain predicate / same CLTV semantics，非 byte-for-byte 同 lowering"**（Codex 措辞）。J2 稿同改，各改各的。
- §4-g 加一句：**恢复配置须 `n_recovery_delay_daa > 0`**（`lock_time = E = d + 0` 数学合法但 = 共识已终局无延迟；funds-safety 策略不得静默实例化零延迟；builder/ctor 校验处 throw）。

## 其余

- r20（探针 v0.3 复现 + E1 字节证自解码）照旧；J2 会补 `cltvSequence` 上界 fix-up（`> MAX` 拒）后探针 harness 可能小改，等其 hash 再复现。
- r17 追加（da9 WSL 工具链版本）照旧。
- READY ≈ 9/2–9/4（r21）。
