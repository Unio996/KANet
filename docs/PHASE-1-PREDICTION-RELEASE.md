# Phase 1 Release — 非托管 Kaspa 预测下注 (Polymarket/UMA 镜像)

**Status**: 🟡 DRAFT — pending Sub5 (NWT regression 4 历史 settle TX green) + Owner 宣 ship. 宣布前不公开.
**Author**: J1tn (Owner 钦定 r159 release note 委托)
**Scope**: testnet-12 only. KANet 团队不运营主网; 第三方可独立部署.

---

## 一句话

用 Kaspa 链做**非托管**押注 Polymarket/UMA 的真实市场结果 — 钱锁在双方共管的 P2SH escrow, 没有托管方; 结果以 UMA 最终化判定为准, 满 48h 挑战窗口后结算。今天起 testnet 真链可用。

## 这是什么

- **非托管**: maker/taker 各自把 KAS 锁进按本单参数 silverc 编译的 P2SH escrow。没有中心托管方持币。
- **借信任 (Phase 1)**: 结果直接镜像 Polymarket/UMA — KANet 此阶段 0 正确性负担，用可信真相验证整条非托管管线跑通。
- **真最终化**: 不认 gamma `closed` 为终态。必须 UMA 挑战窗口 (默认 48h) 过后才接受结果 — 防 24-48h 内 UMA reverse 导致已结算判错方。

## 真链证据 (testnet-12)

完整 e2e — 真 Polymarket 市场 Espresso FDV $200M (condition `0x374e86da`, resolved YES, closed 70 天前):

| 阶段 | TX |
|------|-----|
| maker escrow lock (publish-v2) | `68e995f1` |
| taker stake lock | `0e475369` |
| 5-oracle 读真 gamma → YES + 48h 最终化 gate 过 | (voter cron) |
| 10/10 sig collected → settle | `c045c58a` (winner=maker, YES 赢) |

历史 settle TX (regression 基线, NWT Sub5 验绿): `ba8cc3b6` · `f64d40a2` · `b58e1585` · `63466037`。

## 关键机制

- **UMA finalization gate** (commit `cea78b1`): `derivePolymarketVote` 加 `UMA_FINALIZATION_WINDOW_MS` (mainnet 默认 48h; testnet 可设短值练兵)。gamma `closedTime`/`endDate` + window 未过 → oracle abstain → 不 premature settle。
  - 此 gate 源于一次 catch: gamma `closed=true` ≠ UMA 最终化 (挑战窗口可 reverse)。catch → fix → 真链验证 (Espresso 70天>48h, gate 正确放行)。
- **5-of-5 multi-sig SS escrow**: 结算需 5 oracle 全签 (testnet Phase 3a)。
- **链是唯一真相源**: offer 状态机 (matched→verifying→collecting_sigs→completed) 由链上事实驱动。

## 定位 (Owner)

- **目标**: 去中心化预言机协议。
- **当前**: testnet 阶段，KANet 团队**不运营主网**。
- **部署**: 第三方可独立部署。
- **许可**: MIT 公开。

## 不在 Phase 1 范围 (后续)

- Phase 2/3 oracle 演进 (并行判定 / 自动发执照 / 持续吊销) — 引擎已 ready (见 [guide/20-oracle-evolution.md](guide/20-oracle-evolution.md))，但**硬 gate 锁**：发执照前持续吊销引擎 (post_settle_audit) 必先 proven-live。Phase 1 不依赖这些。
- 原生长尾市场即时结算 — 毕业 oracle 之后。

---

*待 Sub5 green + Owner 宣 ship 后转正式 release note 公开。*
