# NWT 红队审核 — gap③ 执行设计(broker DM live settle)

**作者**: NWT · **日期**: 2026-06-28 · **审对象**: `docs/2026-06-28-J2-broker-dm-live-settle-execution-design.md`
**触发**: J2 设计待 Bettor/NWT 审 → 审过才执行
**方法**: default-refute / 构造每个失败路 / 列尝试过哪些攻击为什么 PASS 或 FAIL

---

## 审核前：我试过哪些攻击

| 攻击 | 结论 |
|------|------|
| broker_fee_pct=0 → 无 fee 输出 → 无 DM | pool.js L600 硬固定 190 — PASS |
| Bot 还在跑旧 72596c74（有 B1 bug） | console PID 52992 启动 14:55:06, commit 24da268b 14:54:48 → 18s 后启动 → 代码已载 — PASS |
| backfill sentinel 吞 fresh 市场 | sentinel suppressed=0 盘 + 时间 03:07 UTC，fresh 市场不在 suppressed 范围 — PASS |
| Owner tg 映射不在 DB | tg_custodial_wallets: 1437320734 ↔ qzhet8m2...gzgdl 已存在 — PASS |
| test-oracle → voter skip | J2 code-grounded 更正·bettor-prediction-voter.js L355-363 findExtractor=null→skip·D1 改 ESPN-final — PASS |
| tie/postponed → 误判 winner | J1: finality gate extractEspnEvidence 要 state=FINAL·非 final→ABSTAIN→退款(钱安全, 非 wrong-winner) — PASS |
| broker_address 大小写不一致 → 漏 output | L77-79 注释：broker_pk as-stored 不 lowercase·与 settle 路 XOnlyPublicKey 同源 — PASS |
| 恶意 settler 构造 outputs 骗 DM 地址 | broker 地址来自 pool_markets.broker_pk(create 时 assertBrokerP2PK 烤死)，非 emit 时 caller 输入。攻击成本=建一个以受害者 pk 为 broker_pk 的市场=fee 落受害者(受害者获益，非财务攻击)·属 create 层先决问题 — PASS |

---

## 攻击成功路(真 FINDING)

### ⚠️ CONDITIONAL-1 — 全本地委员「不保证」，VRF 采样池检错表

**攻击构造**：J2 pre-check 查 `relay_nodes WHERE is_oracle=1` = 10 条（本地 DB）。但 VRF 真正采样池 = `oracle_pool_chain_view`（链锚，J1 :3300 实查 = 13 成员）。其中 4 个是 J1 :3300 的 relay（Alice/Bob/Carol/Dave，地址 qzss9777/qz0zmwzj/qpcp8ugc/qrnxvgu7），签名 key 在 :3300，:3200 无法签。

**风险量化**（J1 08:37 实算）：
- VRF 从 13 选 5，4 个跨节点
- P(≥1 跨节点被选) ≈ 90%（1 - C(9,5)/C(13,5)）
- P(≥2 跨节点被选) ≈ 51%（threshold=4，≥2 跨节点 → 最多 3 本地签名 → 永卡 verifying）
- **demo 约一半概率挂在委员签名步骤**

**正确兜底（J1 推荐 option a）**：
1. 先建盘（仅建·不种注）→ 读该 market 的 `pool_committee.committee_pks` 5 个 PK
2. 逐 PK 比对 :3200 本地 relay（mnemonic_encrypted 有值 = 可签）
3. 5/5 全本地 → 种注 → 继续 demo
4. 有跨节点 → 废弃该盘（不种注）→ 重建（新 market_id → 新 VRF 抽签）→ 期望约 2 次命中全本地

**VERDICT**: CONDITIONAL（已升级）— build-then-verify 委员，不 pre-check（VRF 结果在建盘后才定）。建盘后 NWT 交叉验 committee_pks 全 :3200 可签，才 GO 种注。

**教训**：pre-check #1 查的是 relay_nodes（本地概念），不是链锚采样池（oracle_pool_chain_view）。正确查法 = build market → pool_committee 表实读。

---

### ⚠️ CONDITIONAL-2 — POOL_SETTLER_TICK_SEC 未确认，demo 可能慢 5 分钟

**攻击构造**：默认 POOL_SETTLER_TICK_SEC=300（pool-market-settler.js L49）。settle_txid LAND 后，broker-fee-emit 在下次 settler tick 才运行。若 tick=300s，settle TX LAND → 等最多 5 分钟 → emit → bot poller → DM。现场 demo 等 5 分钟是致命体验问题。

**DB 验**：环境变量 POOL_SETTLER_TICK_SEC 未在 DB 或配置文件里找到（不是存 DB 的值）。无法远程验。

**要求**：demo 前 J2/KANet-UI 确认 kanet.env 已设 `POOL_SETTLER_TICK_SEC=60`（以及 console 已 reload 该值）。这不阻 demo 正确性，但 5 分钟对 Owner 现场演示 = DM 迟迟不来 → Owner 误认为系统坏了。

**VERDICT**: CONDITIONAL — demo 前验 env，不 deploy 到 60s = demo 体验坏。

---

### ⚠️ CONDITIONAL-3 — kaspa_tx_log 索引健康未验

**攻击构造**：broker-fee-emit.mjs L68：`SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?`。settle TX 广播后必须 Scout 嵌入式索引器（relay 订阅 block-added 写入 kaspa_tx_log）先 index 该 TX，否则 pendingIndex++ → 下次 tick 再试 → POOL_SETTLER_TICK_SEC 再加一轮等待。如果 relay block-added 订阅断线或 kaspa_tx_log 积压，DM 永不来（或极延迟）。

**要求**：settle 广播后，J2 必须主动查 `SELECT * FROM kaspa_tx_log WHERE tx_id = <settle_txid>` 确认 indexed，才能认为 emit 链路畅通。这是 verify-before-claim 的 gap③ co-verify 步骤之一。

**VERDICT**: CONDITIONAL — gap③ co-verify SOP 必须包含 kaspa_tx_log 索引检查。

---

### ✅ PASS 汇总

| 项 | 结论 |
|----|------|
| D1 ESPN-final 源 (voter 自然投) | PASS·findExtractor 认 espn·finality gate 兜 non-final→ABSTAIN |
| D3 broker_address → tg_user_id 映射 | PASS·DB 实查确认 1437320734↔Owner |
| D4 8B spine 编译层生效 | PASS·xzztw spine_redeem 58cd 已验·新盘自动继承 |
| broker_fee_pct > 0 (1.9%) | PASS·pool.js L600 硬固定 190·不可 override |
| Bot 运行 24da268b 修复版 | PASS·console PID 14:55:06 > commit 14:54:48 |
| backfill 不挡 fresh 市场 | PASS·sentinel suppressed=0·时间 03:07 UTC |
| NO TX NO STATE 兜底 | PASS·设计明确 check_utxo_landed=true 才算闭 |
| ESPN edge case (tie/postponed) | PASS·ABSTAIN→退款·非 wrong-winner |

---

## 执行前查清单（NWT 要求 J2 GO 前逐项确认）

1. **[ ] oracle pre-check (D2)**：`SELECT id,name FROM relay_nodes WHERE is_oracle=1` 逐个确认 :3200 可签（有 privkey 或 mnemonic），输出"哪些可签/哪些不可签"。若不可签的 ≥1 个 → 执行兜底（标 is_oracle=0 排除）再 GO。
2. **[ ] POOL_SETTLER_TICK_SEC=60**：`echo $POOL_SETTLER_TICK_SEC` OR grep kanet.env，确认已设且 console 已载。
3. **[ ] ESPN-final predict-then-verify**：手动 fetch ESPN URL + 跑 `findExtractor(url)→extract` 确认 winner 字段产出且 state=final，对死了再建盘（这是 J2 设计已有的要求，执行前必完成）。
4. **[ ] kaspa_tx_log 近期健康**：`SELECT COUNT(*) FROM kaspa_tx_log WHERE created_at > datetime('now','-10 minutes')` — 应有近期 TX（证明 Scout indexer 活跃）。

---

## VERDICT: CONDITIONAL GO（3 个 pre-check 完成后）

**Bettor 放 GO 条件**：J2 在频道贴执行前查清单 1-4 的实查结果 → NWT/Bettor 确认 → 建盘。

**不允许**：边建盘边查 pre-check（先建后发现跨节点 oracle = 盘已建无法回撤，浪费市场 ID + 押注）。
