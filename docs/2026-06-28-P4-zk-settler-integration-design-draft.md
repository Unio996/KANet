# P4 — ZK-settle settler 集成 设计草稿（待 Bettor/NWT 审·不落码）

**作者**: J2 · **日期**: 2026-06-28 · **状态**: 草稿·Bettor GO 做设计·待 Bettor+NWT 审 → P3 covenant 接口锁定后落码
**配**: 实施方案 `docs/2026-06-28-ZK-settle-implementation-plan.md`（P4=我 owned）· golden-ref `docs/2026-06-28-P2-payout-guest-golden-reference.md`（byte-equal 锚）
**scope**: ZK-settle 只 fit **bshard 路**（ShardLeaf/PayoutShard/PoolRoot continuation 有累积器）·非-bshard PoolSide_v07 路不在本设计（J1 架构 fit·留旧 covenant 或 migrate）。

---

## 1. 现状 close 路（ZK 替换的对象）
当前 bshard 结算 = **close_attest + 5 委员签**（committee-TRUST）:
- settler 算 payoutRoot（off-chain BigInt exact·computePariMutuelPayout+settlePayoutRoot）
- dispatch close_attest → 委员 voter（`enforceCloseAttest`/`enforceCommitteeSign`）re-derive winningSide+payoutRoot → 4-of-5 验过才签
- payoutRoot 烤进 PS continuation output P2SH scriptPubKey（SIGHASH_ALL 覆盖 = 委员签名真绑的值）→ closed 0→1
- **信任假设**: 信 4-of-5 委员诚实 re-derive。脆性: 5 inlined merkle 副本（offsets 1002/1266/.../2058）+ sighash + 槽位（= 今晚一整类脆性）。

## 2. ZK close 路（替换 = 零委员签·一个证明）
```
settler bshard close（ZK）:
 1. gather: 从链上 PayoutShard state 读 bets_root(= inputs_commit·链锚)+ 重建 ordered bets 集(register 顺序)
 2. verdict: 预言机判决(冻结 ESPN 快照·judgeLine·= 现有 enforce 同源·verdict 进 journal)
 3. RISC0 prove(guest): 私有输入=ordered bets; guest 内:
       - 重算 bets_root(hash-chain·== journal.inputs_commit)  ← 防假押注
       - judgeLine(verdict) → winningDirection
       - computePariMutuelPayout + deriveFeeLeaves(= golden-ref byte-equal)→ payoutLeaves
       - settlePayoutRoot → payout_root
       - journal 公开 = { inputs_commit(bets_root), verdict, fee_rules_commit, payout_root }
 4. commit_to_groth16: RISC0 receipt → Groth16 压缩(~1.8KB·P1 实测能上链·140k grams<500k cap)
 5. build close_attest_zk tx:
       - sig_script = Groth16 proof args(keyless·像 P1 spend·无委员签)
       - covenant(ShardLeaf_zk/PayoutShard_zk·P3·J1): OpZkPrecompile 验 seal → 校 journal.image_id==钉死结算程序
         → 校 journal.inputs_commit == 链上 ctor-baked bets_root(非 witness·非-vacuous)→ 校 verdict/fee_rules_commit==链锚
         → 取 journal.payout_root 烤进 PS continuation P2SH(同现有 closed 0→1 + payoutRoot 机制)
 6. submit → TN12 LAND(NO TX NO TRUTH)→ winners claim 不变(payout_root 同结构·merkle claim 复用)
```
**信任假设变(两阶段·口径精确·KANet-UI 锁)**: 实为**两阶段**——① `oracle_attest_verdict`(委员/oracle attest winningSide → state attested_winner·**verdict 层 1 仍委员·非消除**·首 demo single-sig 是非命门简化可 defer)② `zk_close`(ZK 证 payout·**payout 层 2 零委员**·消 dup-address/sighash/NUM2BIN 那类脆性)。**绝不报"全零委员"**——只 payout 侧零委员。命门(非-vacuous attested_winner/bets_root 绑定)**绝不 stub**(Bettor 红线)。
> ⚠ **诚实前置(Bettor 校准·防快-LAND 错觉)**: 设计锁 ≠ e2e LAND。真前置 = P0 zk-sdk WASM port-成-Node-包(settler 调 commit_to_groth16)+ P2 Rust guest(J1 critical-path·未写)+ 本 builder。e2e LAND 是真实现 chunk·非 imminent。

## 3. journal 构造（命门·必绑链上真相·防 vacuous）
| 字段 | 值 | provenance（covenant 怎么验·非信 prover） |
|---|---|---|
| inputs_commit | bets_root（hash-chain·golden-ref §6.5） | covenant 校 == 链上 ctor-baked init_bets_root（P3·J1·非 witness） |
| verdict | 预言机判决 0/1 | covenant 校 == 链锚 verdict commit（同现有 oracle attest 源·NWT 红队） |
| fee_rules_commit | == genesis 烤 feeRules | covenant 校 == create-committed feeRules（命门④·同现有 computeMarketCommit） |
| payout_root | guest 算的根 | covenant 取它烤进 PS P2SH 作分发根（被证明锚死） |
- guest 内部 bets_root/payout_root 必 **== golden-ref byte-equal**（serializeI64 LE/blake2b dkLen32/dust 归位/hash-chain order）。漂一 bit = journal 锚错。

## 4. 集成点（settler 哪改·P3 锁定后落码）
- **替换**: `pool-market-settler.js` 现 dispatch close_attest + 委员 sign 编排（enforceCloseAttest 路）→ ZK-prove + build close_attest_zk tx。
- **复用不改**: computePariMutuelPayout/deriveFeeLeaves/settlePayoutRoot（guest 移植已 P2 byte-equal）· judgeLine（verdict）· claim builder（payout_root 同结构·winners claim 不变）· PS continuation 烤 payoutRoot 机制。
- **新增**: prove 接入模块（RISC0 prove → Groth16 compress·调 P0 port 的 zk-sdk WASM）· close_attest_zk tx builder（proof→sig_script·复用 P1 keyless spend 配方）。

## 5. prove 基础设施（开放·probe-not-model）
- **谁跑 prover**: RISC0 prove 重（分钟级 + CPU/资源）。settler 端跑? 还是独立 prover 服务? → 影响 settle 延迟 UX。
- **latency**: prove + Groth16 compress 耗时进 settle 流水设计（非即时·像现有 committee 收集窗）。
- **Groth16 compress**: zk-sdk commit_to_groth16（P1 路·~1.8KB tx）。
- **image_id 钉死**: 结算 guest 编译产 image_id·烤进 covenant（改 guest = 改 image_id = 新 covenant）。版本治理。

## 6. 依赖 + 开放问题（必 P3 锁定才落码）
1. **P3 covenant 接口**（J1·gating）: close_attest_zk tx 怎么带 proof + journal? covenant 怎么 introspect 读 bets_root（ctor-baked·NWT 红队路径）+ 验 0xa6? → 这定我 tx builder 格式。
2. **SIZE**（J1 probe 中）: ShardLeaf_zk + bets_root 过 9999? close_attest_zk redeem（含 0xa6 验 + journal 校）size? → 影响可行性。
3. **跨层 byte-equal**（命门）: guest（Rust）的 bets_root/payout_root == golden-ref（off-chain）== covenant（.sil）。我 golden-ref 是 off-chain 锚·guest 对死它·P2 闸。
4. **prove 失败处理**: → **已锁,见 §8.B2 escape hatch**(deadline-watcher auto-refund·绝不 fallback 委员路)。
5. **首 ship 单片**（J1·shard_count=1）: 单 PayoutShard betsRoot 直接=inputs_commit·我 P4 先做单片·多片 fold 后续。
6. **bets absorb 序 production 路**（NWT C1）: → **已锁,见 §8.C1**。demo 用 db_id 序·production 必从 `kaspa_tx_log` DAA 落链序 derive。

## 7. 验收（P4 闸·plan P4）
- TN12 live e2e: 建 bshard 盘 → ZK close（prove→Groth16→tx）→ **链上 LAND**（NO TX NO TRUTH）。
- J1 跨节点同证 settle_txid + NWT 红队端到端（journal vacuous/proof 伪造）+ Bettor 验落链 + byte-equal（guest payout_root == golden-ref）。
- 诚实口径: P4 live LAND = **bshard 路 ZK-settle 达成**·非"全系统脆性消失"（非-bshard 路另议）。

---

## 8. NWT 红队 BLOCKING 修复（CONDITIONAL GO → 落码前必解·NWT 2026-06-28 `docs/2026-06-28-NWT-redteam-P4-zk-settler-design.md`）

### B1 — `readAttestedWinnerFromState` 实现路径锁死（来源 攻击#2·verdict 伪造）
**规范（落码硬约束·NWT code-review 验收）**:
- `readAttestedWinnerFromState` **只从链上 PS continuation UTXO 的 scriptPubKey/redeem state 区 byte-decode `attested_winner`**。值来源 = phase1 `oracle_attest_verdict` 落链后烤进 PS continuation 的 state 字段（covenant SIGHASH 覆盖·非 caller 自报）。
- **零 DB 依赖（禁止读任何 Console DB 表）**: 禁 `pool_markets.winning_side` / `execution_states` / `pool_committee` / 任何 sqlite 字段。DB 是 caller-controllable（恶意 settler 可改）→ 从 DB 读 = forgeable verdict（递归洞·= verify-value-source 铁律的 ZK 形态）。
- **取链值路径**: settler 经 relay 自取 phase2 即将花费的 phase1 continuation UTXO（`getUtxosByAddresses`/RPC by PS P2SH 地址）→ decode scriptPubKey → 在 **J1 给的 offset** byte-read `attested_winner`。这与 `gatherOrderedBets` 的 bets_root 同纪律（relay 自取·非 caller-fed ctx）。
- **两侧接口对齐（J1↔J2 锁·不留"待 J1 定"）**: J1 covenant 端（P3）从同一 PS UTXO state introspect 同一 `attested_winner` 与 `journal.verdict` 比对（非 witness）。J2 settler 端读同一 offset 同一编码喂 guest 的 `winner` 入参。**接口契约 = {PS state layout: closed 字段 offset + attested_winner offset + 编码(1B? LE?)}·J1 owner·我据此实现 byte-read**。
- **深防御**: 即便 settler 误/恶意喂错 winner → guest 算错 payout → `journal.verdict` 不符链上 `attested_winner` → P3 covenant 拒 proof（safety 终极锚 P3）。B1 的 zero-DB 链读是 **liveness（诚实路必读真值才 prove 得过）+ 去掉 forgeable 路** 双重必要。
- **TOCTOU（C3·配 §7 攻击#7 PASS）**: 我 gather→prove 用的 `attested_winner` 必 == phase2 tx 实际花费的 phase1 UTXO state 值（验的==花的）。phase2 必花 phase1 continuation UTXO（UTXO 在才能花·天然保序）。

### B2 — prove-fail escape hatch（来源 攻击#5·永久 strand）
**铁律前提**: **绝不 fallback 委员路**（回脆性地基 = 假装消除了问题·Bettor 红线·维持）。escape ≠ 委员 fallback·escape = **deadline 自治退款**（liveness 安全网·复用既有 bshard 退款机制·非新脆性）。
1. **prove-fail retry 政策**: `proveZkClose` 失败（infra 宕/guest panic/网络）→ retry ≤ `ZK_PROVE_MAX_RETRY`（建议 3·env 可调）/ 或超 `ZK_PROVE_MAX_T`（建议 30min）→ 标记 market `zk_prove_failed` flag（**不 advance closed·不碰 status='cancelled'**·见教训）+ alert。
2. **deadline 自治退款（escape 主路·复用·零新机制）**: market 到 deadline 仍无 ZK close LAND（无论 prove-fail 还是 infra 长宕）→ **既有 deadline-watcher 路自然接管**·**退款路由必 bet-count-aware（Bettor 补·code-grounded）**:
   - **bets>0 strand → 全 bettor `refund_draw`**（PoolShard_fold entry 4·`pool-refund-builder.mjs` `buildRefundWitness`/`buildRefundCommand`·每 bettor reveal 自己 PoolSide ticket 取回 stake 1:1）。**不是 maker-only**。
   - **0-bet strand → `refund_maker_unjoined`**（PoolSpine_v07.sil L370-373 entry 2·maker 取回 seed·无需投票·settler L1316/L1659/L1926 现有 0-bet 短路）。
   - **outpoint-precise·链验 refund_txid LAND**（NO TX NO STATE·配记忆 `reference-refund-verify-chain-not-db-claim-field`）。`zk_prove_failed` flag 只是**停掉无谓 re-prove 循环**·退款机制是 deadline 既有路·非新增。
   - **demo backstop（Bettor 裁·够今晚）= 既有 deadline CLTV+grace refund**（outpoint-precise）。**production 提前退款**（N_MAX/T_MAX 在 deadline *前*触发·缩短 strand 窗）= 排 milestone·**不 gate 今晚 demo**。
3. **`bets > 1024` cap 预检（攻击#5 第2路·golden-ref depth-10 = 1024 leaf 上限）**: `gatherOrderedBets` 阶段检查投影 payout-leaf 数（winners + fee-leaves）> 1024 → **prove 前直接 escape 退款**（禁进 prove·guest 会 panic）。单片 demo 远不及 cap·production 多片 fold 分摊（每片 ≤1024）。
4. **不碰 status 教训（硬约束）**: escape **绝不用 `status='cancelled'` 堵**（status-cancel 断 deadline 自动退款路·见记忆 `feedback-pool-market-status-cancel-breaks-settler-refund` + 线9 旧canary实踩）。entry-block / prove-stop 用独立 flag（`zk_prove_failed`）·退款归 deadline 自治 outpoint-precise·解耦。
5. **验收**: Bettor 审 escape 设计·NWT 确认覆盖 {prove-fail retry 耗尽 + bets>1024 cap} 两路·且无委员 fallback·且不 status-cancel。

### C1 — bets absorb 序 production 路（来源 攻击#3 liveness·demo 可接受·production 必补）
- **demo（首 ship 单片·可接受）**: `gatherOrderedBets` 用 `pool_bettor_sides.id ASC`（DB 插入序）。单节点顺序注册时 db_id ≈ 落链 DAA 序。现有 `daaOrderMatchesId` 守卫（builder L51-53）= demo-time canary：有 `side_lock_daa` 的行按 daa 升序应 == id 升序·不符则**拒 prove**（命门告警·不喂错序进 guest）。
- **production（硬门·不做到链序=不上 production）**: 必从 `kaspa_tx_log.block_daa_score + tx_idx` 按 register TX **落链序** derive bets 序（hash-chain absorb 序 = on-chain bets_root 的真实累积序）。`pool_bettor_sides.id`（Console 插入序·并发提交时 ≠ DAA 序）**不作 production absorb 序依据**。
- **风险**: 若多笔 register TX 并发提交·落链 DAA 序 ≠ DB 插入序 → gather 序错 → guest 重算 bets_root ≠ 链上 bets_root → proof 永远失败 → 市场 strand（被 B2 escape 兜·但应根治）。
- production milestone 排（非 demo 阻塞·但验收文档明标限制）。

---
**待 Bettor+NWT 审本草稿** → 提 issue/改 → P3 covenant 接口锁定 → 我落码（prove 接入 + close_attest_zk builder）。现在纯设计·零码·守 P3 gate。
**§8 更新（2026-06-28·J2 解 NWT B1/B2/C1）**: B1 链读规范锁 + B2 escape hatch（deadline 自治退款·非委员）+ C1 production 链序 → 待 Bettor 裁 + NWT 确认覆盖。
