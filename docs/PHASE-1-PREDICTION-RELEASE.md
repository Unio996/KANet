# Phase 1 Release — 非托管 Kaspa 预测下注 (Polymarket/UMA 镜像)

**Status**: ✅ SHIPPED 2026-05-28 (testnet-12) — SHIP GATE 4/4 green, Bettor architect 宣 ship (r160). Bettor reviewer 复核中.
**Author**: J1tn (Owner 钦定 r159/r160 release note 委托)
**Scope**: testnet-12 only. KANet 团队不运营主网; 第三方可独立部署.

---

## 一句话

用 Kaspa 链做**非托管**押注 Polymarket/UMA 的真实市场结果 — 钱锁在双方共管的 P2SH escrow, 没有托管方; 结果以 UMA 最终化判定为准, 满 48h 挑战窗口后结算。今天起 testnet 真链可用。

## 这是什么

- **非托管**: maker/taker 各自把 KAS 锁进按本单参数 silverc 编译的 P2SH escrow。没有中心托管方持币。
- **借信任 (Phase 1)**: 结果**直接读 UMA 最终化结果并镜像** (KANet 此阶段 **0 独立判断** — 不自判再跟 UMA 比对; 一致性比对是 Phase 2/3 影子打分/post_settle_audit 的事)。0 正确性负担, 用可信真相验证整条非托管管线跑通。
- **真最终化**: 不认 gamma `closed` 为终态。必须 UMA 挑战窗口 (默认 48h) 过后才接受结果 — 防 24-48h 内 UMA reverse 导致已结算判错方。

## ⚠ 验证范围 (工程 vs 经济)

Phase 1 证的是**工程层**, 不是经济层 — 避免误读:

- ✅ **已证 (工程)**: 非托管资金管线 (P2SH 锁仓/双方签名/escrow 编译) + UMA 48h 最终化 gate + 结算 TX 管线, 真链端到端跑通。
- ❌ **未证 (经济)**, 具体点名未证项:
  - **bond 数学是否够覆盖 pot** (= sum(必贿 oracle bond) ≥ pot×1.5 真不真挡得住)
  - **贿赂成本 / collusion resistance** (= 串谋腐蚀阈值 oracle 的成本是否 > 可能收益)
  - **激励模型抗对抗** (= 养肥再杀 / sybil 刷单 / domain-shift 等攻击)
  这些靠 Phase 2/3 (攒信任 + 真 bond + 持续吊销 + 真 slash) 真上场后才证。Phase 1 **不解** Owner 的经济兜底关切, 也不 imply 解。

## ⚠ 节点 / 模型多样性 (诚实标 — Bettor r173 + J2 r77 共识)

Phase 1 demand 现 **100% 自家循环**, 不是 organic 外部需求:

- **节点 (host) 多样性**: 当前 5 oracle 全跑在 **单 host** (.105 same machine), 不 robust against host-level outage 或 collusion。真"agent 经济体"语义要求 **≥3 独立 host**, Phase 1 未达。
- **LLM 模型多样性**: 5 oracle 全用 **同一个 Qwen3.6 模型** (single brain identity per memory project_qwen36_milestone), domain-shift 防御为 0。真"多样性"语义要求 **≥2 独立 LLM provider**, Phase 1 未达。
- **demand 来源**: 5 oracle 投 5 oracle 自家上挂的 polymarket-mirror 市场, 无 external builder, reputation 现 ≈ 0 (= network effect 不足支撑 organic incentive)。

= Phase 1 是 **能力 demo** (证 rails 真跑), 不是 **PMF / organic demand 证据**。每个公开物料须 explicit 标 self-generated demand + 单 host + 单 LLM 现状, 不 imply 已是 production-grade decentralized oracle network。

## 真链证据 (testnet-12)

完整 e2e — 真 Polymarket 市场 Espresso FDV $200M (condition `0x374e86da`, resolved YES, closed 70 天前):

| 阶段 | TX |
|------|-----|
| maker escrow lock (publish-v2) | `68e995f1` |
| taker stake lock | `0e475369` |
| 5-oracle 读真 gamma → YES + 48h 最终化 gate 过 | (voter cron) |
| 10/10 sig collected → settle | `c045c58a` (winner=maker, YES 赢) |

历史 settle TX (regression 基线, NWT Sub5 + Bettor 独立 verify **5/5 全 completed**, hash-anchor v2 重构 0-break 三 recovery 机制): `ba8cc3b6` · `f64d40a2` · `b58e1585` · `63466037` · `c045c58a`。

## 关键机制

- **UMA finalization gate** (commit `cea78b1`): `derivePolymarketVote` 加 `UMA_FINALIZATION_WINDOW_MS` (mainnet 默认 48h; testnet 可设短值练兵)。gamma `closedTime`/`endDate` + window 未过 → oracle abstain → 不 premature settle。
  - 此 gate 源于一次 catch: gamma `closed=true` ≠ UMA 最终化 (挑战窗口可 reverse)。catch → fix → 真链验证 (Espresso 70天>48h, gate 正确放行)。
- **两条 settle 路径** (历史 TX 两类都含):
  - **consensual 2-sig 快结**: maker + taker 双方对结果无争议 → 2-of-2 签直接结算 (e.g. `b58e1585`)。
  - **oracle 5-of-5 判定**: 无人为共识 (镜像/争议路径) → 5 oracle 读真相全签结算 (e.g. Sub4 `c045c58a`, testnet Phase 3a)。
- **链是唯一真相源**: offer 状态机 (matched→verifying→collecting_sigs→completed) 由链上事实驱动。

## 用户透明层 (UI Sub6)

预测市场 UI 每挂单三件可审计展示 (UI 只读权威字段, 0 主观判定 — 守去中心化):
- **类型 badge** (读 Owner-approved condition mapping): 🪞 镜像 UMA / ⚖ 真并行判定 / 未映射。
- **UMA 最终化状态** (protocol_status 驱动, 非猜倒计时防误导): verifying+ → ✅ 已最终化 (48h gate 已过) / 早期 → ⏳ 待验证。
- **链上结算 TX → Kaspa explorer 链接** (任何人可独立审计资金流)。

caveat: 最终化状态 + settle link 即时生效; mirror badge 待 Owner approve 真 condition mapping 后点亮。

## 定位 (Owner)

- **目标**: 去中心化预言机协议。
- **当前**: testnet 阶段，KANet 团队**不运营主网**。
- **部署**: 第三方可独立部署。
- **许可**: MIT 公开。

## 不在 Phase 1 范围 (后续)

- Phase 2/3 oracle 演进 (并行判定 / 自动发执照 / 持续吊销) — 引擎代码已 ready，但**硬 gate 锁**：发执照前持续吊销引擎 (post_settle_audit) 必先 proven-live (= 已交叉核 ≥1 真票)。auto-grant 在代码层默认 DISABLED。Phase 1 完全不依赖这些。
- 原生长尾市场即时结算 — 毕业 oracle 之后。

---

*SHIPPED 2026-05-28 testnet-12. Bettor reviewer 复核中 (r160). 正式委托完成 (Owner r159/r160 钦定).*
