# 决议 — v0.6 委员 bond 经济模型 (testnet A.1)

> **性质**: 自决决议 (consensus + 文档初衷对齐 → 自决执行, 无需 Owner 逐项点头)
> **主持**: Bettor-tn (架构/审核) | **日期**: 2026-05-31
> **依据**: 5-agent 对抗共识 (4/4) + 已锁设计文档初衷 | **存底**: 本文 = 决议记录
> **Owner 工作方式钦定**: 共识 + 文档对齐两步走完即自决, 全程自动化无人为干涉。

---

## 0. 一句话

v0.6 委员 bond = **池级 standing stake (option A)**, 不是 per-market 押 (option B)。testnet 现走 **A.1**: settle 不退 per-market bond (链上本无), 委员靠 oracleFee 拿报酬; 真链锁 stake + dispute slash = 文档命门, 立为 Phase5/mainnet gate。

---

## 1. 起因 (bug)

46f8a (v0.6, 5 委员 4-of-5 共识 YES) settle TX 打到 kaspad 被拒: `tries to spend 183949949999 while total inputs 183650000000`, 超发 299,949,999 sompi。实证精确等式:

```
sum_outputs = inputs + 3×oracle_bond(300,000,000) − minerFee(50,000) − 1
```

**根因 (KI 49 v0.5→v0.6 不同步)**: `computePoolPayouts` 硬编码退 3 个 per-market oracle bond (v0.5 逻辑), 但 v0.6 委员会市场 `spine_input_count=1` (只 maker, 0 oracle deposit) → bond 输出有、输入无 = 超发。

---

## 2. 设计岔路 + 文档脉络

| | v0.5 (`products/03-prediction-pool.md`) | v0.6 (`2026-05-30-oracle-economic-security-v0.6-spec.md`, Owner 5/30 锁) |
|---|---|---|
| bond 模型 | **per-market 押** (状态机 `pending_oracle_deposits`, 3 oracle 各 deposit→spine, settle 退) = **B** | **池级 standing stake** (公开质押池, VRF 抽委员, dispute 才罚) = **A** |

**v0.6 设计初衷 = A, 是 Owner 5/30 钦定锁死的; B 是上一代。** `computePoolPayouts` 仍跑 v0.5 B 逻辑 = bug 真根。

`roles/oracle.md` 原文: 「现 testnet stake placeholder」「真经济模型 (bond≥pot / slash) 还需 Phase 2/3 真上场验证 — Phase 1 只证工程管线, 未证经济」。→ stake 现 symbolic 不是 bug, 是文档写好的分期; Owner "必须押 bond" 在设计层已满足 (池级 stake = bond), 真链锁是 Phase 5。

---

## 3. 5-agent 对抗共识 (4/4)

| agent | 立场 | 理由 |
|---|---|---|
| J2 (r198) | A | 实现/liveness: 0 新表/IPC; B 有 1 委员 silent (20%) 单点卡死 |
| J1 (r224) | A first-ship | 复用现有池押, 0 新机制 0 新链 TX; 反 B 双重押 +5× 链成本 |
| KANet-UI (r396) | A + dispute slash | 反 B 三风险: liveness 爆 / L14 ~6 周开发 / 抬 oracle 门槛退池 |
| NWT (r126) | A.1 testnet | 实证 stake_locked_kas seed-only 无链锁 = symbolic; testnet A.1 + mainnet B 现实与钦定不矛盾 |

---

## 4. 决议 (锁)

1. **testnet A.1**: `computePoolPayouts` v0.6 分支 — **不退 per-market bond** (committee bond return = 0), 委员照拿 `oracleFee`/委员数 share。约束: `sum_outputs == inputs − minerFee`。
2. **硬编码 3 oracle → 委员数 (5)**: oracleFee 按委员数均分, 不再写死 3。
3. **经济命门 = Phase5/mainnet gate**: 真链锁 enrollment stake + `dispute_reveal` slash (文档 §2 唯一承重墙)。落地前**不报"经济安全闭环"**, 只称"settle 机制演示"。

---

## 5. 验收线 (NO TX NO STATE CHANGE)

- 46f8a `settle_txid` DB hexlen=64 + 链上 confirmed;
- `sum_outputs == inputs − minerFee` (超发归零);
- 5 委员各收到 oracleFee share (DB 实证), 8 bettor 按 `tx.inputs[0].value` 比例分账;
- **未达成前一律不报 ③ 闭环**。

---

## 6. 分工

- **@J2-tn**: 实现 §4 (computePoolPayouts v0.6 分支 + 委员数 oracleFee + 0 bond return)。
- **@Bettor-tn (我)**: 审 commit + DB 实证 46f8a settle + 守"不报经济闭环"红线。
- **Phase5 排日**: 真链锁 stake + dispute_reveal slash (单独 spec, 非本决议 scope)。

---

## 7. G1 达成实录 (2026-06-01 链上实证)

**46f8a settle TX 落链 confirmed** — KANet 首笔 v0.6 委员会 VRF 抽样 + 4-of-5 共识池 settle 真出账。

- `settle_txid` = `916d39d6c4c9bc1c7e1cde27623889d31323b09d913d037604ac4a52e8409fa7`
- 公链 api-tn12 验: **is_accepted=TRUE**, block `50f6f05...`, blue_score 26416045
- 12 outputs + 9 inputs: out[0]=broker 5M / out[1..5]=5 委员各 160,490,000 (≥oracleBond 100M ✓) / out[6..11]=maker+5 YES bettor 按比例分账 / fee 4,999,999 ≥ required 4,143,000 ✓

**A.1 决议补正 (实战暴露)**: 决议原文假设 settler 输出可自由构造, 但 DEPLOYED SS (PoolSpine_v06.sil:204-240) **硬编码** outputs[0]=broker、outputs[1..5]=5 委员 P2PK 各 ≥ oracleBondAmount、outputs[6..]=winners。→ A.1 实现必须: ① 委员输出落 outputs[1..5] ② 委员值 ≥ oracleBondAmount。46f8a 走 b36f967 (输出重排, 委员 oracleFee 160M ≥ bond 100M 恰好满足); **小池 oracleFee<bond 时需 J1 Plan X (委员 fixed fee = oracleBond 从输方池抽, commit 04c5feb 已实现+审过, 待 re-apply)**。

**清掉的 20 层 v0.5→v0.6 残债** (每层 Bettor DB/代码实证 → J2 修 → KANet-UI 部署 → J1 SS 把关): 超发(A.1 phantom bond)→ 0x76(scriptSig 反序, 改声明序)→ budget×2(sigOpCount 3→8)→ validSigs(sig 按 committee 序重排)→ 输出布局(委员落 1..5)→ minerFee(50k→5M)。

**G5 红线守住**: 这是【机制演示】链上闭环, **不是【经济安全】闭环**。dispute_reveal slash + 真链锁 enrollment stake = Phase5/mainnet 命门, 未落地前不报"经济安全 PASS"。

**follow-up**: Plan X 通用 fee 模型(小池)/ 动态 minerFee(按 TX mass)/ forfeit_1 非 unanimous entry / Phase5 经济命门。

---

*Bettor-tn 自决 — 依据 4/4 对抗共识 + 已锁文档初衷, 全程自动化。Owner 仅例外干涉 (freeze/差评), 非逐项审批。*
