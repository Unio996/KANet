# NWT 红队审核 — P4 ZK-settler 集成设计草稿 + zk-close-builder 骨架

**审核人**: NWT · **日期**: 2026-06-28 · **对象**: `docs/2026-06-28-P4-zk-settler-integration-design-draft.md` + `kasia-console/src/lib/zk-close-builder.mjs`
**审核方法**: 默认 refute — 逐类攻击向量主动构造，打不穿才 PASS。
**总体判决**: **CONDITIONAL GO — 2 BLOCKING · 1 CONDITIONAL · 5 PASS**
落码前必解 2 BLOCKING；C1 demo 可接受但 production 必补；P3 gating 已知。

---

## 攻击#1 — 假押注伪造（fake bets injection）

**攻击链**: 恶意 settler 在 DB `pool_bettor_sides` 插假押注 → `gatherOrderedBets` 返假 bets → guest 用假 bets 算 payoutRoot → 让 winner 多分。

**防御路**: guest 内部从 bets 重算 bets_root (hash-chain) → 放入 `journal.inputs_commit` → P3 covenant 校 `journal.inputs_commit == 链上 ctor-baked bets_root`。

**分析**: 若 P3 非-vacuous 正确实现（`inputs_commit` 非 witness，从链上烤死值 introspect），此攻击无法构造出通过 covenant 的 proof。Safety 依赖 P3。

**verdict**: ✅ **PASS（gated on P3）** — 设计识别此命门，正确标为 P3 GATING。  
**注**: P3 若 covenant 从 witness 读 `inputs_commit`（vacuous），此攻击穿透。P3 审核前 P4 不能 claim safety。

---

## 攻击#2 — 假 verdict 注入（winner 伪造）

**攻击链**: 恶意 settler 在 prove 时指定假 winner（NO 赢说 YES 赢）→ guest 用假 verdict 算 payoutRoot → 让错方拿钱。

**防御路**: verdict 进 journal；P3 covenant 校 `journal.verdict == 链锚 attested_winner`。`attested_winner` 在 phase1 `oracle_attest_verdict` 落链后烤进 PS continuation state，P3 从 UTXO state introspect（`readAttestedWinnerFromState` 的真实实现路）。

**关键命门 — `readAttestedWinnerFromState` STUB（B1）**:  
当前 `zk-close-builder.mjs:64` 是 `throw new Error('STUB')`。如果真实实现从 DB 取（`pool_markets.winning_side` 或类似），而不是从链上 PS UTXO redeem script decode，则 settler 可在 DB 改 winner → 生成假 verdict proof → 此时：
- P3 covenant 校验 `journal.verdict == attested_winner`：若 covenant 读的是链上 PS state（phase1 烤死的），verdict 就不符，proof 拒 → 安全。
- 但若 P3 也从某些链下值校验 verdict（设计未完全锁定），就存在漏洞。

**verdict**: 🔴 **BLOCKING (B1)** — `readAttestedWinnerFromState` 实现路径**必须在 P4 设计里明确锁定**：从 PS UTXO scriptPubKey/redeem 的 state 区 byte-decode `attested_winner`，**禁止从 DB 任何表读**（包括 `pool_markets`、`execution_states` 等）。P3 covenant 端对应地从链上 PS UTXO introspect 同一值，非 witness。两侧必须明确对齐接口，不能留"待 J1 定"。

---

## 攻击#3 — bets 序篡改（reorder attack · liveness × safety 分析）

**攻击链（safety）**: 恶意 settler 重排 bets 顺序，希望通过 proof 让 dust 归到指定的 winner[0]。

**防御**: bets_root hash-chain 是 order-sensitive；序错 → guest 重算 bets_root ≠ 链上 bets_root → `journal.inputs_commit` 不符 → proof 失败。  
**Safety verdict**: ✅ PASS — 无法绕过，proof 就是通不过。

**攻击链（liveness）**: `gatherOrderedBets` 用 `pool_bettor_sides.id ASC`（DB 插入序）。问题：`id` 由 Console 插入 DB 的顺序决定，不是 TX 落链序（DAA 序）。若多笔 register TX 被并发提交，落链 DAA 序 ≠ DB 插入序 → gather 序错 → proof 永远失败 → 市场 strand。

`daaOrderMatchesId` 守卫只对有 `side_lock_daa` 的行有效；`side_lock_daa=NULL` 的行排除在校验之外，只信 id 序。

**verdict**: 🟡 **CONDITIONAL (C1)** — Safety 无漏洞；Liveness 有风险。Demo 场景顺序单节点注册 id 序≈daa 序可接受，但需明确标注 production 限制：**production 必须从 `kaspa_tx_log` 或 `chain_events` 按 register TX 落链序（blockDaaScore+txIndex）derive bets 序，`pool_bettor_sides.id` 不可作为 production absorb 序依据**。设计草稿已有此注释，需要升级为 P4 验收硬门（不做到链序=不上 production）。

---

## 攻击#4 — vacuous journal（witness-sourced inputs_commit，P3 穿透）

**攻击链**: 若 P3 covenant 从 witness 读 `journal.inputs_commit`（而不是从 0xa6 输出 introspect），prover 在 witness 里放任意 journal → covenant 验通 → 用假 bets 算任意 payoutRoot → 全部资金偷走。

**分析**: P4 设计草稿明确标注"NWT 红队死盯 introspection 路径必链上非 witness"，且把此风险写进 §3 journal table provenance。设计层识别正确。

**verdict**: ✅ **PASS（设计层，P3 GATING）** — P4 设计正确识别并标注。P3 审核（`inputs_commit` covenant introspection 实现）是硬 gate，不得 defer。

---

## 攻击#5 — prove-fail 永久 strand（no escape hatch）

**攻击链**: RISC0 prover infra 宕机、guest panic（如 bets > 1024 cap 触发 `winners>1024 → 抛`）、网络问题等 → `proveZkClose` 永久失败 → `zkCloseTick` retry + alert 但无法 close → 所有 bettor 资金 strand 到 deadline。

**现有设计**: 设计草稿 §6 开放问题第4条提到"prove 失败处理: prove 出不来/超时 → fallback 委员路? 还是 retry?"，说"NO TX NO STATE"，但**没有指定 escape hatch**。骨架 `zkCloseTick` 注释写"retry + alert·绝不回委员路"，但 deadline 到期后怎么办没有答案。

**分析**:
- "绝不回委员路"是正确的（不能回脆性地基假装消除了问题）。
- 但需要独立的 **deadline-triggered auto-refund** 作为 escape：若到 deadline 仍无 ZK close，触发 refund-all（bshard 已有 `refund_maker_unjoined` + `PoolShard_fold refund_draw` 路）。这不是 fallback 委员路，是 liveness 安全网。
- bets > 1024 cap 是明确的 strand 路径（golden-ref §3 明文"winners > 1024 → 抛"），P4 必须处理。

**verdict**: 🔴 **BLOCKING (B2)** — 设计必须明确：
1. prove-fail 超过 N 次 retry / 超过 T 时间 → 触发哪条 escape 路（推荐: deadline-watcher 自动 refund，不走委员）。
2. bets > 1024 的 P4 处置：在 gatherOrderedBets 阶段检查，> 1024 直接 escape（refund），不进 prove。
3. 否则市场在 infra 故障时会永久 strand，无任何恢复路。

---

## 攻击#6 — dup-pk 在 ZK 路的影响

**攻击链**: 押注时同一 pk 押两边（YES + NO）→ `gatherOrderedBets` 取出两行 → guest 分别处理 → payout 计算？

**分析**:
- bets_root hash-chain absorb 两行（order-sensitive），只要序对，bets_root 正确。
- `computePariMutuelPayout`：dup-pk 的 pk 在 YES 和 NO 各押 → winningDirection 一边 → 只有那边的押注进 winners。另边的 stake 进 losing pool（被分走）。逻辑上没有 panic，计算正确。
- 委员 sighash 问题（jepu1）在 ZK 路不复现（ZK 路无 Schnorr sig）。

**verdict**: ✅ **PASS** — dup-pk 在 ZK settle 路 safety 上没有问题，guest 正确处理。

---

## 攻击#7 — phase1→phase2 TOCTOU（verdict 可否被替换）

**攻击链**: phase1 `oracle_attest_verdict` 落链，attested_winner 烤进 PS continuation；phase2 settler 用不同 verdict prove → 若 P3 covenant 正确从 phase1 continuation UTXO state 读 attested_winner（而不是 settler-fed），TOCTOU 不成立。

**分析**: phase2 `zk_close` 必须 **花费** phase1 continuation UTXO。UTXO 存在才能花 → 天然保证 phase1 LAND。P3 covenant introspect 该 UTXO 的 state 读 attested_winner → 与 journal.verdict 比对。恶意 settler 无法改变已 LAND 的 UTXO state。

**verdict**: ✅ **PASS** — UTXO 花费链天然保序，TOCTOU 不成立。设计的 phase1→phase2 编排是正确的。

---

## 攻击#8 — computeJournalHash 拼接语义

**攻击链**: `computeJournalHash(betsRoot, payoutRoot, winner)` 用 `sha256(bets_root ‖ payout_root ‖ winner_1B)` 拼接，但 RISC0 journal 实际 framing 可能不同（有 envelope prefix / winner 宽度 / 字节序等差异）→ covenant 验 OpZkPrecompile 出来的 journal_hash 和 settler 自算的不符 → 永远失败。

**分析**: 骨架已明确标注"⚠ 精确 framing 待 J1 RISC0 framing 锁后必三层 byte-equal 核"，是 STUB 区域。RISC0 journal 的真实输出是 RISC0 protocol-defined（risc0-zkvm 的 `Journal.digest()`），不是自定义 sha256；`commit_to_groth16` 后 journal digest 进 proof 的 public inputs。P4 落码前必须 J1 给 byte-exact framing spec 并在 `computeJournalHash` 里验。

**verdict**: ✅ **PASS（STUB 已知·J1 firm 前不落码·接受）** — 标注清晰，可接受。

---

## BLOCKING 汇总（落码前必解）

### B1 — `readAttestedWinnerFromState` 实现路径必锁
**来源**: 攻击#2  
**修法**: P4 设计文档增加明确规范：从 PS UTXO scriptPubKey/redeem state byte-decode attested_winner，**零 DB 依赖**（禁 `pool_markets` / `execution_states` / 任何 Console DB 字段）。J1 给 state layout（attested_winner offset），J2 据此实现。P3 covenant 侧对齐读同一值。  
**验收**: 实现后 NWT code-review 确认调用链不含 DB 读。

### B2 — prove-fail escape hatch 设计缺失
**来源**: 攻击#5  
**修法**: P4 设计文档增加 escape hatch 规范：
1. prove 失败超过 N_MAX 次（or 超 T_MAX 时长）→ 标记 `zk_prove_failed`，触发 deadline-watcher 路 auto-refund（已有 bshard refund 机制，复用）。
2. bets > 1024（golden-ref 限制）→ gatherOrderedBets 检查 → 直接 escape（refund），禁进 prove。
3. 禁止 fallback 委员路（已 Bettor 红线，维持）。

**验收**: Bettor 审 escape hatch 设计，NWT 确认覆盖 prove-fail + cap 两路。

---

## CONDITIONAL 汇总（demo 可接受·production 必补）

### C1 — gatherOrderedBets DB id 序 ≠ 链上 register 落链序
**来源**: 攻击#3  
**修法**（production 必做，demo 明确声明限制）: P4 验收条件增加：`db_id` 序只用于 demo（顺序单节点注册时 db_id ≈ daa 序）；production 必须从 `kaspa_tx_log.block_daa_score + tx_idx` 按落链序 derive bets 序，`pool_bettor_sides.id` 不作为 absorb 序依据。设计文档 §5 开放问题增加第6条：bets 排序 production 路。

---

## PASS 汇总

| # | 攻击向量 | 结果 |
|---|---|---|
| 1 | 假押注伪造 | ✅ PASS（P3 gated） |
| 3/safety | bets 序篡改（safety） | ✅ PASS |
| 4 | vacuous journal（P3 穿透） | ✅ PASS（P3 gated·设计识别） |
| 6 | dup-pk ZK 路影响 | ✅ PASS |
| 7 | phase1→phase2 TOCTOU | ✅ PASS（UTXO 花费链保序） |
| 8 | computeJournalHash framing | ✅ PASS（STUB 已知·J1 firm 前不落码） |

---

## NWT 执行总结

- **CONDITIONAL GO**：B1 + B2 修完，P3 接口锁定后，P4 可落码。
- **P3 审核 = 下个 NWT 重点**（inputs_commit / verdict 的 covenant introspection 非-vacuous 验证）：P4 safety 完全 gated on P3 正确实现。
- **P1**：J1 fix B1（readAttestedWinnerFromState 接口规范） → NWT 确认规范无 DB 依赖。
- **B2**：J2 在设计草稿里补 escape hatch 规范 → Bettor 裁 → NWT 确认覆盖。
- **C1**：demo 明标限制，不阻塞 demo，production 排 milestone。
